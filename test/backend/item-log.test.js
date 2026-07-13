const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('item-log: returns full history with no filters, newest-created-first inserts still sorted ascending', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  await server.post('/items', { name: 'Fuse' })
  await server.post('/items', { name: 'Rope' })

  const log = await (await server.get('/item-log')).json()
  assert.equal(log.length, 2)
  // ORDER BY created_at ASC
  assert.ok(new Date(log[0].created_at) <= new Date(log[1].created_at))
})

test('item-log: start/end range filters are inclusive of the whole end day', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  await server.post('/items', { name: 'Fuse' })

  const today = new Date().toISOString().slice(0, 10)
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const withinRange = await (await server.get(`/item-log?start=${past}&end=${future}`)).json()
  assert.equal(withinRange.length, 1)

  const beforeToday = await (await server.get(`/item-log?end=${past}`)).json()
  assert.equal(beforeToday.length, 0)

  const fromToday = await (await server.get(`/item-log?start=${today}`)).json()
  assert.equal(fromToday.length, 1)
})
