const readline = require("readline");
const YellowPagesPuppeteerScraper = require("./puppeteer-scraper-module");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

// main function
async function main() {
  console.log("\n========================================");
  console.log("                                          ");
  console.log("   🍕    YellowPages Web Scraper    🍕");
  console.log("                                          ");
  console.log("========================================\n");

  const scraper = new YellowPagesPuppeteerScraper();

  try {
    const query = await question(
      "What are you looking for? (e.g., pizza, kung-fu lessons): "
    );
    const location = await question("Where? (e.g., 90210, Los Angeles, CA): ");

    const defaultResults = 30;
    const targetResultsInput = await question(
      `How many results do you want to collect? (e.g., 10, Max: ${scraper.maxResultsLimit}): `
    );

    let targetResults;
    if (!targetResultsInput.trim()) {
      targetResults = defaultResults;
      console.log(
        `No number specified, using default of ${defaultResults} results.`
      );
    } else {
      targetResults = parseInt(targetResultsInput, 10);
      if (isNaN(targetResults) || targetResults <= 0) {
        console.log(
          "Invalid input. Please enter a positive number or press Enter for default."
        );
        rl.close();
        return;
      }
    }

    if (targetResults > scraper.maxResultsLimit) {
      console.log(
        `Requested results (${targetResults}) exceed the maximum limit (${scraper.maxResultsLimit}). The search will be capped at ${scraper.maxResultsLimit}.`
      );
    }

    console.log(
      `\nStarting scrape for "${query}" in "${location}" targeting ${Math.min(
        targetResults,
        scraper.maxResultsLimit
      )} results...\n`
    );

    // Inter-page delay log
    console.log(
      `Using inter-page delays of ${2500 / 1000}-${5000 / 1000} seconds.`
    );

    const businesses = await scraper.search(query, location, targetResults);

    if (businesses.length === 0) {
      console.log("\nNo results found.");
      rl.close();
      return;
    }

    console.log(`\nCollected ${businesses.length} businesses:`);
    console.log("==========================================");

    const displayLimit = Math.min(businesses.length, 10);
    console.log(`Displaying the first ${displayLimit} results:`);
    businesses.slice(0, displayLimit).forEach((business, index) => {
      console.log(`${index + 1}. ${business.businessName}`);
      console.log(`   Type: ${business.businessType}`);
      console.log(`   Phone: ${business.phone}`);
      if (business.website) console.log(`   Website: ${business.website}`);
      console.log(`   Address: ${business.streetAddress}`);
      console.log(
        `            ${business.city}, ${business.state} ${business.zipCode}`
      );
      console.log("------------------------------------------");
    });

    if (businesses.length > displayLimit) {
      console.log(`... and ${businesses.length - displayLimit} more results.`);
    }

    // generate default filenames
    const jsonFilename = scraper.generateFilename(query, location, "json");
    const csvFilename = scraper.generateFilename(query, location, "csv");

    console.log("\nSave options:");
    console.log(
      `1. Save as JSON (new file: ${jsonFilename} in ${scraper.jsonDir} directory)`
    );
    console.log(
      `2. Save as JSON (choose existing file to append in ${scraper.jsonDir} directory)`
    );
    console.log(
      `3. Save as CSV (new file: ${csvFilename} in ${scraper.csvDir} directory)`
    );
    console.log(
      `4. Save as CSV (choose existing file to append in ${scraper.csvDir} directory)`
    );
    console.log("5. Don't save");

    const saveOption = await question("\nChoose an option (1-5): ");

    let selectedFile = "";

    switch (saveOption) {
      case "1":
        // save as new JSON file with generated filename
        scraper.exportToJSON(businesses, jsonFilename, false);
        break;
      case "2":
        // list existing JSON files and let user choose one to append to
        const jsonFiles = scraper.listExistingFiles("json");

        if (jsonFiles.length === 0) {
          console.log(
            `No existing JSON files found in ${scraper.jsonDir} directory. Creating new file instead.`
          );
          scraper.exportToJSON(businesses, jsonFilename, false);
          break;
        }

        console.log(`\nExisting JSON files in ${scraper.jsonDir} directory:`);
        jsonFiles.forEach((file, index) => {
          console.log(`${index + 1}. ${file}`);
        });
        console.log(`${jsonFiles.length + 1}. Use new file (${jsonFilename})`);

        const jsonFileChoice = await question(
          `\nChoose a file (1-${jsonFiles.length + 1}): `
        );
        const jsonFileIndex = parseInt(jsonFileChoice, 10) - 1;

        if (jsonFileIndex >= 0 && jsonFileIndex < jsonFiles.length) {
          selectedFile = jsonFiles[jsonFileIndex];
          scraper.exportToJSON(businesses, selectedFile, true);
        } else {
          // default to new file if invalid choice
          console.log(`Using new file: ${jsonFilename}`);
          scraper.exportToJSON(businesses, jsonFilename, false);
        }
        break;
      case "3":
        // save as new CSV file with generated filename
        scraper.exportToCSV(businesses, csvFilename, false);
        break;
      case "4":
        // list existing CSV files and let user choose one to append to
        const csvFiles = scraper.listExistingFiles("csv");

        if (csvFiles.length === 0) {
          console.log(
            `No existing CSV files found in ${scraper.csvDir} directory. Creating new file instead.`
          );
          scraper.exportToCSV(businesses, csvFilename, false);
          break;
        }

        console.log(`\nExisting CSV files in ${scraper.csvDir} directory:`);
        csvFiles.forEach((file, index) => {
          console.log(`${index + 1}. ${file}`);
        });
        console.log(`${csvFiles.length + 1}. Use new file (${csvFilename})`);

        const csvFileChoice = await question(
          `\nChoose a file (1-${csvFiles.length + 1}): `
        );
        const csvFileIndex = parseInt(csvFileChoice, 10) - 1;

        if (csvFileIndex >= 0 && csvFileIndex < csvFiles.length) {
          selectedFile = csvFiles[csvFileIndex];
          scraper.exportToCSV(businesses, selectedFile, true);
        } else {
          // default to new file if invalid choice
          console.log(`Using new file: ${csvFilename}`);
          scraper.exportToCSV(businesses, csvFilename, false);
        }
        break;
      case "5":
        console.log("Not saving.");
        break;
      default:
        console.log("Invalid option. Not saving.");
    }
  } catch (error) {
    console.error("An unexpected error occurred:", error.message);
  } finally {
    rl.close();
  }
}

main();
