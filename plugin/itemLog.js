const { randomUUID } = require('crypto')

// Records one row in item_log. item_name is snapshotted (not a foreign key
// to items) so the log stays meaningful after an item is renamed or deleted.
function logItemEvent (db, { itemId, itemName, event, oldValue, newValue, note }) {
  const delta = (newValue == null ? 0 : newValue) - (oldValue == null ? 0 : oldValue)
  db.prepare(
    'INSERT INTO item_log (id, item_id, item_name, event, old_value, new_value, delta, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), itemId, itemName, event, oldValue ?? null, newValue ?? null, delta, note || null)
}

module.exports = { logItemEvent }
