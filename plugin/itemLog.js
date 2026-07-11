const { randomUUID } = require('crypto')

// Records one row in item_log. item_name is snapshotted (not a foreign key
// to items) so the log stays meaningful after an item is renamed or deleted.
function logItemEvent (db, { itemId, itemName, event, oldValue, newValue, note }) {
  const delta = (newValue == null ? 0 : newValue) - (oldValue == null ? 0 : oldValue)
  db.prepare(
    'INSERT INTO item_log (id, item_id, item_name, event, old_value, new_value, delta, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), itemId, itemName, event, oldValue ?? null, newValue ?? null, delta, note || null)
}

// Records a 'split' event: moving `quantity` units of an item from one
// location to another. Locations (both from/to) are snapshotted by name,
// same reasoning as item_name — the log should still read correctly if a
// location is later renamed or deleted. from/to may be null ("no location").
function logSplitEvent (db, { itemId, itemName, fromLocationId, fromLocationName, toLocationId, toLocationName, quantity, note }) {
  db.prepare(
    `INSERT INTO item_log (
      id, item_id, item_name, event, delta, note,
      from_location_id, from_location_name, to_location_id, to_location_name, quantity
    ) VALUES (?, ?, ?, 'split', 0, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), itemId, itemName, note || null, fromLocationId || null, fromLocationName || null, toLocationId || null, toLocationName || null, quantity)
}

module.exports = { logItemEvent, logSplitEvent }
