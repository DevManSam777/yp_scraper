const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

// import the scraper class and database
const YellowPagesPuppeteerScraper = require("./puppeteer-scraper-module");
const SearchDatabase = require("./database");

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// create app directory if it doesn't exist
const appDir = path.join(__dirname, "public", "app");
if (!fs.existsSync(appDir)) {
  fs.mkdirSync(appDir, { recursive: true });
}

// serve static files from public folder
app.use(express.static("public"));

// initialize database
// Use /data if volume is mounted (fly.io), otherwise use local directory
const dbPath = fs.existsSync('/data') ? '/data/searches.db' : './searches.db';
const db = new SearchDatabase(dbPath);
console.log(`Database initialized at: ${dbPath}`);

// create scraper directory structure
const scraper = new YellowPagesPuppeteerScraper();

// serve the login page (stays in public root)
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

// serve the main app from /app directory
app.get("/app", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "app", "index.html"));
});

// redirect root to login page by default, prevents the flash of content
app.get("/", (req, res) => {
  res.redirect("/login");
});

// API endpoint to get search status
let searchStatus = {
  isRunning: false,
  query: "",
  location: "",
  currentPage: 0,
  totalBusinesses: 0,
  statusMessage: "",
  error: null,
  progress: 0,
};

// handle form submission
app.post("/api/search", async (req, res) => {
  // if a search is already running, return busy status
  if (searchStatus.isRunning) {
    return res.json({
      success: false,
      error: "A search is already in progress",
      status: searchStatus,
    });
  }

  const { query, location, numResults, saveFormat, timestamp } = req.body;

  // reset search status
  searchStatus = {
    isRunning: true,
    query: query,
    location: location,
    currentPage: 0,
    totalBusinesses: 0,
    statusMessage: "Starting search...",
    error: null,
    progress: 0,
  };

  // create the status update function
  const updateSearchStatus = (
    message,
    page = 0,
    totalBusinesses = 0,
    error = null
  ) => {
    // always update message
    searchStatus.statusMessage = message;
    
    // only update page if provided and greater than current
    if (page > 0) {
      searchStatus.currentPage = page;
    }
    
    // only update total businesses if provided and greater than current
    if (totalBusinesses > 0 && totalBusinesses > searchStatus.totalBusinesses) {
      searchStatus.totalBusinesses = totalBusinesses;
    }
    
    if (error) {
      searchStatus.error = error;
    }

    // calculate progress based on current/target ratio
    // this will only grow, never reset
    const targetResults = parseInt(numResults, 10);
    if (searchStatus.totalBusinesses > 0) {
      searchStatus.progress = Math.min(
        Math.floor((searchStatus.totalBusinesses / targetResults) * 100),
        99
      );
    }
  };

  // start the search asynchronously
  const runSearch = async () => {
    let searchId = null;
    let scraper = null;

    try {
      // generate filename using timestamp from browser (user's local time)
      const sanitizedQuery = query.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const sanitizedLocation = location.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const filename = `${sanitizedQuery}_${sanitizedLocation}_${timestamp}.${saveFormat}`;

      // create search record in database
      searchId = db.createSearch(query, location, saveFormat, filename);
      console.log(`Created search record with ID: ${searchId}`);

      // create a new instance of the scraper with incremental save callback
      const onPageScraped = (businesses, pageNumber) => {
        // Save businesses to database after each page
        console.log(`Saving ${businesses.length} businesses from page ${pageNumber} to database`);
        db.saveBusinesses(searchId, businesses, pageNumber);

        // Also update the count
        const stats = db.getSearchStats(searchId);
        updateSearchStatus(
          `Found ${stats.total_businesses} businesses so far...`,
          pageNumber,
          stats.total_businesses
        );
      };

      scraper = new YellowPagesPuppeteerScraper(updateSearchStatus);
      scraper.onPageScraped = onPageScraped; // Add callback for incremental saves

      // run the search
      updateSearchStatus("Search initiated...");
      const businesses = await scraper.search(
        query,
        location,
        parseInt(numResults, 10)
      );

      // processing post-scraping
      updateSearchStatus("Processing results...");

      // also save to file for backward compatibility
      updateSearchStatus(`Saving ${businesses.length} results to file...`);
      if (saveFormat === "json") {
        scraper.exportToJSON(businesses, filename, false);
      } else {
        scraper.exportToCSV(businesses, filename, false);
      }

      // update database search record as completed
      db.updateSearch(searchId, businesses.length, 'completed');

      // close the browser
      await scraper.close();

      // complete the search
      searchStatus.isRunning = false;
      searchStatus.progress = 100;
      searchStatus.statusMessage = `Search completed. Found ${businesses.length} businesses.`;
      searchStatus.currentFile = { name: filename, format: saveFormat };

      console.log(`Search completed: ${businesses.length} businesses saved`);
    } catch (error) {
      searchStatus.isRunning = false;
      searchStatus.error = error.message;
      searchStatus.statusMessage = `Error: ${error.message}`;
      console.error("Search error:", error);

      // Update database if we have a searchId
      if (searchId) {
        const stats = db.getSearchStats(searchId);
        db.updateSearch(searchId, stats.total_businesses, 'failed');
      }

      // Try to close browser even on error
      try {
        if (scraper && scraper.browser) {
          await scraper.close();
        }
      } catch (closeError) {
        console.error("Error closing browser:", closeError);
      }
    }
  };

  // start the search process without waiting for it to complete
  runSearch();

  // send immediate response
  res.json({
    success: true,
    message: "Search started",
    status: searchStatus,
  });
});

// API endpoint to get current search status
app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    status: searchStatus,
  });
});

// API endpoint to get search results (from database)
app.get("/api/results/:format/:filename", (req, res) => {
  const { format, filename } = req.params;

  try {
    // Get search from database
    const search = db.getSearchByFilename(filename);

    if (!search) {
      return res.status(404).json({
        success: false,
        error: "Search not found",
      });
    }

    // Get businesses for this search
    const businesses = db.getBusinessesBySearchId(search.id);

    if (format === "json") {
      // Convert database format to frontend format
      const results = businesses.map(b => ({
        businessName: b.business_name,
        businessType: b.business_type,
        phone: b.phone,
        website: b.website,
        streetAddress: b.street_address,
        city: b.city,
        state: b.state,
        zipCode: b.zip_code,
        aptUnit: b.apt_unit,
        fullAddress: b.full_address
      }));

      res.json({
        success: true,
        totalResults: results.length,
        results: results,
      });
    } else {
      // For CSV, generate CSV from database
      const headers = ['Business Name', 'Business Type', 'Phone', 'Website', 'Street Address', 'City', 'State', 'ZIP Code'];
      const csvRows = [headers.join(',')];

      businesses.forEach(b => {
        const row = [
          b.business_name || '',
          b.business_type || '',
          b.phone || '',
          b.website || '',
          b.street_address || '',
          b.city || '',
          b.state || '',
          b.zip_code || ''
        ].map(field => `"${field}"`);
        csvRows.push(row.join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvRows.join('\n'));
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// handle file downloads (from database)
app.get("/download/:format/:filename", (req, res) => {
  const { format, filename } = req.params;

  try {
    // Get search from database
    const search = db.getSearchByFilename(filename);

    if (!search) {
      return res.status(404).send("File not found");
    }

    // Get businesses for this search
    const businesses = db.getBusinessesBySearchId(search.id);

    if (format === "json") {
      // Convert database format to frontend format
      const results = businesses.map(b => ({
        businessName: b.business_name,
        businessType: b.business_type,
        phone: b.phone,
        website: b.website,
        streetAddress: b.street_address,
        city: b.city,
        state: b.state,
        zipCode: b.zip_code,
        aptUnit: b.apt_unit,
        fullAddress: b.full_address
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(JSON.stringify(results, null, 2));
    } else {
      // For CSV
      const headers = ['Business Name', 'Business Type', 'Phone', 'Website', 'Street Address', 'City', 'State', 'ZIP Code'];
      const csvRows = [headers.join(',')];

      businesses.forEach(b => {
        const row = [
          b.business_name || '',
          b.business_type || '',
          b.phone || '',
          b.website || '',
          b.street_address || '',
          b.city || '',
          b.state || '',
          b.zip_code || ''
        ].map(field => `"${field}"`);
        csvRows.push(row.join(','));
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvRows.join('\n'));
    }
  } catch (error) {
    res.status(500).send("Error downloading file");
  }
});

// list available files (from database)
app.get("/api/files/:format", (req, res) => {
  const { format } = req.params;

  try {
    // Get all searches from database
    const searches = db.getAllSearches(format);

    // Convert to file details format
    const fileDetails = searches.map((search) => {
      // Get actual count from businesses table (in case search was cancelled)
      const stats = db.getSearchStats(search.id);
      const actualCount = stats.total_businesses || 0;

      // Calculate approximate file size based on actual number of businesses saved
      const estimatedSize = actualCount * 200; // Rough estimate: 200 bytes per business

      return {
        name: search.filename,
        size: estimatedSize,
        created: new Date(search.created_at),
        modified: new Date(search.completed_at || search.created_at),
        status: search.status,
        totalResults: actualCount
      };
    });

    res.json({
      success: true,
      files: fileDetails,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// delete a file (from database)
app.delete("/api/files/:format/:filename", (req, res) => {
  const { format, filename } = req.params;

  try {
    const deleted = db.deleteSearch(filename);

    if (deleted) {
      // Also try to delete the physical file if it exists
      const directory = format === "json" ? "json_results" : "csv_results";
      const filePath = path.join(__dirname, directory, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      res.json({
        success: true,
        message: `File ${filename} deleted successfully`,
      });
    } else {
      res.status(404).json({
        success: false,
        error: "File not found",
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// cancel an ongoing search
app.post("/api/cancel", (req, res) => {
  if (searchStatus.isRunning) {
    searchStatus.isRunning = false;
    searchStatus.statusMessage = "Search cancelled by user";
    res.json({
      success: true,
      message: "Search cancelled",
      status: searchStatus,
    });
  } else {
    res.json({
      success: false,
      message: "No search is running",
      status: searchStatus,
    });
  }
});

// catch all other routes and redirect to login
app.use((req, res, next) => {
  // Skip for API or static file routes
  if (req.url.startsWith("/api/") || 
      req.url.startsWith("/download/") || 
      req.url.includes(".") ||
      req.method !== "GET") {
    return next();
  }

  // if no matching route was found, default to login page
  res.redirect("/login");
});

app.listen(port, () => {
  console.log(`YellowPages Scraper Web Interface running on port ${port}`);
  console.log(`Access the app at: http://localhost:${port} (locally)`);

  // if we're on Render, show the external URL too
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`Deployed at: ${process.env.RENDER_EXTERNAL_URL}`);
  }
});