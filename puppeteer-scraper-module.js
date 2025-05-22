const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const fs = require("fs");
const path = require("path");

class YellowPagesPuppeteerScraper {
  constructor(statusCallback = null) {
    this.baseUrl = "https://www.yellowpages.com";
    this.resultsPerPage = 30; // yellowPages typically shows 30 results per page
    this.maxRetries = 3; // max retries per page if blocked
    this.retryDelayMs = 5000; //  delay between retries (for blocking on a single page)
    this.maxResultsLimit = 1000; // set an upper limit on the total number of results to collect
    this.jsonDir = "json_results";
    this.csvDir = "csv_results";
    this.statusCallback = statusCallback; // function to report status updates
    this.headlessMode = true; // set to false to see the browser by default

    // create directories if they don't exist
    this.ensureDirectoriesExist();
  }

  // create necessary directories for storing results
  ensureDirectoriesExist() {
    const dirs = [this.jsonDir, this.csvDir];

    dirs.forEach((dir) => {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`Created directory: ${dir}`);
        } catch (error) {
          console.error(`Error creating directory ${dir}: ${error.message}`);
        }
      }
    });
  }

  parsePhone(phoneText) {
    if (!phoneText) return "";
    let phone = phoneText.replace(/[^\d-()]/g, "");
    return phone;
  }

  parseAddress(addressText) {
    if (!addressText)
      return { streetAddress: "", city: "", state: "", zipCode: "" };

    const stateZipPattern = /\b([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;
    const stateZipMatch = addressText.match(stateZipPattern);

    let state = "";
    let zipCode = "";
    let beforeStateZip = addressText;

    if (stateZipMatch) {
      state = stateZipMatch[1];
      zipCode = stateZipMatch[2];
      beforeStateZip = addressText.substring(0, stateZipMatch.index).trim();
    }

    beforeStateZip = beforeStateZip.replace(/,\s*$/, "");

    let streetAddress = "";
    let city = "";

    const cityPattern = /(.+?)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)$/;
    const cityMatch = beforeStateZip.match(cityPattern);

    if (cityMatch) {
      streetAddress = cityMatch[1].trim();
      city = cityMatch[2].trim();
    } else {
      streetAddress = beforeStateZip;
      city = "";
    }

    return { streetAddress, city, state, zipCode };
  }

  createPageUrl(query, location, pageNum) {
    const params = new URLSearchParams({
      search_terms: query,
      geo_location_terms: location,
    });

    if (pageNum > 1) {
      params.append("page", pageNum.toString());
    }

    return `${this.baseUrl}/search?${params.toString()}`;
  }

  // add delay needed for retries within a page load and between pages
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async scrapePageWithRetries(page, url, pageNumber) {
    // update status if callback provided
    if (this.statusCallback) {
      this.statusCallback(`Processing page ${pageNumber}...`);
    }

    let attempts = 0;
    while (attempts < this.maxRetries) {
      console.log(
        `Page ${pageNumber}: Loading ${url} (Attempt ${attempts + 1})`
      );

      try {
        // configure page headers (stealth plugin handles many other properties)
        await page.setExtraHTTPHeaders({
          "Accept-Language": "en-US,en;q=0.9",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
          "Upgrade-Insecure-Requests": "1",
          DNT: "1", // Do Not Track header
        });

        // navigate to page
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 75000,
        });

        // check response status code
        if (!response) {
          throw new Error("Navigation failed: No response received.");
        }

        const status = response.status();
        console.log(`Page ${pageNumber}: HTTP Status ${status}`);

        if (status === 404) {
          console.log(
            `Page ${pageNumber}: Received 404 Not Found. Assuming no more results.`
          );
          return []; // explicit 404 means no more pages
        }

        if (status >= 400) {
          // treat other >= 400 status codes as potential blocks for retries
          if (status !== 404) {
            // Don't retry 404
            throw new Error(`Potentially blocked by status code: ${status}`);
          }
        }

        // check if blocked by content -> do this after checking status
        const isBlocked = await page.evaluate(() => {
          const text = document.body.textContent.toLowerCase();
          // checks based on potential Yellow Pages blocking indicators
          return (
            text.includes("unusual activity detected") ||
            text.includes("robot check") ||
            document.querySelector('iframe[title="reCAPTCHA"]')
          ); // look for the reCAPTCHA iframe
        });

        if (isBlocked) {
          throw new Error("Blocked by content or captcha detection");
        }

        // wait for results to load
        try {
          // increased timeout and trying a broader selector as a starting point
          await page.waitForSelector(".search-results", { timeout: 60000 });
          // then wait for the actual result elements within the search results
          await page.waitForSelector(
            ".search-results .result, .search-results article",
            { timeout: 30000 }
          );
        } catch (e) {
          // if result selector not found, check if there's a "no results" message
          const noResults = await page.evaluate(() => {
            const text = document.body.textContent.toLowerCase();
            return (
              text.includes("no results found") ||
              text.includes("did not find any")
            );
          });

          if (noResults) {
            console.log(
              `Page ${pageNumber}: Explicitly found 'no results' message.`
            );
            return []; // no results found on this page
          } else {
            // if no results selector and no explicit no results message, log timeout/error
            console.log(
              `Page ${pageNumber}: Timed out waiting for result selector. Could be empty or blocked differently.`
            );
            return []; // assume no results for this page if selector times out
          }
        }

        const pageBusinesses = await page.evaluate(() => {
          const businesses = [];
          // broad selector that covers common result containers
          const elements = document.querySelectorAll(
            ".search-results .result, .search-results article"
          );

          elements.forEach((element, index) => {
            const business = {};

            // try multiple name selectors
            const nameEl = element.querySelector(
              ".business-name, h2.n, .business h2, .name, h3"
            );
            let businessName = nameEl ? nameEl.textContent.trim() : "";
            businessName = businessName.replace(/^\d+\.\s*/, "");
            business.businessName = businessName;

            // if no name found, skip this entry - Crucial for filtering
            if (!businessName) return;

            // get categories
            const categories = [];
            const categoryEls = element.querySelectorAll(
              ".categories a, .business-categories a, .category"
            );
            categoryEls.forEach((cat) => {
              if (cat.textContent.trim()) {
                categories.push(cat.textContent.trim());
              }
            });
            business.businessType = categories.join(", ");

            // get phone number
            const phoneEl = element.querySelector(
              '.phones, a[href^="tel:"], .business-phone, .phone'
            );
            let phoneText = phoneEl ? phoneEl.textContent.trim() : "";
            if (phoneEl && phoneEl.hasAttribute("href")) {
              phoneText = phoneEl.getAttribute("href").replace("tel:", "");
            }
            business.phoneText = phoneText;

            // get website
            const websiteEls = element.querySelectorAll("a");
            let website = "";
            // check links within the specific result element
            for (let link of websiteEls) {
              const href = link.getAttribute("href");
              // check for valid website links
              if (
                href &&
                !href.includes("yellowpages.com") &&
                !href.includes("javascript:") &&
                !href.startsWith("tel:") &&
                !href.startsWith("#") &&
                (href.startsWith("http") || href.startsWith("https")) &&
                href.split("/").filter(Boolean).length > 1 
              ) {
                website = href;
                break;
              }
            }
            business.website = website;

            const streetEl = element.querySelector(
              ".street-address, .adr, .address"
            );
            const localityEl = element.querySelector(".locality, .city");

            const street = streetEl ? streetEl.textContent.trim() : "";
            const locality = localityEl ? localityEl.textContent.trim() : "";

            business.fullAddress =
              street && locality
                ? `${street}, ${locality}`
                : street || locality;
            businesses.push(business);
          });

          return businesses;
        });

        console.log(
          `Page ${pageNumber}: Found ${pageBusinesses.length} potential business elements`
        );

        // filter out entries where businessName is still empty after evaluation
        const validBusinesses = pageBusinesses.filter((b) => b.businessName);
        console.log(
          `Page ${pageNumber}: Found ${validBusinesses.length} valid businesses after filtering`
        );

        return validBusinesses; // success, return businesses
      } catch (error) {
        console.error(`Page ${pageNumber}: Error or Blocked -`, error.message);
        attempts++;

        // update status about retries, DON'T PASS PAGE OR BUSINESS COUNT
        if (this.statusCallback) {
          this.statusCallback(
            `Retry ${attempts}/${this.maxRetries} for page ${pageNumber}...`
          );
        }

        if (attempts < this.maxRetries) {
          console.log(
            `Page ${pageNumber}: Retrying in ${
              (this.retryDelayMs / 1000) * attempts
            } seconds...`
          );
          await this.delay(this.retryDelayMs * attempts); // increase delay on subsequent retries
        } else {
          console.log(
            `Page ${pageNumber}: Max retries reached (${this.maxRetries}). Skipping this page.`
          );
          return []; // max retries reached, return empty array
        }
      }
    }
    return []; // should not reach here if maxRetries is reached, but as a safeguard
  }

  // search function remains largely unchanged, except for the inter-page delay comment
  async search(query, location, targetResults) {
    let browser;
    const allBusinesses = [];
    let pageNum = 1;
    let continueScraping = true;

    // cap target results at the maximum limit
    const effectiveTargetResults = Math.min(
      targetResults,
      this.maxResultsLimit
    );

    // estimate max pages to scrape, add a buffer
    const estimatedMaxPages =
      Math.ceil(effectiveTargetResults / this.resultsPerPage) + 20;

    try {
      console.log("Launching browser...");

      // update status if callback provided, ONLY PASS MESSAGE
      if (this.statusCallback) {
        this.statusCallback("Launching browser...");
      }

      browser = await puppeteer.launch({
        headless: this.headlessMode ? "new" : false, // Use the boolean variable here
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--window-size=1920,1080", // set realistic window size
          "--disable-extensions",
          // stealth plugin handles many detection args
          "--enable-features=VaapiVideoDecoder", // mimic real browser features
          "--no-first-run", // don't show the first run experience
          "--no-default-browser-check", // don't check if it's the default browser
          "--disable-translate", // disable translate popup
          "--hide-scrollbars", // hide scrollbars
          "--incognito", // use incognito mode - good for isolation between page navigations
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
      });

      console.log(`Scraping for up to ${effectiveTargetResults} results...`);

      // update status if callback provided, ONLY PASS MESSAGE
      if (this.statusCallback) {
        this.statusCallback(`Searching for "${query}" in "${location}"...`);
      }

      while (
        allBusinesses.length < effectiveTargetResults &&
        pageNum <= estimatedMaxPages &&
        continueScraping
      ) {
        let page;
        try {
          page = await browser.newPage();
        } catch (newPageError) {
          console.error(`Failed to create a new page: ${newPageError.message}`);
          // if we can't even create a new page, something is seriously wrong, stop scraping.
          continueScraping = false;
          break;
        }

        const url = this.createPageUrl(query, location, pageNum);

        // this calls the scrapePageWithRetries function, which has its own retry delays
        const businessesOnPage = await this.scrapePageWithRetries(
          page,
          url,
          pageNum
        );

        // IMPORTANT!!! always close the page after you're done with it
        if (page && !page.isClosed()) {
          await page.close();
        }

        if (businessesOnPage.length > 0) {
          businessesOnPage.forEach((business) => {
            const phone = this.parsePhone(business.phoneText);
            const addressComponents = this.parseAddress(business.fullAddress);

            // simple duplicate check based on name and either phone or street address
            const isDuplicate = allBusinesses.some(
              (existing) =>
                existing.businessName === business.businessName &&
                (existing.phone === phone ||
                  (existing.streetAddress === addressComponents.streetAddress &&
                    addressComponents.streetAddress !== ""))
            );

            if (!isDuplicate && business.businessName) {
              allBusinesses.push({
                businessName: business.businessName,
                businessType: business.businessType,
                phone: phone,
                website: business.website,
                streetAddress: addressComponents.streetAddress,
                city: addressComponents.city,
                state: addressComponents.state,
                zipCode: addressComponents.zipCode,
              });
            }
          });
          console.log(
            `Current total unique businesses collected: ${allBusinesses.length}`
          );

          // update status if callback provided, PASS PAGE AND BUSINESS COUNT
          if (this.statusCallback) {
            this.statusCallback(
              `Found ${allBusinesses.length} businesses so far...`,
              pageNum,
              allBusinesses.length
            );
          }
        } else {
          // if a page yields no results even after retries, assume no more results
          console.log(
            `Page ${pageNum} yielded no businesses after retries. Stopping.`
          );
          continueScraping = false;
        }

        // inter-page delay
        if (
          continueScraping &&
          allBusinesses.length < effectiveTargetResults &&
          pageNum < estimatedMaxPages
        ) {
          const pageDelay = 2500 + Math.random() * 2500;
          const startTime = Date.now();
          console.log(
            `Waiting ${
              pageDelay / 1000
            } seconds before next page... (Start Time: ${startTime})`
          );
          await this.delay(pageDelay); // ensure we're calling custom delay function
          const endTime = Date.now();
          const actualDelay = endTime - startTime;
          console.log(
            `Delay ended. Actual delay: ${actualDelay / 1000} seconds.`
          );
        }
        // console.log("Inter-page delay commented out.  If queries begin failing, uncomment it in puppeteer-scraper-module.js and uncomment inter-page delay console log in puppeteer-scraper-cli.js");

        pageNum++; // move to the next page
      }

      if (allBusinesses.length >= effectiveTargetResults) {
        console.log(`Target of ${effectiveTargetResults} results reached.`);
      } else if (pageNum > estimatedMaxPages) {
        console.log(
          `Reached estimated maximum pages (${estimatedMaxPages}) before hitting target results.`
        );
      } else if (!continueScraping) {
        console.log(`Stopped scraping because a page yielded no businesses.`);
      }

      // trim collected results if we exceeded the target slightly due to page-based collection
      if (allBusinesses.length > effectiveTargetResults) {
        console.log(
          `Trimmed results from ${allBusinesses.length} to target ${effectiveTargetResults}.`
        );
        allBusinesses.length = effectiveTargetResults;
      }

      return allBusinesses;
    } catch (error) {
      console.error("Error in search:", error);

      // update status if callback provided
      if (this.statusCallback) {
        this.statusCallback(`Error: ${error.message}`, 0, 0, error.message);
      }

      return allBusinesses; // return collected businesses even on error
    } finally {
      if (browser) {
        await browser.close();
      }
      console.log("Browser closed.");
    }
  }

  // generate a filename with query, location, and date
  generateFilename(query, location, extension) {
    // clean query and location for filename
    const cleanQuery = query
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, "_");
    const cleanLocation = location
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, "")
      .replace(/\s+/g, "_");

    // get current date in MM_DD_YYYY format
    const date = new Date();
    const formattedDate = `${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}_${String(date.getDate()).padStart(2, "0")}_${date.getFullYear()}`;

    // return just the filename without directory path
    return `${cleanQuery}_${cleanLocation}_${formattedDate}.${extension}`;
  }

  // get full path for a file based on extension
  getFilePath(filename, extension) {
    const directory = extension === "json" ? this.jsonDir : this.csvDir;
    return path.join(directory, filename);
  }

  // list all existing result files in the appropriate directory
  listExistingFiles(extension) {
    try {
      // select the appropriate directory based on file extension
      const directory = extension === "json" ? this.jsonDir : this.csvDir;

      // check if directory exists
      if (!fs.existsSync(directory)) {
        console.log(`Directory ${directory} does not exist. Creating it.`);
        fs.mkdirSync(directory, { recursive: true });
        return [];
      }

      // get all files in the directory
      const files = fs.readdirSync(directory);

      // filter to only include files with the correct extension
      return files
        .filter(
          (file) =>
            file.endsWith(`.${extension}`) &&
            !file.startsWith(".") &&
            fs.statSync(path.join(directory, file)).isFile()
        )
        .sort();
    } catch (error) {console.error(`Error listing files: ${error.message}`);
    return [];
  }
}

loadExistingResults(filename, extension) {
  try {
    // get the full file path including the appropriate directory
    const directory = extension === "json" ? this.jsonDir : this.csvDir;
    const fullPath = path.join(directory, filename);

    if (fs.existsSync(fullPath)) {
      // for JSON files, parse the content
      if (extension === "json") {
        const data = fs.readFileSync(fullPath, "utf8");

        // check if the file is empty or contains only whitespace
        if (!data || data.trim() === "") {
          console.log(
            `Existing results file '${filename}' is empty or contains only whitespace.`
          );
          return []; // return empty array if file is empty
        }

        const json = JSON.parse(data);

        // ensure the parsed data is an array
        if (!Array.isArray(json)) {
          console.log(
            `Existing results file '${filename}' does not contain a valid JSON array. Starting fresh.`
          );
          return []; // if not a valid array, treat as invalid and return empty
        }

        console.log(
          `Loaded ${json.length} existing results from '${filename}'.`
        );
        return json; // return the parsed array
      }

      // for CSV files, indicate that the file exists but return empty array
      // since we'll handle CSV appending differently
      console.log(`Found existing CSV file '${filename}'.`);
      return [];
    } else {
      console.log(
        `Existing results file '${filename}' not found. Starting fresh.`
      );
      return []; // return empty array if file doesn't exist
    }
  } catch (error) {
    console.log(
      `Error loading existing results from '${filename}': ${error.message}. Starting fresh.`
    );
    return []; // return empty array on any parsing or reading error
  }
}

mergeResults(existing, newResults) {
  // ensure existing is an array before proceeding
  const merged = Array.isArray(existing) ? [...existing] : [];

  // create a unique key set using a combination of key fields for existing data
  // ensure consistent fields are used for generating keys for existing data
  const existingSet = new Set(
    merged.map((b) => {
      // use parsed/cleaned data for consistency
      const phone = this.parsePhone(b.phoneText || b.phone); // Try both potential phone fields
      const addressComponents = this.parseAddress(
        b.fullAddress || `${b.streetAddress}, ${b.city}`
      ); // Try both potential address fields
      return `${b.businessName}-${phone}-${addressComponents.streetAddress}`.toLowerCase();
    })
  );

  let addedCount = 0;
  const uniqueNewResults = []; // Use a temporary array to collect unique new results

  newResults.forEach((newBusiness) => {
    // ensure parsed fields are available for key generation for new business
    const phone = this.parsePhone(newBusiness.phoneText || newBusiness.phone);
    const addressComponents = this.parseAddress(
      newBusiness.fullAddress ||
        `${newBusiness.streetAddress}, ${newBusiness.city}`
    );

    // create a unique key for the new business using consistent parsed fields
    const key =
      `${newBusiness.businessName}-${phone}-${addressComponents.streetAddress}`.toLowerCase();

    // check for duplicates based on the unique key and ensure business name exists
    // only add if not a duplicate AND has a business name
    if (newBusiness.businessName && !existingSet.has(key)) {
      // add the business with parsed/cleaned up fields to the unique new results list
      uniqueNewResults.push({
        businessName: newBusiness.businessName,
        businessType: newBusiness.businessType,
        phone: phone,
        website: newBusiness.website,
        streetAddress: addressComponents.streetAddress,
        city: addressComponents.city,
        state: addressComponents.state,
        zipCode: addressComponents.zipCode,
      });
      existingSet.add(key); // check against subsequent new results in the same batch
      addedCount++;
    }
  });

  // concatenate the unique new results to the merged array
  merged.push(...uniqueNewResults);

  console.log(`Merged ${addedCount} new unique businesses.`);
  return merged; // return the combined array
}

exportToJSON(businesses, filename, append = false) {
  // get the full path for the file
  const fullPath = path.join(this.jsonDir, filename);
  let finalBusinesses = businesses;

  if (append) {
    // load existing data first
    const existing = this.loadExistingResults(filename, "json");
    // then merge the new businesses with the existing ones
    finalBusinesses = this.mergeResults(existing, businesses);
  }

  // sort businesses alphabetically by business name
  finalBusinesses.sort((a, b) => {
    // use localeCompare for alphabetical sorting
    // this handles case sensitivity and special characters properly
    return (a.businessName || "").localeCompare(b.businessName || "");
  });

  const jsonContent = JSON.stringify(finalBusinesses, null, 2);

  try {
    // make sure the directory exists
    if (!fs.existsSync(this.jsonDir)) {
      fs.mkdirSync(this.jsonDir, { recursive: true });
    }

    // write the file
    fs.writeFileSync(fullPath, jsonContent, "utf8");
    console.log(
      `Results saved to '${filename}' in ${this.jsonDir} directory (Total: ${finalBusinesses.length} businesses)`
    );
  } catch (error) {
    console.error(`Error writing JSON file '${filename}': ${error.message}`);
  }
}


exportToCSV(businesses, filename, append = false) {
  const headers = [
    "Business Name",
    "Business Type",
    "Phone",
    "Website",
    "Street Address",
    "City",
    "State",
    "ZIP Code",
  ];

  // get the full path for the file
  const fullPath = path.join(this.csvDir, filename);
  const fileExists = fs.existsSync(fullPath);
  
  // for appending to existing file, we need to read the existing content
  let existingBusinesses = [];
  if (append && fileExists) {
    try {
      const existingContent = fs.readFileSync(fullPath, 'utf8');
      const lines = existingContent.split('\n').filter(line => line.trim());
      
      // skip header row
      if (lines.length > 1) {
        for (let i = 1; i < lines.length; i++) {
          const cells = this.parseCSVLine(lines[i]);
          if (cells.length >= headers.length) {
            existingBusinesses.push({
              businessName: cells[0].replace(/^"(.*)"$/, "$1"),
              businessType: cells[1].replace(/^"(.*)"$/, "$1"),
              phone: cells[2].replace(/^"(.*)"$/, "$1"),
              website: cells[3].replace(/^"(.*)"$/, "$1"),
              streetAddress: cells[4].replace(/^"(.*)"$/, "$1"),
              city: cells[5].replace(/^"(.*)"$/, "$1"),
              state: cells[6].replace(/^"(.*)"$/, "$1"),
              zipCode: cells[7].replace(/^"(.*)"$/, "$1")
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error reading existing CSV file: ${error.message}`);
      // continue with empty existing businesses if there's an error
    }
  }
  
  // combine businesses and sort alphabetically
  let finalBusinesses = [...businesses];
  if (append && existingBusinesses.length > 0) {
    // merge without duplicates (simple merge, not using mergeResults)
    const businessNameSet = new Set(finalBusinesses.map(b => b.businessName));
    existingBusinesses.forEach(b => {
      if (!businessNameSet.has(b.businessName)) {
        finalBusinesses.push(b);
        businessNameSet.add(b.businessName);
      }
    });
  }
  
  // sort businesses alphabetically by business name
  finalBusinesses.sort((a, b) => {
    return (a.businessName || "").localeCompare(b.businessName || "");
  });

  // create CSV content with headers
  let csvContent = headers.join(",") + "\n";

  // add sorted business data
  finalBusinesses.forEach((business) => {
    const row = [
      this.escapeCSV(business.businessName || ""),
      this.escapeCSV(business.businessType || ""),
      this.escapeCSV(business.phone || ""),
      this.escapeCSV(business.website || ""),
      this.escapeCSV(business.streetAddress || ""),
      this.escapeCSV(business.city || ""),
      this.escapeCSV(business.state || ""),
      this.escapeCSV(business.zipCode || ""),
    ];

    csvContent += row.join(",") + "\n";
  });

  try {
    // make sure the directory exists
    if (!fs.existsSync(this.csvDir)) {
      fs.mkdirSync(this.csvDir, { recursive: true });
    }

    // write the full file with headers (not appending)
    fs.writeFileSync(fullPath, csvContent, "utf8");
    console.log(
      `Results saved to '${filename}' in ${this.csvDir} directory (Total: ${finalBusinesses.length} businesses)`
    );
  } catch (error) {
    console.error(`Error writing CSV file '${filename}': ${error.message}`);
  }
}

// add a helper function to parse CSV lines
parseCSVLine(line) {
  const result = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      // handle quotes
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // escaped quote inside a quoted field
        cell += '"';
        i++; // Skip the next quote
      } else {
        // toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // end of cell
      result.push(cell);
      cell = "";
    } else {
      // add character to current cell
      cell += char;
    }
  }

  // add the last cell
  result.push(cell);
  return result;
}

escapeCSV(value) {
  if (value === null || value === undefined) return '""'; // handle null or undefined
  const stringValue = String(value);
  // check if value contains comma, double quote, newline, or starts/ends with whitespace
  if (/[,"\n]/.test(stringValue) || stringValue.trim() !== stringValue) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}
}

module.exports = YellowPagesPuppeteerScraper;