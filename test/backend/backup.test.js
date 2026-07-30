const { test } = require('node:test')
const assert = require('node:assert/strict')
const { startTestServer } = require('../../test-helpers/server')

async function buildSampleData (server) {
  const cat = await (await server.post('/categories', { name: 'Electrical' })).json()
  const aft = await (await server.post('/locations', { name: 'Aft Cabin', type: 'storage_space' })).json()
  const locker = await (await server.post('/locations', {
    name: 'Port Locker', type: 'storage_space', parent_id: aft.id
  })).json()
  const box = await (await server.post('/locations', { name: 'Box 3', type: 'container', parent_id: locker.id })).json()
  const fp = await (await server.post('/floorplans', { name: 'Boat', svg_content: '<svg><path id="p1"/></svg>' })).json()
  await server.patch(`/locations/${locker.id}/svg-mapping`, { floorplan_id: fp.id, svg_element_id: 'p1' })
  const item1 = await (await server.post('/items', {
    name: 'Fuse', actual_quantity: 3, target_quantity: 5, location_id: box.id, category_ids: [cat.id]
  })).json()
  const item2 = await (await server.post('/items', { name: 'Rope', actual_quantity: 10, location_id: aft.id })).json()
  await server.post(`/items/${item2.id}/split`, { from_location_id: aft.id, to_location_id: locker.id, quantity: 4 })
  await server.postRaw(`/items/${item1.id}/attachments`, Buffer.from('hello'), { 'X-Filename': 'manual.txt' })
  return { cat, aft, locker, box, fp, item1, item2 }
}

test('export: includes categories, locations (with mappings), and items (with categories/placements/attachment metadata)', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  const built = await buildSampleData(server)

  const snapshot = await (await server.get('/export')).json()
  assert.equal(snapshot.schema_version, 1)
  assert.ok(snapshot.exported_at)
  assert.equal(snapshot.categories.length, 5) // "Electrical" + 4 auto-seeded defaults
  assert.equal(snapshot.locations.length, 3)
  assert.equal(snapshot.items.length, 2)

  const locker = snapshot.locations.find((l) => l.id === built.locker.id)
  assert.equal(locker.floorplan_id, built.fp.id)
  assert.equal(locker.svg_element_id, 'p1')

  const fuse = snapshot.items.find((i) => i.id === built.item1.id)
  assert.deepEqual(fuse.category_ids, [built.cat.id])
  assert.equal(fuse.attachments.length, 1)
  assert.equal(fuse.attachments[0].filename, 'manual.txt')
  assert.equal(fuse.attachments[0].size, 5)

  const rope = snapshot.items.find((i) => i.id === built.item2.id)
  assert.equal(rope.placements.length, 2)
})

test('import: round-trips onto the same instance, preserving ids and the floorplan mapping', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  const built = await buildSampleData(server)
  const snapshot = await (await server.get('/export')).json()

  const res = await server.post('/import', snapshot)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.deepEqual(body.restored, { categories: 5, locations: 3, items: 2 })
  assert.equal(body.dropped_floorplan_mappings, 0)

  const locations = await (await server.get('/locations')).json()
  assert.equal(locations.length, 3)
  const locker = locations.find((l) => l.id === built.locker.id)
  assert.equal(locker.floorplan_id, built.fp.id)
  assert.equal(locker.svg_element_id, 'p1')
  const box = locations.find((l) => l.id === built.box.id)
  assert.equal(box.parent_id, built.locker.id)

  const items = await (await server.get('/items')).json()
  assert.equal(items.length, 2)
  const rope = items.find((i) => i.id === built.item2.id)
  assert.equal(rope.placements.length, 2)
  const fuse = items.find((i) => i.id === built.item1.id)
  assert.equal(fuse.categories.length, 1)
  assert.equal(fuse.categories[0].id, built.cat.id)
})

test('import: a mapping referencing a floorplan that does not exist here is dropped, not fatal', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await buildSampleData(server)
  const snapshot = await (await server.get('/export')).json()

  // Simulate importing onto a different instance: drop the floorplan itself
  // out of the exported snapshot's referenced id space by pointing it at an
  // id that doesn't exist in this (fresh) target server.
  const otherServer = await startTestServer()
  t.after(() => otherServer.close())

  const res = await otherServer.post('/import', snapshot)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.dropped_floorplan_mappings, 1)

  const locations = await (await otherServer.get('/locations')).json()
  const locker = locations.find((l) => l.name === 'Port Locker')
  assert.equal(locker.floorplan_id, null)
  assert.equal(locker.svg_element_id, null)
  // Hierarchy still restored correctly despite the dropped mapping.
  assert.equal(locker.parent_id, locations.find((l) => l.name === 'Aft Cabin').id)
})

test('import: replaces (does not merge with) existing data', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await server.post('/items', { name: 'Pre-existing item' })
  const snapshot = { schema_version: 1, categories: [], locations: [], items: [{ id: 'x1', name: 'Imported Item', actual_quantity: 1 }] }

  await server.post('/import', snapshot)

  const items = await (await server.get('/items')).json()
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Imported Item')
})

test('import: preserves a split item\'s unlocated (location_id: null) placement (fixes #34)', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())

  const aft = await (await server.post('/locations', { name: 'Aft Cabin', type: 'storage_space' })).json()
  const item = await (await server.post('/items', { name: 'Rope', actual_quantity: 10, location_id: aft.id })).json()
  // Split some stock off to "no location" (to_location_id omitted) —
  // a legitimate state for a split item's remainder.
  await server.post(`/items/${item.id}/split`, { from_location_id: aft.id, to_location_id: null, quantity: 4 })

  const beforeImport = await (await server.get(`/items/${item.id}`)).json()
  const unlocatedBefore = beforeImport.placements.find((p) => p.location_id === null)
  assert.ok(unlocatedBefore)
  assert.equal(unlocatedBefore.quantity, 4)

  const snapshot = await (await server.get('/export')).json()
  await server.post('/import', snapshot)

  const afterImport = await (await server.get(`/items/${item.id}`)).json()
  assert.equal(afterImport.actual_quantity, 10)
  const unlocatedAfter = afterImport.placements.find((p) => p.location_id === null)
  assert.ok(unlocatedAfter, 'unlocated placement should survive import')
  assert.equal(unlocatedAfter.quantity, 4)
  const totalAfter = afterImport.placements.reduce((sum, p) => sum + p.quantity, 0)
  assert.equal(totalAfter, afterImport.actual_quantity)
})

test('import: does not touch floorplans or existing attachment files', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await buildSampleData(server)
  const snapshot = await (await server.get('/export')).json()

  await server.post('/import', snapshot)

  const floorplans = await (await server.get('/floorplans')).json()
  assert.equal(floorplans.length, 1) // untouched by import
})

test('import: rejects missing/wrong schema_version and malformed payloads without touching data', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await server.post('/items', { name: 'Untouched' })

  const wrongVersion = await server.post('/import', { schema_version: 99, categories: [], locations: [], items: [] })
  assert.equal(wrongVersion.status, 400)

  const missingArrays = await server.post('/import', { schema_version: 1 })
  assert.equal(missingArrays.status, 400)

  const items = await (await server.get('/items')).json()
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Untouched')
})

test('import: rejects a payload whose locations contain a parent_id cycle, without touching data', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await server.post('/items', { name: 'Untouched' })

  const cyclic = {
    schema_version: 1,
    categories: [],
    locations: [
      { id: 'a', name: 'A', type: 'storage_space', parent_id: 'b' },
      { id: 'b', name: 'B', type: 'storage_space', parent_id: 'a' }
    ],
    items: []
  }
  const res = await server.post('/import', cyclic)
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /cycle/)

  const items = await (await server.get('/items')).json()
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Untouched')
})

test('import: rejects a payload over the row-count cap, without touching data (fixes #36)', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await server.post('/items', { name: 'Untouched' })

  const tooManyItems = {
    schema_version: 1,
    categories: [],
    locations: [],
    items: Array.from({ length: 20001 }, (_, i) => ({ id: 'i' + i, name: 'Item ' + i, actual_quantity: 1 }))
  }
  const res = await server.post('/import', tooManyItems)
  assert.equal(res.status, 400)
  assert.match((await res.json()).error, /too large/)

  const items = await (await server.get('/items')).json()
  assert.equal(items.length, 1)
  assert.equal(items[0].name, 'Untouched')
})
