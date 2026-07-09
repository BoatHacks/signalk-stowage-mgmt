// node:sqlite's DatabaseSync has no built-in `.transaction()` helper like
// better-sqlite3 did, so this wraps a block of statements in BEGIN/COMMIT,
// rolling back on error.
function runInTransaction (db, fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

module.exports = { runInTransaction }
