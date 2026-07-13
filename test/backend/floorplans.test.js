const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

test('floorplans: upload requires name and svg-looking content', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const missing = await server.post('/floorplans', { name: 'Boat' })
  assert.equal(missing.status, 400)

  const notSvg = await server.post('/floorplans', { name: 'Boat', svg_content: 'plain text' })
  assert.equal(notSvg.status, 400)

  const ok = await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="p1"/></svg>' })
  assert.equal(ok.status, 201)
  const body = await ok.json()
  assert.equal(body.name, 'Boat')
  assert.equal(body.svg_content, undefined) // list/create response omits the raw markup
})

test('floorplans: get by id returns full svg_content, list does not', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const created = await (await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="p1"/></svg>' })).json()

  const single = await (await server.get(`/floorplans/${created.id}`)).json()
  assert.equal(single.svg_content, '<svg><path id="p1"/></svg>')

  const list = await (await server.get('/floorplans')).json()
  assert.equal(list.length, 1)
  assert.equal(list[0].svg_content, undefined)
})

test('floorplans: delete is blocked while still mapped to a storage space', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const fp = await (await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="p1"/></svg>' })).json()
  const loc = await (await server.post('/locations', { name: 'Locker', type: 'storage_space' })).json()
  await server.patch(`/locations/${loc.id}/svg-mapping`, { floorplan_id: fp.id, svg_element_id: 'p1' })

  const blocked = await server.delete(`/floorplans/${fp.id}`)
  assert.equal(blocked.status, 400)

  await server.patch(`/locations/${loc.id}/svg-mapping`, { floorplan_id: null, svg_element_id: null })
  const ok = await server.delete(`/floorplans/${fp.id}`)
  assert.equal(ok.status, 204)
})

test('floorplans: 404 for unknown id', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  assert.equal((await server.get('/floorplans/nope')).status, 404)
  assert.equal((await server.delete('/floorplans/nope')).status, 404)
})
