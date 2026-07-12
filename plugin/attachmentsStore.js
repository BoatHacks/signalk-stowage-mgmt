const path = require('path')
const fs = require('fs')

// Attachments are stored on disk (not in SQLite) since they're unbounded in
// size and number — see issue #15. Every file lives at a path built purely
// from server-generated UUIDs (item id, attachment id), never from anything
// the client sends, so there's no path-traversal surface even though the
// original filename is preserved as display-only metadata in the database.

function attachmentDir (dataDir, itemId) {
  return path.join(dataDir, 'attachments', itemId)
}

function attachmentPath (dataDir, itemId, attachmentId) {
  return path.join(attachmentDir(dataDir, itemId), attachmentId)
}

// Best-effort cleanup — called after the DB row is already gone, so a
// failure here would just leave an orphaned file rather than corrupt state.
function deleteAttachmentFile (dataDir, itemId, attachmentId) {
  fs.unlink(attachmentPath(dataDir, itemId, attachmentId), () => {})
}

// Removes every attachment file for an item at once (used when the item
// itself is deleted — the DB rows cascade automatically via the foreign key).
function deleteItemAttachments (dataDir, itemId) {
  fs.rm(attachmentDir(dataDir, itemId), { recursive: true, force: true }, () => {})
}

module.exports = { attachmentDir, attachmentPath, deleteAttachmentFile, deleteItemAttachments }
