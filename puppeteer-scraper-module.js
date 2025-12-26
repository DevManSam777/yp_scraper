const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

class YellowPagesPuppeteerScraper {
  constructor(options = {}) {
    // Accept either options object OR statusCallback for backwards compatibility
    if (typeof options === 'function') {
      // Old style: new YellowPagesPuppeteerScraper(statusCallback)
      this.options = {
        headless: true,
        delay: 2000,
        maxRetries: 3,
        resultsLimit: 1000
      };
      this.statusCallback = options;
    } else {
      // New style: new YellowPagesPuppeteerScraper({ headless: true, ... })
      this.options = {
        headless: true,
        delay: 2000,
        maxRetries: 3,
        resultsLimit: 1000,
        ...options
      };
      this.statusCallback = null;
    }

    this.browser = null;
    this.page = null;
    this.results = [];

    // For backwards compatibility with old GUI code
    this.jsonDir = 'json_results';
    this.csvDir = 'csv_results';
    this.ensureDirectoriesExist();
  }

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

  async initialize() {
    try {
      const launchOptions = {
        headless: this.options.headless ? "new" : false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-extensions',
          '--enable-features=VaapiVideoDecoder',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-translate',
          '--hide-scrollbars',
          '--incognito'
        ]
      };

      // Use system Chrome in Docker or local Chrome on macOS
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
      } else if (process.platform === 'darwin') {
        launchOptions.executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      }

      this.browser = await puppeteer.launch(launchOptions);

      return true;
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      return false;
    }
  }

  async search(searchTerm, location, statusCallbackOrLimit = null) {
    // Handle old signature: search(term, location, targetResults)
    // and new signature: search(term, location, statusCallback)
    let statusCallback = this.statusCallback;
    let targetResults = this.options.resultsLimit;

    if (typeof statusCallbackOrLimit === 'function') {
      statusCallback = statusCallbackOrLimit;
    } else if (typeof statusCallbackOrLimit === 'number') {
      targetResults = statusCallbackOrLimit;
    }

    try {
      if (!this.browser) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize browser');
        }
      }

      this.results = [];
      let currentPage = 1;
      let hasMorePages = true;

      while (hasMorePages && this.results.length < targetResults) {
        if (statusCallback) {
          statusCallback(`Scraping page ${currentPage}...`, currentPage, this.results.length);
        }

        const pageResults = await this.scrapePageWithRetries(searchTerm, location, currentPage);

        if (pageResults.length === 0) {
          hasMorePages = false;
        } else {
          this.results = this.results.concat(pageResults);

          if (statusCallback) {
            statusCallback(`Found ${this.results.length} businesses so far...`, currentPage, this.results.length);
          }

          currentPage++;

          // Random delay between pages
          if (hasMorePages && this.results.length < targetResults) {
            const pageDelay = 2500 + Math.random() * 2500; // 2.5-5 seconds
            await this.delay(pageDelay);
          }
        }

        // Safety check to prevent infinite loops
        if (currentPage > 100) {
          break;
        }
      }

      return this.removeDuplicates(this.results);
    } catch (error) {
      console.error('Search failed:', error);
      throw error;
    }
  }

  async scrapePageWithRetries(searchTerm, location, pageNumber) {
    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        return await this.scrapePage(searchTerm, location, pageNumber);
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);

        if (attempt === this.options.maxRetries) {
          throw error;
        }

        // Exponential backoff with randomization
        const baseDelay = 5000 * attempt;
        const randomDelay = baseDelay + Math.random() * baseDelay;
        await this.delay(randomDelay);
      }
    }
    return [];
  }

  async scrapePage(searchTerm, location, pageNumber) {
    const url = this.createPageUrl(searchTerm, location, pageNumber);

    console.log(`Scraping URL: ${url}`);

    // Create a new page for this request
    const page = await this.browser.newPage();

    try {
      // Set headers for this page
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        DNT: "1",
      });

      // Set User Agent for this page
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Check for Cloudflare blocking first
      const isBlocked = await page.evaluate(() => {
        const text = document.body.textContent.toLowerCase();
        return (
          text.includes("just a moment") ||
          text.includes("checking your browser") ||
          text.includes("cloudflare") ||
          text.includes("unusual activity detected") ||
          text.includes("robot check") ||
          text.includes("verifying you are human") ||
          document.querySelector('iframe[title="reCAPTCHA"]') ||
          document.querySelector('#cf-wrapper') ||
          document.querySelector('.cf-browser-verification')
        );
      });

      if (isBlocked) {
        throw new Error("Blocked by Cloudflare or similar protection");
      }

      // Random delay instead of fixed
      const randomDelay = 2000 + Math.random() * 3000; // 2-5 seconds
      await this.delay(randomDelay);

      // Try multiple selectors for business results
      const possibleSelectors = [
        '.result',
        '.search-results .result',
        '.organic',
        '.business',
        '[data-testid="result"]',
        '.srp-listing',
        '.listing'
      ];

      let businessElements = [];
      let foundSelector = null;

      for (const selector of possibleSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          businessElements = await page.$$(selector);
          if (businessElements.length > 0) {
            foundSelector = selector;
            console.log(`Found ${businessElements.length} businesses using selector: ${selector}`);
            break;
          }
        } catch (error) {
          // Try next selector
        }
      }

      if (businessElements.length === 0) {
        console.log('No business elements found, trying to debug page content');

        // Log page title and some content for debugging
        const pageInfo = await page.evaluate(() => {
          return {
            title: document.title,
            url: window.location.href,
            bodyText: document.body.innerText.substring(0, 500),
            possibleBusinessElements: {
              resultCount: document.querySelectorAll('.result').length,
              organicCount: document.querySelectorAll('.organic').length,
              businessCount: document.querySelectorAll('.business').length,
              listingCount: document.querySelectorAll('.listing').length,
              srpCount: document.querySelectorAll('.srp-listing').length
            }
          };
        });

        console.log('Page debug info:', JSON.stringify(pageInfo, null, 2));
        return [];
      }

      const businesses = await page.evaluate((selector) => {
        // Enhanced parseAddress function with apartment/unit extraction
        const parseAddress = (addressText) => {
          if (!addressText)
            return { streetAddress: "", city: "", state: "", zipCode: "", aptUnit: "" };

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
          let aptUnit = "";

          const cityPattern = /(.+?)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)$/;
          const cityMatch = beforeStateZip.match(cityPattern);

          if (cityMatch) {
            let fullStreetAddress = cityMatch[1].trim().replace(/,$/, '').trim();
            city = cityMatch[2].trim();

            // Pattern for common unit types at the end
            const unitPattern = /^(.*?)\s+(apt|apartment|unit|ste|suite|fl|floor|rm|room|#)\s*([A-Za-z0-9\-]+)$/i;
            const unitMatch = fullStreetAddress.match(unitPattern);

            if (unitMatch) {
              streetAddress = unitMatch[1].trim().replace(/,$/, '').trim();
              aptUnit = `${unitMatch[2]} ${unitMatch[3]}`.trim();
            } else {
              streetAddress = fullStreetAddress;
            }

          } else {
            streetAddress = beforeStateZip;
            city = "";
          }

          return { streetAddress, city, state, zipCode, aptUnit };
        };

        const businessElements = document.querySelectorAll(selector || '.result');
        const results = [];

        businessElements.forEach(element => {
          try {
            const business = {};

            // Try multiple selectors for business name
            const nameSelectors = [
              '.business-name a',
              '.business-name',
              'h3 a',
              'h2 a',
              '.n',
              '[data-testid="business-name"]',
              '.business-title'
            ];

            let nameElement = null;
            for (const sel of nameSelectors) {
              nameElement = element.querySelector(sel);
              if (nameElement) break;
            }
            business.name = nameElement ? nameElement.textContent.trim() : '';

            // Try multiple selectors for phone number
            const phoneSelectors = [
              '.phones .phone',
              '.phone',
              '[data-testid="phone"]',
              '.contact-info .phone'
            ];

            let phoneElement = null;
            for (const sel of phoneSelectors) {
              phoneElement = element.querySelector(sel);
              if (phoneElement) break;
            }
            business.phone = phoneElement ? phoneElement.textContent.trim() : '';

            // Extract address components
            const streetEl = element.querySelector('.street-address, .adr, .address');
            const localityEl = element.querySelector('.locality, .city');

            const street = streetEl ? streetEl.textContent.trim() : '';
            const locality = localityEl ? localityEl.textContent.trim() : '';

            business.fullAddress = street && locality
              ? `${street}, ${locality}`
              : street || locality;

            // Parse address
            business.address = parseAddress(business.fullAddress);

            // Extract business categories/type
            const categories = [];
            const categorySelectors = [
              '.categories a',
              '.business-categories a',
              '.category',
              '.business-type',
              '.biz-categories a'
            ];

            categorySelectors.forEach(selector => {
              const categoryEls = element.querySelectorAll(selector);
              categoryEls.forEach((cat) => {
                if (cat.textContent.trim()) {
                  categories.push(cat.textContent.trim());
                }
              });
            });

            business.businessType = categories.join(', ');

            // Try multiple selectors for website
            const websiteSelectors = [
              '.track-visit-website',
              'a[href*="http"]',
              '.website'
            ];

            let websiteElement = null;
            for (const sel of websiteSelectors) {
              websiteElement = element.querySelector(sel);
              if (websiteElement && websiteElement.href && !websiteElement.href.includes('yellowpages.com')) {
                break;
              }
              websiteElement = null;
            }
            business.website = websiteElement ? websiteElement.href : '';

            // Only add if we have essential information
            if (business.name && (business.phone || (business.address && business.address.city))) {
              results.push(business);
            }
          } catch (error) {
            console.error('Error parsing business element:', error);
          }
        });

        return results;
      }, foundSelector);

      console.log(`Extracted ${businesses.length} businesses from page ${pageNumber}`);
      return this.formatBusinessData(businesses);

    } finally {
      // Always close the page
      if (page && !page.isClosed()) {
        await page.close();
      }
    }
  }

  createPageUrl(searchTerm, location, pageNumber) {
    const baseUrl = 'https://www.yellowpages.com/search';
    const encodedTerm = encodeURIComponent(searchTerm);
    const encodedLocation = encodeURIComponent(location);

    let url = `${baseUrl}?search_terms=${encodedTerm}&geo_location_terms=${encodedLocation}`;

    if (pageNumber > 1) {
      url += `&page=${pageNumber}`;
    }

    return url;
  }

  formatBusinessData(businesses) {
    return businesses.map(business => {
      // Return format compatible with old GUI (flat structure with some nested)
      return {
        businessName: business.name || '',
        businessType: business.businessType || '',
        phone: this.formatPhone(business.phone) || '',
        website: business.website || '',
        streetAddress: business.address?.streetAddress || '',
        city: business.address?.city || '',
        state: business.address?.state || '',
        zipCode: business.address?.zipCode || ''
      };
    });
  }

  formatPhone(phone) {
    if (!phone) return '';

    // Remove all non-digit characters
    const digits = phone.replace(/\D/g, '');

    // Format as (XXX) XXX-XXXX if 10 digits
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    return phone;
  }

  removeDuplicates(businesses) {
    const seen = new Map();
    const unique = [];

    businesses.forEach(business => {
      const key = `${business.businessName}-${business.phone}`.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, true);
        unique.push(business);
      }
    });

    return unique;
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  // Helper methods for GUI compatibility
  generateFilename(query, location, format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const sanitizedQuery = query.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const sanitizedLocation = location.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return `${sanitizedQuery}_${sanitizedLocation}_${timestamp}.${format}`;
  }

  exportToJSON(businesses, filename, log = true) {
    const jsonDir = path.join(__dirname, 'json_results');
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }

    const filePath = path.join(jsonDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(businesses, null, 2), 'utf8');

    if (log) {
      console.log(`JSON file saved: ${filePath}`);
    }
  }

  exportToCSV(businesses, filename, log = true) {
    const csvDir = path.join(__dirname, 'csv_results');
    if (!fs.existsSync(csvDir)) {
      fs.mkdirSync(csvDir, { recursive: true });
    }

    if (businesses.length === 0) {
      if (log) console.log('No businesses to export to CSV.');
      return;
    }

    const headers = Object.keys(businesses[0]);
    const csvRows = [headers.join(',')];

    for (const business of businesses) {
      const values = headers.map(header => {
        const value = business[header];
        const escaped = ('' + value).replace(/"/g, '""');
        return `"${escaped}"`;
      });
      csvRows.push(values.join(','));
    }

    const filePath = path.join(csvDir, filename);
    fs.writeFileSync(filePath, csvRows.join('\n'), 'utf8');

    if (log) {
      console.log(`CSV file saved: ${filePath}`);
    }
  }

  // For backwards compatibility with old code
  parsePhone(phoneText) {
    return this.formatPhone(phoneText);
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
}

module.exports = YellowPagesPuppeteerScraper;
