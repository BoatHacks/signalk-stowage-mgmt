const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { initDb } = require('../../plugin/db')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-db-test-'))
}

test('initDb: seeds default categories on a fresh database', () => {
  const dir = tmpDir()
  const db = initDb(dir)
  try {
    const categories = db.prepare('SELECT name FROM categories ORDER BY name').all().map((c) => c.name)
    assert.deepEqual(categories, ['equipment', 'food', 'spare part', 'tools'])
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('initDb: re-running against an existing database is idempotent (no duplicate categories, no crash)', () => {
  const dir = tmpDir()
  let db = initDb(dir)
  db.close()

  db = initDb(dir)
  try {
    const count = db.prepare('SELECT COUNT(*) c FROM categories').get().c
    assert.equal(count, 4)
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('initDb: enforces foreign keys (deleting a location cascades to its svg mapping via SET NULL)', () => {
  const dir = tmpDir()
  const db = initDb(dir)
  try {
    const { randomUUID } = require('node:crypto')
    const fpId = randomUUID()
    db.prepare('INSERT INTO floorplans (id, name, svg_content) VALUES (?, ?, ?)').run(fpId, 'Boat', '<svg></svg>')
    const locId = randomUUID()
    db.prepare('INSERT INTO locations (id, name, type, floorplan_id, svg_element_id) VALUES (?, ?, ?, ?, ?)')
      .run(locId, 'Locker', 'storage_space', fpId, 'p1')

    db.prepare('DELETE FROM floorplans WHERE id = ?').run(fpId)

    const loc = db.prepare('SELECT * FROM locations WHERE id = ?').get(locId)
    assert.equal(loc.floorplan_id, null) // ON DELETE SET NULL, not a crash
  } finally {
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
