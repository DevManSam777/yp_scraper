const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");

// import the scraper class
const YellowPagesPuppeteerScraper = require("./puppeteer-scraper-module");

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

  const { query, location, numResults, saveFormat } = req.body;

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
    try {
      // create a new instance of the scraper
      const scraper = new YellowPagesPuppeteerScraper(updateSearchStatus);

      // run the search
      updateSearchStatus("Connecting to YellowPages...");
      const businesses = await scraper.search(
        query,
        location,
        parseInt(numResults, 10)
      );

      // generate filename
      const filename = scraper.generateFilename(query, location, saveFormat);
      const filePath =
        saveFormat === "json"
          ? path.join(scraper.jsonDir, filename)
          : path.join(scraper.csvDir, filename);

      // save the results
      updateSearchStatus(
        `Saving ${businesses.length} results to ${filename}...`
      );
      if (saveFormat === "json") {
        scraper.exportToJSON(businesses, filename, false);
      } else {
        scraper.exportToCSV(businesses, filename, false);
      }

      // complete the search
      searchStatus.isRunning = false;
      searchStatus.progress = 100;
      searchStatus.statusMessage = `Search completed. Found ${businesses.length} businesses.`;
      searchStatus.currentFile = { name: filename, format: saveFormat };
    } catch (error) {
      searchStatus.isRunning = false;
      searchStatus.error = error.message;
      searchStatus.statusMessage = `Error: ${error.message}`;
      console.error("Search error:", error);
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

// API endpoint to get search results
app.get("/api/results/:format/:filename", (req, res) => {
  const { format, filename } = req.params;
  const directory = format === "json" ? "json_results" : "csv_results";
  const filePath = path.join(__dirname, directory, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      success: false,
      error: "File not found",
    });
  }

  try {
    if (format === "json") {
      const data = fs.readFileSync(filePath, "utf8");
      const json = JSON.parse(data);
      res.json({
        success: true,
        totalResults: json.length,
        results: json,
      });
    } else {
      res.sendFile(filePath);
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// handle file downloads
app.get("/download/:format/:filename", (req, res) => {
  const { format, filename } = req.params;
  const directory = format === "json" ? "json_results" : "csv_results";
  const filePath = path.join(__dirname, directory, filename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send("File not found");
  }
});

// list available files
app.get("/api/files/:format", (req, res) => {
  const { format } = req.params;
  const directory = format === "json" ? "json_results" : "csv_results";
  const dirPath = path.join(__dirname, directory);

  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const files = fs.readdirSync(dirPath);

    // get file details
    const fileDetails = files
      .filter((file) => file.endsWith(`.${format}`) && !file.startsWith("."))
      .map((file) => {
        const stats = fs.statSync(path.join(dirPath, file));
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
        };
      })
      .sort((a, b) => b.modified - a.modified); // Sort by modified date, newest first

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

// delete a file
app.delete("/api/files/:format/:filename", (req, res) => {
  const { format, filename } = req.params;
  const directory = format === "json" ? "json_results" : "csv_results";
  const filePath = path.join(__dirname, directory, filename);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
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