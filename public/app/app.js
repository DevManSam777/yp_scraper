const searchTabBtn = document.getElementById("searchTabBtn");
const resultsTabBtn = document.getElementById("resultsTabBtn");
const filesTabBtn = document.getElementById("filesTabBtn");
const searchTab = document.getElementById("searchTab");
const resultsTab = document.getElementById("resultsTab");
const filesTab = document.getElementById("filesTab");

const searchForm = document.getElementById("searchForm");
const searchBtn = document.getElementById("searchBtn");
const numResultsInput = document.getElementById("numResults");
const numResultsValue = document.getElementById("numResultsValue");
const cancelSearchBtn = document.getElementById("cancelSearchBtn");

const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const statusMessage = document.getElementById("statusMessage");

const resultsSummary = document.getElementById("resultsSummary");
const resultsActions = document.getElementById("resultsActions");
const businessList = document.getElementById("businessList");
const downloadResultsBtn = document.getElementById("downloadResultsBtn");

const fileFormatFilter = document.getElementById("fileFormatFilter");
const fileList = document.getElementById("fileList");

const filePreviewModal = document.getElementById("filePreviewModal");
const filePreviewTitle = document.getElementById("filePreviewTitle");
const filePreviewContent = document.getElementById("filePreviewContent");
const closeFilePreviewBtn = document.getElementById("closeFilePreviewBtn");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const filePreviewDownloadBtn = document.getElementById(
  "filePreviewDownloadBtn"
);

const toastContainer = document.getElementById("toastContainer");

// Current search state
let currentSearchStatus = {
  isRunning: false,
  currentFile: null,
  query: '',
  location: ''
};

// Current results
let currentResults = [];

// Tab switching
function showTab(tabId) {
  // Hide all tabs
  searchTab.classList.remove("active");
  resultsTab.classList.remove("active");
  filesTab.classList.remove("active");

  // Deactivate all buttons
  searchTabBtn.classList.remove("active");
  resultsTabBtn.classList.remove("active");
  filesTabBtn.classList.remove("active");

  // Show selected tab
  document.getElementById(tabId).classList.add("active");

  // Activate corresponding button
  document.getElementById(tabId + "Btn").classList.add("active");

  // Load content for files tab if selected
  if (tabId === "filesTab") {
    loadFiles();
  }
}

// Tab button event listeners
searchTabBtn.addEventListener("click", () => showTab("searchTab"));
resultsTabBtn.addEventListener("click", () => showTab("resultsTab"));
filesTabBtn.addEventListener("click", () => showTab("filesTab"));

// Range slider value display
numResultsInput.addEventListener("input", () => {
  numResultsValue.textContent = numResultsInput.value;
});

// Toast notification function
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // Trigger reflow to enable animation
  toast.offsetHeight;

  // Show toast
  toast.classList.add("show");

  // Hide and remove toast after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      toastContainer.removeChild(toast);
    }, 300);
  }, 3000);
}

// Search form submission
searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // If a search is already running, do nothing
  if (currentSearchStatus.isRunning) {
    showToast("A search is already in progress", "error");
    return;
  }

  // Get form data
  const formData = new FormData(searchForm);

  // Generate timestamp from browser's local time (date + 12-hour time with seconds)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  let hours = now.getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 should be 12
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}${ampm}`;

  const searchData = {
    query: formData.get("query"),
    location: formData.get("location"),
    numResults: formData.get("numResults"),
    saveFormat: formData.get("saveFormat"),
    timestamp: timestamp,
  };

  // Disable search button
  searchBtn.disabled = true;
  searchBtn.innerHTML = '<div class="spinner"></div> Scraping...';

  // Show progress container
  progressContainer.style.display = "block";

  try {
    // Start the search
    const response = await fetch("/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(searchData),
    });

    const data = await response.json();

    if (data.success) {
      // Search started successfully
      currentSearchStatus.isRunning = true;

      // Start polling for status updates
      startStatusPolling();

      showToast("Search started successfully");
    } else {
      // Search failed to start
      searchBtn.disabled = false;
      searchBtn.innerHTML = '<i class="fas fa-search"></i> Start Search';
      progressContainer.style.display = "none";

      showToast(`Error: ${data.error || "Failed to start search"}`, "error");
    }
  } catch (error) {
    // Network or other error
    searchBtn.disabled = false;
    searchBtn.innerHTML = '<i class="fas fa-search"></i> Start Search';
    progressContainer.style.display = "none";

    showToast(`Error: ${error.message || "Network error"}`, "error");
  }
});

// Poll for search status updates
function startStatusPolling() {
  const pollInterval = setInterval(async () => {
    try {
      const response = await fetch("/api/status");
      const data = await response.json();

      if (data.success) {
        updateSearchStatus(data.status);

        // If search is no longer running, stop polling
        if (!data.status.isRunning) {
          clearInterval(pollInterval);
          searchCompleted(data.status);
        }
      } else {
        showToast(`Error: ${data.error || "Failed to get status"}`, "error");
      }
    } catch (error) {
      showToast(`Error: ${error.message || "Network error"}`, "error");
    }
  }, 1000); // Poll every second
}

// Update search status display
function updateSearchStatus(status) {
  // Update progress bar
  progressBar.style.width = `${status.progress}%`;

  // Update status message
  statusMessage.textContent = status.statusMessage;

  // Store current file if available
  if (status.currentFile) {
    currentSearchStatus.currentFile = status.currentFile;
  }

  // Store query and location
  if (status.query) {
    currentSearchStatus.query = status.query;
  }
  if (status.location) {
    currentSearchStatus.location = status.location;
  }
}

// Handle search completion
function searchCompleted(status) {
  // Re-enable search button
  searchBtn.disabled = false;
  searchBtn.innerHTML = '<i class="fas fa-search"></i> Start Search';

  // Update search status
  currentSearchStatus.isRunning = false;

  if (status.error) {
    // Search completed with error
    showToast(`Search error: ${status.error}`, "error");
    progressContainer.style.display = "none";
  } else {
    // Search completed successfully
    showToast("Search completed successfully", "success");
    progressBar.style.width = "100%";

    // Delay hiding progress container to show 100% completion
    setTimeout(() => {
      progressContainer.style.display = "none";
    }, 1500);

    // If we have a current file, load the results
    if (currentSearchStatus.currentFile) {
      loadResults(currentSearchStatus.currentFile);
    } else {
      // Otherwise, load the file list to find the latest file
      loadFiles();
    }
  }
}

// Cancel search button
cancelSearchBtn.addEventListener("click", async () => {
  if (!currentSearchStatus.isRunning) return;

  try {
    const response = await fetch("/api/cancel", {
      method: "POST",
    });

    const data = await response.json();

    if (data.success) {
      showToast("Search cancelled");
    } else {
      showToast(`Failed to cancel search: ${data.message}`, "error");
    }
  } catch (error) {
    showToast(`Error: ${error.message || "Network error"}`, "error");
  }
});

// Load list of files
async function loadFiles() {
  const format = fileFormatFilter.value;

  try {
    // Clear file list
    fileList.innerHTML = '<li class="file-item">Loading files...</li>';

    const response = await fetch(`/api/files/${format}`);
    const data = await response.json();

    if (data.success) {
      if (data.files.length === 0) {
        fileList.innerHTML = '<li class="file-item">No files found</li>';
        return;
      }

      // Clear file list
      fileList.innerHTML = "";

      // Add file items
      data.files.forEach((file) => {
        const fileItem = document.createElement("li");
        fileItem.className = "file-item";

        const fileSize = formatFileSize(file.size);
        const fileDate = new Date(file.modified).toLocaleString();

        fileItem.innerHTML = `
              <div class="file-info">
                <div class="file-name">${file.name}</div>
                <div class="file-meta">${fileSize} - ${fileDate}</div>
              </div>
              <div class="file-actions">
                <button class="file-preview-btn" data-filename="${file.name}" data-format="${format}">
                  <i class="fas fa-eye"></i>
                </button>
                <button class="file-download-btn" data-filename="${file.name}" data-format="${format}">
                  <i class="fas fa-download"></i>
                </button>
                <button class="file-delete-btn" data-filename="${file.name}" data-format="${format}">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            `;

        fileList.appendChild(fileItem);
      });

      // Add event listeners to file action buttons
      document.querySelectorAll(".file-preview-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const filename = btn.getAttribute("data-filename");
          const format = btn.getAttribute("data-format");
          previewFile(filename, format);
        });
      });

      document.querySelectorAll(".file-download-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const filename = btn.getAttribute("data-filename");
          const format = btn.getAttribute("data-format");
          downloadFile(filename, format);
        });
      });

      document.querySelectorAll(".file-delete-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const filename = btn.getAttribute("data-filename");
          const format = btn.getAttribute("data-format");
          deleteFile(filename, format);
        });
      });
    } else {
      fileList.innerHTML = `<li class="file-item">Error: ${data.error}</li>`;
    }
  } catch (error) {
    fileList.innerHTML = `<li class="file-item">Error: ${
      error.message || "Network error"
    }</li>`;
  }
}

// Format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  else if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  else return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// File format filter change
fileFormatFilter.addEventListener("change", loadFiles);

async function previewFile(filename, format) {
  try {
    // Set modal title
    filePreviewTitle.textContent = filename;

    // Show loading in modal
    filePreviewContent.innerHTML =
      '<div style="text-align:center;"><div class="spinner"></div> Loading preview...</div>';

    // Show modal
    filePreviewModal.style.display = "flex";

    // Set download button link
    filePreviewDownloadBtn.setAttribute("data-filename", filename);
    filePreviewDownloadBtn.setAttribute("data-format", format);

    // Create variables to store data for later use with "show more" functionality
    let allResults = [];
    let allBusinesses = [];

    // Fetch file content
    const response = await fetch(`/api/results/${format}/${filename}`);

    if (!response.ok) {
      filePreviewContent.innerHTML = `<div style="color:red;">Error: ${response.status} ${response.statusText}</div>`;
      return;
    }

    if (format === "json") {
      const data = await response.json();

      if (data.success) {
        // Store all results for later use
        allResults = data.results;

        // Create preview content for JSON
        let results = data.results;

        if (results.length === 0) {
          filePreviewContent.innerHTML = "<div>No results in this file</div>";
          return;
        }

        // Sort results alphabetically by business name
        results.sort((a, b) => {
          return (a.businessName || "").localeCompare(b.businessName || "");
        });

        // Show basic stats
        let previewHTML = `
  <div class="results-summary">
    <h3>${results.length} businesses found <span class="sorted-text">(sorted alphabetically)</span></h3>
  </div>
`;

        // Show preview header
        previewHTML +=
          '<div class="preview-header" style="font-weight:bold; margin-bottom:0.5rem;">Preview (first 5 entries):</div>';

        // Create a table view 
        previewHTML += '<div class="table-scroll-container">';
        previewHTML += '<table class="csv-preview-table">';

        // Add header row based on the first result's properties
        const firstBusiness = results[0];
        const headers = Object.keys(firstBusiness).filter(key => key !== 'fullAddress');

        previewHTML += "<tr>";
        headers.forEach((header) => {
          // Determine column class based on header name
          let colClass = "";
          if (/website|url|web/i.test(header)) {
            colClass = "col-website";
          } else if (/address|street|location/i.test(header)) {
            colClass = "col-address";
          } else if (/name|business|company/i.test(header)) {
            colClass = "col-name";
          }

          // Convert camelCase to Title Case for headers
          const displayHeader = header
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (str) => str.toUpperCase());

          previewHTML += `<th class="${colClass}">${displayHeader}</th>`;
        });
        previewHTML += "</tr>";

        // Add data rows
        const previewLimit = Math.min(results.length, 5);
        for (let i = 0; i < previewLimit; i++) {
          const business = results[i];
          previewHTML += "<tr>";

          headers.forEach((header) => {
            // Determine column class based on header name
            let colClass = "";
            if (/website|url|web/i.test(header)) {
              colClass = "col-website";
            } else if (/address|street|location/i.test(header)) {
              colClass = "col-address";
            } else if (/name|business|company/i.test(header)) {
              colClass = "col-name";
            }

            const value = business[header] || "";

            // Handle different cell types differently
            if (/website|url|web/i.test(header) && value.startsWith("http")) {
              // Make websites clickable
              previewHTML += `<td class="${colClass}"><a href="${value}" target="_blank">${value}</a></td>`;
            } else if (/phone/i.test(header)) {
              // Format phone numbers consistently
              previewHTML += `<td class="${colClass}">${value}</td>`;
            } else {
              // Regular cell
              previewHTML += `<td class="${colClass}">${value}</td>`;
            }
          });

          previewHTML += "</tr>";
        }

        previewHTML += "</table>";
        previewHTML += "</div>"; // Close table-scroll-container

        if (results.length > previewLimit) {
          const remainingCount = results.length - previewLimit;
          previewHTML += `<div style="margin-top: 15px;" id="more-entries-container">... and <a href="#" id="show-more-entries" style="color: #ffc107; text-decoration: underline; font-weight: bold;">${remainingCount} more entries</a></div>`;
        }

        filePreviewContent.innerHTML = previewHTML;

        // Add event listener for "show more entries" directly after setting the HTML
        const showMoreLink = document.getElementById("show-more-entries");
        if (showMoreLink) {
          showMoreLink.addEventListener("click", function (e) {
            e.preventDefault();

            // Get the table container
            const tableContainer = document.querySelector(
              ".table-scroll-container"
            );
            if (!tableContainer) return;

            // Create a new table with all entries
            let newTableHTML = '<table class="csv-preview-table">';

            // Add header row
            newTableHTML += "<tr>";
            headers.forEach((header) => {
              // Determine column class based on header name
              let colClass = "";
              if (/website|url|web/i.test(header)) {
                colClass = "col-website";
              } else if (/address|street|location/i.test(header)) {
                colClass = "col-address";
              } else if (/name|business|company/i.test(header)) {
                colClass = "col-name";
              }

              // Convert camelCase to Title Case for headers
              const displayHeader = header
                .replace(/([A-Z])/g, " $1")
                .replace(/^./, (str) => str.toUpperCase());

              newTableHTML += `<th class="${colClass}">${displayHeader}</th>`;
            });
            newTableHTML += "</tr>";

            // Add all data rows
            results.forEach((business) => {
              newTableHTML += "<tr>";

              headers.forEach((header) => {
                // Determine column class based on header name
                let colClass = "";
                if (/website|url|web/i.test(header)) {
                  colClass = "col-website";
                } else if (/address|street|location/i.test(header)) {
                  colClass = "col-address";
                } else if (/name|business|company/i.test(header)) {
                  colClass = "col-name";
                }

                const value = business[header] || "";

                // Handle different cell types differently
                if (
                  /website|url|web/i.test(header) &&
                  value.startsWith("http")
                ) {
                  // Make websites clickable
                  newTableHTML += `<td class="${colClass}"><a href="${value}" target="_blank">${value}</a></td>`;
                } else if (/phone/i.test(header)) {
                  // Format phone numbers consistently
                  newTableHTML += `<td class="${colClass}">${value}</td>`;
                } else {
                  // Regular cell
                  newTableHTML += `<td class="${colClass}">${value}</td>`;
                }
              });

              newTableHTML += "</tr>";
            });

            newTableHTML += "</table>";

            // Replace the table
            tableContainer.innerHTML = newTableHTML;

            // Update the "preview" text
            const previewText = document.querySelector(
              'div[style*="font-weight:bold"]'
            );
            if (previewText) {
              previewText.textContent = "Showing all entries:";
            }

            // Update the "more entries" container
            const moreEntriesContainer = document.getElementById(
              "more-entries-container"
            );
            if (moreEntriesContainer) {
              moreEntriesContainer.innerHTML = `<div style="margin-top: 10px; font-style: italic;">Showing all ${results.length} entries</div>`;
            }

            // Update summary text
            const summaryElement = document.querySelector(
              ".results-summary h3"
            );
            if (summaryElement) {
              summaryElement.textContent = `${results.length} businesses found (showing all)`;
            }
          });
        }
      } else {
        filePreviewContent.innerHTML = `<div style="color:red;">Error: ${data.error}</div>`;
      }
    } else if (format === "csv") {
      const text = await response.text();

      // Parse CSV properly, handling commas within quoted fields
      function parseCSVLine(line) {
        const result = [];
        let cell = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];

          if (char === '"') {
            // Handle quotes
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
              // Escaped quote inside a quoted field
              cell += '"';
              i++; // Skip the next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === "," && !inQuotes) {
            // End of cell
            result.push(cell);
            cell = "";
          } else {
            // Add character to current cell
            cell += char;
          }
        }

        // Add the last cell
        result.push(cell);
        return result;
      }

      // Split into lines and clean up
      const lines = text.split("\n").filter((line) => line.trim());

      // Parse headers and data
      const headers = parseCSVLine(lines[0]);

      if (lines.length <= 1) {
        filePreviewContent.innerHTML = "<div>No results in this file</div>";
        return;
      }

      // Parse the data into objects for sorting
      const businesses = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const cells = parseCSVLine(lines[i]);
        const business = {};

        headers.forEach((header, index) => {
          if (index < cells.length) {
            // Clean the cell value
            business[header.replace(/^"(.*)"$/, "$1").trim()] = cells[index]
              .replace(/^"(.*)"$/, "$1")
              .trim();
          } else {
            business[header.replace(/^"(.*)"$/, "$1").trim()] = "";
          }
        });

        businesses.push(business);
      }

      // Store all businesses for later use
      allBusinesses = businesses;

      // Sort businesses alphabetically by Business Name
      businesses.sort((a, b) => {
        const nameA = a["Business Name"] || "";
        const nameB = b["Business Name"] || "";
        return nameA.localeCompare(nameB);
      });

      // Show basic stats
      let previewHTML = `
  <div class="results-summary">
    <h3>${businesses.length} businesses found (sorted alphabetically)</h3>
  </div>
`;

      // Show preview header
      previewHTML +=
        '<div style="font-weight:bold; margin-bottom:0.5rem;">Preview (first 5 entries):</div>';

      // Determine preview limit
      const previewLimit = Math.min(businesses.length, 5);

      // Create table with our new CSS class and horizontal scrolling container
      previewHTML += '<div class="table-scroll-container">';
      previewHTML += '<table class="csv-preview-table">';

      // Add header row
      previewHTML += "<tr>";
      headers.forEach((header, index) => {
        // Clean up header text
        const cleanHeader = header.replace(/^"(.*)"$/, "$1").trim();

        // Determine column class based on header name
        let colClass = "";
        if (/website|url|web/i.test(cleanHeader)) {
          colClass = "col-website";
        } else if (/address|street|location/i.test(cleanHeader)) {
          colClass = "col-address";
        } else if (/name|business|company/i.test(cleanHeader)) {
          colClass = "col-name";
        }

        previewHTML += `<th class="${colClass}">${cleanHeader}</th>`;
      });
      previewHTML += "</tr>";

      // Add data rows for the sorted businesses
      for (let i = 0; i < previewLimit; i++) {
        if (i >= businesses.length) break;

        const business = businesses[i];
        previewHTML += "<tr>";

        headers.forEach((header, index) => {
          // Clean up header text
          const headerText = header.replace(/^"(.*)"$/, "$1").trim();

          // Get the cell value
          const cellValue = business[headerText] || "";

          // Determine column class based on header name
          let colClass = "";
          if (/website|url|web/i.test(headerText)) {
            colClass = "col-website";
          } else if (/address|street|location/i.test(headerText)) {
            colClass = "col-address";
          } else if (/name|business|company/i.test(headerText)) {
            colClass = "col-name";
          }

          // Handle different cell types differently
          if (
            /website|url|web/i.test(headerText) &&
            cellValue.startsWith("http")
          ) {
            // Make websites clickable
            previewHTML += `<td class="${colClass}"><a href="${cellValue}" target="_blank">${cellValue}</a></td>`;
          } else if (/phone/i.test(headerText)) {
            // Format phone numbers consistently
            previewHTML += `<td class="${colClass}">${cellValue}</td>`;
          } else {
            // Regular cell
            previewHTML += `<td class="${colClass}">${cellValue}</td>`;
          }
        });

        previewHTML += "</tr>";
      }

      previewHTML += "</table>";
      previewHTML += "</div>"; // Close table-scroll-container

      if (businesses.length > previewLimit) {
        const remainingCount = businesses.length - previewLimit;
        previewHTML += `<div style="margin-top: 15px;" id="more-entries-container">... and <a href="#" id="show-more-entries" style="color: #ffc107; text-decoration: underline; font-weight: bold;">${remainingCount} more entries</a></div>`;
      }

      filePreviewContent.innerHTML = previewHTML;

      // Add event listener for "show more entries" directly after setting the HTML
      const showMoreLink = document.getElementById("show-more-entries");
      if (showMoreLink) {
        showMoreLink.addEventListener("click", function (e) {
          e.preventDefault();

          // Get the table container
          const tableContainer = document.querySelector(
            ".table-scroll-container"
          );
          if (!tableContainer) return;

          // Create a new table with all entries
          let newTableHTML = '<table class="csv-preview-table">';

          // Add header row
          newTableHTML += "<tr>";
          headers.forEach((header, index) => {
            // Clean up header text
            const cleanHeader = header.replace(/^"(.*)"$/, "$1").trim();

            // Determine column class based on header name
            let colClass = "";
            if (/website|url|web/i.test(cleanHeader)) {
              colClass = "col-website";
            } else if (/address|street|location/i.test(cleanHeader)) {
              colClass = "col-address";
            } else if (/name|business|company/i.test(cleanHeader)) {
              colClass = "col-name";
            }

            newTableHTML += `<th class="${colClass}">${cleanHeader}</th>`;
          });
          newTableHTML += "</tr>";

          // Add all data rows
          businesses.forEach((business) => {
            newTableHTML += "<tr>";

            headers.forEach((header, index) => {
              // Clean up header text
              const headerText = header.replace(/^"(.*)"$/, "$1").trim();

              // Get the cell value
              const cellValue = business[headerText] || "";

              // Determine column class based on header name
              let colClass = "";
              if (/website|url|web/i.test(headerText)) {
                colClass = "col-website";
              } else if (/address|street|location/i.test(headerText)) {
                colClass = "col-address";
              } else if (/name|business|company/i.test(headerText)) {
                colClass = "col-name";
              }

              // Handle different cell types differently
              if (
                /website|url|web/i.test(headerText) &&
                cellValue.startsWith("http")
              ) {
                // Make websites clickable
                newTableHTML += `<td class="${colClass}"><a href="${cellValue}" target="_blank">${cellValue}</a></td>`;
              } else if (/phone/i.test(headerText)) {
                // Format phone numbers consistently
                newTableHTML += `<td class="${colClass}">${cellValue}</td>`;
              } else {
                // Regular cell
                newTableHTML += `<td class="${colClass}">${cellValue}</td>`;
              }
            });

            newTableHTML += "</tr>";
          });

          newTableHTML += "</table>";

          // Replace the table
          tableContainer.innerHTML = newTableHTML;

          // Update the "preview" text
          const previewText = document.querySelector(
            'div[style*="font-weight:bold"]'
          );
          if (previewText) {
            previewText.textContent = "Showing all entries:";
          }

          // Update the "more entries" container
          const moreEntriesContainer = document.getElementById(
            "more-entries-container"
          );
          if (moreEntriesContainer) {
            moreEntriesContainer.innerHTML = `<div style="margin-top: 10px; font-style: italic;">Showing all ${businesses.length} entries</div>`;
          }

          // Update summary text
          const summaryElement = document.querySelector(".results-summary h3");
          if (summaryElement) {
            summaryElement.textContent = `${businesses.length} businesses found (showing all)`;
          }
        });
      }
    }
  } catch (error) {
    filePreviewContent.innerHTML = `<div style="color:red;">Error: ${
      error.message || "Failed to load preview"
    }</div>`;
  }
}

// Download file
function downloadFile(filename, format) {
  window.location.href = `/download/${format}/${filename}`;
}

// Delete file
async function deleteFile(filename, format) {
  if (!confirm(`Are you sure you want to delete ${filename}?`)) {
    return;
  }

  try {
    const response = await fetch(`/api/files/${format}/${filename}`, {
      method: "DELETE",
    });

    const data = await response.json();

    if (data.success) {
      showToast(`File ${filename} deleted successfully`, "success");
      loadFiles();
    } else {
      showToast(`Error: ${data.error || "Failed to delete file"}`, "error");
    }
  } catch (error) {
    showToast(`Error: ${error.message || "Network error"}`, "error");
  }
}

// Close file preview modal
closeFilePreviewBtn.addEventListener("click", () => {
  filePreviewModal.style.display = "none";
});

closePreviewBtn.addEventListener("click", () => {
  filePreviewModal.style.display = "none";
});

// Download from preview modal
filePreviewDownloadBtn.addEventListener("click", () => {
  const filename = filePreviewDownloadBtn.getAttribute("data-filename");
  const format = filePreviewDownloadBtn.getAttribute("data-format");
  downloadFile(filename, format);
});

// Load results
async function loadResults(file) {
  if (!file) return;

  // Show results tab
  showTab("resultsTab");

  // Parse filename to get format
  const parts = file.name.split(".");
  const format = parts[parts.length - 1];

  try {
    resultsSummary.innerHTML = '<div class="spinner"></div> Loading results...';
    businessList.innerHTML = "";

    const response = await fetch(`/api/results/${format}/${file.name}`);

    if (!response.ok) {
      resultsSummary.innerHTML = `<h3>Error</h3><p>Failed to load results: ${response.status} ${response.statusText}</p>`;
      return;
    }

    if (format === "json") {
      const data = await response.json();

      if (data.success) {
        currentResults = data.results;

        // Update summary
        resultsSummary.innerHTML = `
              <h3>${data.totalResults} businesses found</h3>
              <p>Search for "${currentSearchStatus.query || extractSearchQuery(
                file.name
              )}" in "${currentSearchStatus.location || extractSearchLocation(file.name)}"</p>
            `;

        // Show download button
        resultsActions.style.display = "block";
        downloadResultsBtn.setAttribute("data-filename", file.name);
        downloadResultsBtn.setAttribute("data-format", format);

        // Render businesses
        renderBusinessList(data.results);
      } else {
        resultsSummary.innerHTML = `<h3>Error</h3><p>${data.error}</p>`;
      }
    } else if (format === "csv") {
      // For CSV, we'll display a simplified view
      const text = await response.text();

      // Parse CSV properly, handling commas within quoted fields
      function parseCSVLine(line) {
        const result = [];
        let cell = "";
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];

          if (char === '"') {
            // Handle quotes
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
              // Escaped quote inside a quoted field
              cell += '"';
              i++; // Skip the next quote
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === "," && !inQuotes) {
            // End of cell
            result.push(cell);
            cell = "";
          } else {
            // Add character to current cell
            cell += char;
          }
        }

        // Add the last cell
        result.push(cell);
        return result;
      }

      const lines = text.split("\n").filter((line) => line.trim());
      const headers = parseCSVLine(lines[0]);

      // Convert CSV to array of objects
      const results = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        const values = parseCSVLine(lines[i]);
        const business = {};

        headers.forEach((header, index) => {
          let value = values[index] || "";
          // Remove quotes if present
          value = value.replace(/^"(.+)"$/, "$1");
          // Also handle empty quoted strings
          if (value === '""' || value === '"') {
            value = "";
          }
          business[header.trim().replace(/^"(.+)"$/, "$1")] = value;
        });

        results.push(business);
      }

      currentResults = results;

      // Update summary
      resultsSummary.innerHTML = `
            <h3>${results.length} businesses found</h3>
            <p>Search for "${currentSearchStatus.query || extractSearchQuery(
              file.name
            )}" in "${currentSearchStatus.location || extractSearchLocation(file.name)}"</p>
          `;

      // Show download button
      resultsActions.style.display = "block";
      downloadResultsBtn.setAttribute("data-filename", file.name);
      downloadResultsBtn.setAttribute("data-format", format);

      renderBusinessList(results);
    }
  } catch (error) {
    resultsSummary.innerHTML = `<h3>Error</h3><p>${
      error.message || "Failed to load results"
    }</p>`;
  }
}

// extract search query from filename
function extractSearchQuery(filename) {
  // Filename format: query_location_date.ext
  const parts = filename.split("_");
  if (parts.length < 2) return "Unknown";

  return parts[0].replace(/_/g, " ");
}

// Extract search location from filename
function extractSearchLocation(filename) {
  // Filename format: query_location_timestamp.ext
  // Example: church_new_jersey_2025-12-25T17-00-40.json
  const parts = filename.split("_");
  if (parts.length < 3) return "Unknown";

  // Timestamp is the last part (contains dashes and .ext)
  // Location is everything between query (first part) and timestamp (last part)
  const locationParts = parts.slice(1, -1).filter(part => part.length > 0); // Everything except first and last, filter empty

  if (locationParts.length === 0) return "Unknown";

  return locationParts.join(" ").replace(/_/g, " ");
}

function renderBusinessList(businesses) {
  businessList.innerHTML = "";

  businesses.forEach((business) => {
    const item = document.createElement("div");
    item.className = "business-item";

    // handle different property names between JSON and CSV
    const name =
      business.businessName || business["Business Name"] || "Unknown";
    const type = business.businessType || business["Business Type"] || "";
    const phone = business.phone || business["Phone"] || "";
    const website = business.website || business["Website"] || "";
    const street = business.streetAddress || business["Street Address"] || "";
    const city = business.city || business["City"] || "";
    const state = business.state || business["State"] || "";
    const zip = business.zipCode || business["ZIP Code"] || "";
    const apt = business.aptUnit || business["Apt Unit"] || "";

    // Prepare website URL (add protocol if missing)
    let fullWebsiteUrl = "";
    if (website) {
      fullWebsiteUrl = website.trim();
      if (
        fullWebsiteUrl &&
        !fullWebsiteUrl.startsWith("http://") &&
        !fullWebsiteUrl.startsWith("https://")
      ) {
        fullWebsiteUrl = "https://" + fullWebsiteUrl;
      }
    }

    item.innerHTML = `
          <div class="business-header">
            <h3>${name}</h3>
          </div>
          <div class="business-body">
            <div class="business-type">${type}</div>
            <div class="business-contact">${phone}</div>
            <div class="business-website">${
              fullWebsiteUrl
                ? `<a href="${fullWebsiteUrl}" target="_blank">${fullWebsiteUrl}</a>`
                : "No website"
            }</div>
            <div class="business-address">${street}${apt ? ' ' + apt : ''}, ${city}, ${state} ${zip}</div>

            <div class="business-actions">
              ${
                fullWebsiteUrl
                  ? `<a href="${fullWebsiteUrl}" target="_blank" class="action-website"><i class="fas fa-globe"></i> Website</a>`
                  : ""
              }
              <a href="https://maps.google.com/?q=${encodeURIComponent(
                `${street}${apt ? ' ' + apt : ''}, ${city}, ${state} ${zip}`
              )}" target="_blank" class="action-map">
                <i class="fas fa-map-marker-alt"></i> Map
              </a>
            </div>
          </div>
        `;

    businessList.appendChild(item);
  });
}

downloadResultsBtn.addEventListener("click", () => {
  const filename = downloadResultsBtn.getAttribute("data-filename");
  const format = downloadResultsBtn.getAttribute("data-format");
  downloadFile(filename, format);
});


loadFiles();
