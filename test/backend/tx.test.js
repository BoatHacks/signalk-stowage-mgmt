const { test } = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { runInTransaction } = require('../../plugin/tx')

function freshDb () {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)')
  return db
}

test('runInTransaction: commits on success and returns the callback result', () => {
  const db = freshDb()
  const result = runInTransaction(db, () => {
    db.prepare('INSERT INTO t (value) VALUES (?)').run('a')
    db.prepare('INSERT INTO t (value) VALUES (?)').run('b')
    return 'done'
  })
  assert.equal(result, 'done')
  const rows = db.prepare('SELECT * FROM t').all()
  assert.equal(rows.length, 2)
})

test('runInTransaction: rolls back all statements if the callback throws', () => {
  const db = freshDb()
  db.prepare('INSERT INTO t (value) VALUES (?)').run('pre-existing')

  assert.throws(() => {
    runInTransaction(db, () => {
      db.prepare('INSERT INTO t (value) VALUES (?)').run('should not survive')
      throw new Error('boom')
    })
  }, /boom/)

  const rows = db.prepare('SELECT * FROM t').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, 'pre-existing')
})
