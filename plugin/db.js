const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')

const DEFAULT_CATEGORIES = ['food', 'spare part', 'equipment', 'tools']

function initDb (dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'inventory.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS floorplans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      svg_content TEXT NOT NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('storage_space','container')),
      parent_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      floorplan_id TEXT REFERENCES floorplans(id) ON DELETE SET NULL,
      svg_element_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      actual_quantity INTEGER NOT NULL DEFAULT 1,
      target_quantity INTEGER,
      notes TEXT,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      thumbnail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_categories (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (item_id, category_id)
    );

    CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_locations_floorplan ON locations(floorplan_id);
    CREATE INDEX IF NOT EXISTS idx_items_location ON items(location_id);
    CREATE INDEX IF NOT EXISTS idx_item_categories_category ON item_categories(category_id);
  `)

  const itemColumns = db.prepare("PRAGMA table_info(items)").all().map(c => c.name)
  if (!itemColumns.includes('thumbnail')) {
    db.exec('ALTER TABLE items ADD COLUMN thumbnail TEXT')
  }
  if (itemColumns.includes('quantity') && !itemColumns.includes('actual_quantity')) {
    db.exec('ALTER TABLE items RENAME COLUMN quantity TO actual_quantity')
  }
  const itemColumnsAfterRename = db.prepare("PRAGMA table_info(items)").all().map(c => c.name)
  if (!itemColumnsAfterRename.includes('target_quantity')) {
    db.exec('ALTER TABLE items ADD COLUMN target_quantity INTEGER')
  }
  if (!itemColumnsAfterRename.includes('notes')) {
    db.exec('ALTER TABLE items ADD COLUMN notes TEXT')
  }

  const categoryCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c
  if (categoryCount === 0) {
    const insert = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)')
    const insertMany = db.transaction((names) => {
      for (const name of names) insert.run(randomUUID(), name)
    })
    insertMany(DEFAULT_CATEGORIES)
  }

  return db
}

module.exports = { initDb }
