const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class SearchDatabase {
  constructor(dbPath = './searches.db') {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initializeTables();
  }

  initializeTables() {
    // Create searches table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        location TEXT NOT NULL,
        total_results INTEGER DEFAULT 0,
        format TEXT NOT NULL,
        filename TEXT NOT NULL UNIQUE,
        status TEXT DEFAULT 'in_progress',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      )
    `);

    // Create businesses table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS businesses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        search_id INTEGER NOT NULL,
        business_name TEXT,
        business_type TEXT,
        phone TEXT,
        website TEXT,
        street_address TEXT,
        city TEXT,
        state TEXT,
        zip_code TEXT,
        apt_unit TEXT,
        full_address TEXT,
        page_number INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (search_id) REFERENCES searches(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for faster queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_businesses_search_id ON businesses(search_id);
      CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at DESC);
    `);

    console.log('Database initialized successfully');
  }

  // Create a new search record
  createSearch(query, location, format, filename) {
    const stmt = this.db.prepare(`
      INSERT INTO searches (query, location, format, filename, status)
      VALUES (?, ?, ?, ?, 'in_progress')
    `);

    const result = stmt.run(query, location, format, filename);
    return result.lastInsertRowid;
  }

  // Save a batch of businesses for a search
  saveBusinesses(searchId, businesses, pageNumber) {
    // Check if a duplicate exists based on name and phone
    const checkStmt = this.db.prepare(`
      SELECT id FROM businesses
      WHERE search_id = ? AND LOWER(business_name) = LOWER(?) AND phone = ?
    `);

    const insertStmt = this.db.prepare(`
      INSERT INTO businesses (
        search_id, business_name, business_type, phone, website,
        street_address, city, state, zip_code, apt_unit, full_address, page_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((businesses) => {
      for (const business of businesses) {
        const businessName = business.businessName || business.name || '';
        const phone = business.phone || '';

        // Check if this business already exists for this search
        const existing = checkStmt.get(searchId, businessName, phone);

        // Only insert if it doesn't exist
        if (!existing) {
          insertStmt.run(
            searchId,
            businessName,
            business.businessType || '',
            phone,
            business.website || '',
            business.streetAddress || business.address?.streetAddress || '',
            business.city || business.address?.city || '',
            business.state || business.address?.state || '',
            business.zipCode || business.address?.zipCode || '',
            business.aptUnit || business.address?.aptUnit || '',
            business.fullAddress || '',
            pageNumber
          );
        }
      }
    });

    insertMany(businesses);
  }

  // Update search status and total results
  updateSearch(searchId, totalResults, status = 'completed') {
    const stmt = this.db.prepare(`
      UPDATE searches
      SET total_results = ?, status = ?, completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(totalResults, status, searchId);
  }

  // Get all searches
  getAllSearches(format = null) {
    let query = 'SELECT * FROM searches';
    if (format) {
      query += ' WHERE format = ?';
    }
    query += ' ORDER BY created_at DESC';

    const stmt = this.db.prepare(query);
    return format ? stmt.all(format) : stmt.all();
  }

  // Get businesses for a specific search
  getBusinessesBySearchId(searchId) {
    const stmt = this.db.prepare(`
      SELECT * FROM businesses
      WHERE search_id = ?
      ORDER BY page_number, id
    `);

    return stmt.all(searchId);
  }

  // Get search by filename
  getSearchByFilename(filename) {
    const stmt = this.db.prepare('SELECT * FROM searches WHERE filename = ?');
    return stmt.get(filename);
  }

  // Delete a search and its businesses
  deleteSearch(filename) {
    const stmt = this.db.prepare('DELETE FROM searches WHERE filename = ?');
    const result = stmt.run(filename);
    return result.changes > 0;
  }

  // Get search statistics
  getSearchStats(searchId) {
    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_businesses,
        COUNT(DISTINCT page_number) as total_pages
      FROM businesses
      WHERE search_id = ?
    `);

    return stmt.get(searchId);
  }

  close() {
    this.db.close();
  }
}

module.exports = SearchDatabase;
