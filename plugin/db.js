let DatabaseSync
try {
  ({ DatabaseSync } = require('node:sqlite'))
} catch (err) {
  throw new Error(
    'signalk-stowage-mgmt requires Node.js 22.5.0 or newer (uses the built-in ' +
    `node:sqlite module). Your Node.js version is ${process.version}. Please ` +
    'upgrade Node.js and restart the server.'
  )
}
const path = require('path')
const fs = require('fs')
const { randomUUID } = require('crypto')
const { runInTransaction } = require('./tx')

const DEFAULT_CATEGORIES = ['food', 'spare part', 'equipment', 'tools']

function initDb (dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const dbPath = path.join(dataDir, 'inventory.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

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
      actual_quantity INTEGER NOT NULL DEFAULT 1,
      target_quantity INTEGER,
      notes TEXT,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      thumbnail TEXT,
      expires_at TEXT,
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

    CREATE TABLE IF NOT EXISTS item_placements (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
      quantity INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_log (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL,
      event TEXT NOT NULL CHECK (event IN ('created', 'actual_quantity', 'target_quantity', 'deleted', 'split')),
      old_value INTEGER,
      new_value INTEGER,
      delta INTEGER NOT NULL,
      note TEXT,
      from_location_id TEXT,
      from_location_name TEXT,
      to_location_id TEXT,
      to_location_name TEXT,
      quantity INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_locations_parent ON locations(parent_id);
    CREATE INDEX IF NOT EXISTS idx_locations_floorplan ON locations(floorplan_id);
    CREATE INDEX IF NOT EXISTS idx_items_location ON items(location_id);
    CREATE INDEX IF NOT EXISTS idx_item_categories_category ON item_categories(category_id);
    CREATE INDEX IF NOT EXISTS idx_item_log_created_at ON item_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_item_log_item ON item_log(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_placements_item ON item_placements(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_placements_location ON item_placements(location_id);
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
  if (!itemColumnsAfterRename.includes('expires_at')) {
    db.exec('ALTER TABLE items ADD COLUMN expires_at TEXT')
  }
  if (itemColumnsAfterRename.includes('description')) {
    // Merge any existing description text into notes (description first,
    // separated by a blank line if notes already had content), then drop
    // the now-redundant column.
    db.exec(`
      UPDATE items SET notes =
        CASE
          WHEN description IS NULL OR trim(description) = '' THEN notes
          WHEN notes IS NULL OR trim(notes) = '' THEN description
          ELSE description || char(10) || char(10) || notes
        END
      WHERE description IS NOT NULL AND trim(description) != ''
    `)
    try {
      db.exec('ALTER TABLE items DROP COLUMN description')
    } catch (err) {
      // Older SQLite builds (pre-3.35) don't support DROP COLUMN. The data
      // has already been merged into notes above, so this is safe to leave
      // as an unused, ignored column if the drop isn't supported.
    }
  }

  // SQLite can't ALTER a CHECK constraint in place, so if an existing
  // item_log table predates 'split' support, rebuild it: add the new
  // nullable columns, recreate the table with the updated CHECK, copy
  // the data across (old rows simply have NULL for the new columns).
  const itemLogSql = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'item_log'"
  ).get()
  if (itemLogSql && !itemLogSql.sql.includes("'split'")) {
    const itemLogColumns = db.prepare('PRAGMA table_info(item_log)').all().map(c => c.name)
    for (const col of ['from_location_id', 'from_location_name', 'to_location_id', 'to_location_name', 'quantity']) {
      if (!itemLogColumns.includes(col)) {
        db.exec(`ALTER TABLE item_log ADD COLUMN ${col} ${col === 'quantity' ? 'INTEGER' : 'TEXT'}`)
      }
    }
    db.exec(`
      ALTER TABLE item_log RENAME TO item_log_old;

      CREATE TABLE item_log (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        item_name TEXT NOT NULL,
        event TEXT NOT NULL CHECK (event IN ('created', 'actual_quantity', 'target_quantity', 'deleted', 'split')),
        old_value INTEGER,
        new_value INTEGER,
        delta INTEGER NOT NULL,
        note TEXT,
        from_location_id TEXT,
        from_location_name TEXT,
        to_location_id TEXT,
        to_location_name TEXT,
        quantity INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO item_log (
        id, item_id, item_name, event, old_value, new_value, delta, note,
        from_location_id, from_location_name, to_location_id, to_location_name, quantity, created_at
      )
      SELECT
        id, item_id, item_name, event, old_value, new_value, delta, note,
        from_location_id, from_location_name, to_location_id, to_location_name, quantity, created_at
      FROM item_log_old;

      DROP TABLE item_log_old;

      CREATE INDEX IF NOT EXISTS idx_item_log_created_at ON item_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_item_log_item ON item_log(item_id);
    `)
  }

  const categoryCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c
  if (categoryCount === 0) {
    const insert = db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)')
    runInTransaction(db, () => {
      for (const name of DEFAULT_CATEGORIES) insert.run(randomUUID(), name)
    })
  }

  return db
}

module.exports = { initDb }
