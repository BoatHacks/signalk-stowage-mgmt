const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startTestServer } = require('../../test-helpers/server')
const { initDb } = require('../../plugin/db')

async function json (res) { return res.json() }

test('fresh database has one vessel site named Boat', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const sites = await json(await server.get('/sites'))
  assert.equal(sites.length, 1)
  assert.equal(sites[0].name, 'Boat')
  assert.equal(sites[0].is_vessel, 1)
})

test('migration: pre-site root locations are assigned to the new vessel site, most-used floorplan becomes its default', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stowage-migrate-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { DatabaseSync } = require('node:sqlite')
  const old = new DatabaseSync(path.join(dir, 'inventory.db'))
  old.exec(`
    CREATE TABLE floorplans (id TEXT PRIMARY KEY, name TEXT NOT NULL, svg_content TEXT NOT NULL, uploaded_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE locations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      parent_id TEXT, floorplan_id TEXT, svg_element_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO floorplans (id, name, svg_content) VALUES ('fp1', 'Deck', '<svg/>'), ('fp2', 'Cabin', '<svg/>');
    INSERT INTO locations (id, name, type, parent_id, floorplan_id) VALUES
      ('a', 'Aft', 'storage_space', NULL, 'fp2'),
      ('b', 'Bow', 'storage_space', NULL, 'fp2'),
      ('c', 'Locker', 'container', 'a', NULL),
      ('d', 'Cockpit', 'storage_space', NULL, 'fp1');
  `)
  old.close()

  const db = initDb(dir)
  t.after(() => db.close())
  const sites = db.prepare('SELECT * FROM sites').all()
  assert.equal(sites.length, 1)
  assert.equal(sites[0].is_vessel, 1)
  assert.equal(sites[0].floorplan_id, 'fp2')
  const roots = db.prepare('SELECT id, site_id FROM locations WHERE parent_id IS NULL').all()
  assert.ok(roots.every(r => r.site_id === sites[0].id))
  assert.equal(db.prepare("SELECT site_id FROM locations WHERE id = 'c'").get().site_id, null)
})

test('sites CRUD: vessel flag moves, vessel and non-empty sites cannot be deleted', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]

  assert.equal((await server.post('/sites', {})).status, 400)
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  assert.equal(shed.is_vessel, 0)

  assert.equal((await server.patch(`/sites/${boat.id}`, { is_vessel: false })).status, 409)
  assert.equal((await server.delete(`/sites/${boat.id}`)).status, 409)

  const moved = await json(await server.patch(`/sites/${shed.id}`, { is_vessel: true, name: 'Workshop' }))
  assert.equal(moved.is_vessel, 1)
  assert.equal(moved.name, 'Workshop')
  const after = await json(await server.get('/sites'))
  assert.deepEqual(after.map(s => [s.name, s.is_vessel]), [['Workshop', 1], ['Boat', 0]])

  await server.post('/locations', { name: 'Bunk', type: 'storage_space', site_id: boat.id })
  assert.equal((await server.delete(`/sites/${boat.id}`)).status, 400)
})

test('locations: root defaults to vessel site, children inherit, site_id on a child is rejected', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  const shed = await json(await server.post('/sites', { name: 'Shed' }))

  const bunk = await json(await server.post('/locations', { name: 'Bunk', type: 'storage_space' }))
  assert.equal(bunk.site_id, boat.id)
  const rack = await json(await server.post('/locations', { name: 'Rack', type: 'storage_space', site_id: shed.id }))
  assert.equal(rack.site_id, shed.id)
  const shelf = await json(await server.post('/locations', { name: 'Shelf', type: 'container', parent_id: rack.id }))
  assert.equal(shelf.site_id, shed.id)

  assert.equal((await server.post('/locations', { name: 'X', type: 'container', parent_id: rack.id, site_id: boat.id })).status, 400)
  assert.equal((await server.post('/locations', { name: 'X', type: 'container', site_id: 'nope' })).status, 400)

  const inShed = await json(await server.get(`/locations?site=${shed.id}`))
  assert.deepEqual(inShed.map(l => l.name).sort(), ['Rack', 'Shelf'])
})

test('moving a location under a parent in another site moves its subtree', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  const rack = await json(await server.post('/locations', { name: 'Rack', type: 'storage_space', site_id: shed.id }))
  const locker = await json(await server.post('/locations', { name: 'Locker', type: 'storage_space', site_id: boat.id }))
  const box = await json(await server.post('/locations', { name: 'Box', type: 'container', parent_id: locker.id }))

  await server.patch(`/locations/${locker.id}/move`, { parent_id: rack.id })
  const all = await json(await server.get('/locations'))
  assert.equal(all.find(l => l.id === locker.id).site_id, shed.id)
  assert.equal(all.find(l => l.id === box.id).site_id, shed.id)

  // back to top level in the boat site
  const back = await json(await server.patch(`/locations/${locker.id}/move`, { parent_id: null, site_id: boat.id }))
  assert.equal(back.site_id, boat.id)
  assert.equal((await json(await server.get('/locations'))).find(l => l.id === box.id).site_id, boat.id)
})

test('items: site_quantities, ?site= filter, and cross-site split logged with both locations', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  const bunk = await json(await server.post('/locations', { name: 'Bunk', type: 'storage_space' }))
  const rack = await json(await server.post('/locations', { name: 'Rack', type: 'storage_space', site_id: shed.id }))

  const jib = await json(await server.post('/items', { name: 'Jib', actual_quantity: 3, location_id: bunk.id }))
  await json(await server.post('/items', { name: 'Hammer', actual_quantity: 1, location_id: rack.id }))
  assert.deepEqual(jib.site_quantities, [{ site_id: boat.id, quantity: 3 }])

  assert.deepEqual((await json(await server.get(`/items?site=${shed.id}`))).map(i => i.name), ['Hammer'])

  const split = await json(await server.post(`/items/${jib.id}/split`, { from_location_id: bunk.id, to_location_id: rack.id, quantity: 2 }))
  const bySite = Object.fromEntries(split.site_quantities.map(q => [q.site_id, q.quantity]))
  assert.deepEqual(bySite, { [boat.id]: 1, [shed.id]: 2 })
  assert.deepEqual((await json(await server.get(`/items?site=${shed.id}`))).map(i => i.name), ['Hammer', 'Jib'])

  const shedLog = await json(await server.get(`/item-log?site=${shed.id}`))
  assert.deepEqual(shedLog.map(r => [r.item_name, r.event]), [['Hammer', 'created'], ['Jib', 'split']])
  const boatLog = await json(await server.get(`/item-log?site=${boat.id}`))
  assert.deepEqual(boatLog.map(r => [r.item_name, r.event]), [['Jib', 'created'], ['Jib', 'split']])
})

test('per-site targets: PUT/DELETE, validation, and cascade on site-less items', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  const item = await json(await server.post('/items', { name: 'Hammer', actual_quantity: 1 }))

  const put = (siteId, body) => fetch(`${server.baseUrl}/items/${item.id}/site-targets/${siteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  assert.equal((await put(shed.id, { target_quantity: -1 })).status, 400)
  assert.equal((await put('nope', { target_quantity: 2 })).status, 404)
  const set = await json(await put(shed.id, { target_quantity: 2 }))
  assert.deepEqual(set.site_targets, [{ site_id: shed.id, target_quantity: 2 }])
  const updated = await json(await put(shed.id, { target_quantity: 4 }))
  assert.deepEqual(updated.site_targets, [{ site_id: shed.id, target_quantity: 4 }])
  const cleared = await json(await fetch(`${server.baseUrl}/items/${item.id}/site-targets/${shed.id}`, { method: 'DELETE' }))
  assert.deepEqual(cleared.site_targets, [])
})

test('stock alerts evaluate the vessel site only, using site quantity and the per-site target rule', async (t) => {
  const messages = []
  const server = await startTestServer({ options: { multipleSites: true }, handleMessage: (_id, delta) => messages.push(delta) })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  const bunk = await json(await server.post('/locations', { name: 'Bunk', type: 'storage_space' }))
  const rack = await json(await server.post('/locations', { name: 'Rack', type: 'storage_space', site_id: shed.id }))

  // 2 on the boat + 3 in the shed, item-level target 4: the boat holds 2 < 4.
  const hammer = await json(await server.post('/items', { name: 'Hammer', actual_quantity: 5, target_quantity: 4, location_id: bunk.id }))
  await server.post(`/items/${hammer.id}/split`, { from_location_id: bunk.id, to_location_id: rack.id, quantity: 3 })
  // Lives only in the shed with an item-level target: not evaluated for the vessel.
  await server.post('/items', { name: 'Saw', actual_quantity: 0, target_quantity: 2, location_id: rack.id })

  const stock = () => {
    const values = messages[messages.length - 1].updates[0].values
    return values.find(v => v.path === 'notifications.stowage.stock').value
  }
  const putTarget = (siteId, target) => fetch(`${server.baseUrl}/items/${hammer.id}/site-targets/${siteId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_quantity: target })
  })

  assert.equal(stock().state, 'warn')
  assert.match(stock().message, /1 item understocked \(Hammer\)/)
  assert.doesNotMatch(stock().message, /Saw/)

  // A shed target does not change the vessel's result.
  await putTarget(shed.id, 9)
  assert.match(stock().message, /Hammer/)
  // A boat target of 2 overrides the item-level 4 and the boat's 2 meets it.
  await putTarget(boat.id, 2)
  assert.equal(stock().state, 'normal')
})

test('backup round-trip keeps sites, location sites and per-site targets; pre-site snapshots land in the vessel site', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  const rack = await json(await server.post('/locations', { name: 'Rack', type: 'storage_space', site_id: shed.id }))
  const item = await json(await server.post('/items', { name: 'Hammer', actual_quantity: 1, location_id: rack.id }))
  await fetch(`${server.baseUrl}/items/${item.id}/site-targets/${shed.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_quantity: 3 })
  })

  const snapshot = await json(await server.get('/export'))
  assert.deepEqual(snapshot.sites.map(s => s.name).sort(), ['Boat', 'Shed'])

  // wipe via replace with an empty snapshot, then restore
  await server.post('/import', { schema_version: 1, categories: [], locations: [], items: [] })
  assert.deepEqual((await json(await server.get('/sites'))).map(s => s.name), ['Boat'])

  const restored = await server.post('/import', snapshot)
  assert.equal(restored.status, 200)
  const sites = await json(await server.get('/sites'))
  assert.deepEqual(sites.map(s => s.name).sort(), ['Boat', 'Shed'])
  const locs = await json(await server.get('/locations'))
  assert.equal(locs[0].site_id, shed.id)
  const [back] = await json(await server.get('/items'))
  assert.deepEqual(back.site_targets, [{ site_id: shed.id, target_quantity: 3 }])

  // pre-site snapshot: locations without site_id go to the vessel site
  const legacy = { schema_version: 1, categories: [], locations: [{ id: 'l1', name: 'Old', type: 'storage_space' }], items: [] }
  await server.post('/import', legacy)
  const boat = (await json(await server.get('/sites')))[0]
  assert.equal((await json(await server.get('/locations')))[0].site_id, boat.id)
})

test('merge import: sites matched by name, unmatched ones added, never a second vessel', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  const res = await json(await server.post('/import', {
    schema_version: 1, mode: 'merge', categories: [],
    sites: [
      { id: 'x1', name: 'Boat', is_vessel: 1 },
      { id: 'x2', name: 'Garage', is_vessel: 1 }
    ],
    locations: [
      { id: 'l1', name: 'Shelf', type: 'storage_space', site_id: 'x2' },
      { id: 'l2', name: 'Bunk', type: 'storage_space', site_id: 'x1' }
    ],
    items: []
  }))
  assert.equal(res.added.sites, 1)
  const sites = await json(await server.get('/sites'))
  assert.deepEqual(sites.map(s => [s.name, s.is_vessel]), [['Boat', 1], ['Garage', 0]])
  const locs = Object.fromEntries((await json(await server.get('/locations'))).map(l => [l.name, l.site_id]))
  assert.equal(locs.Bunk, boat.id)
  assert.equal(locs.Shelf, sites[1].id)
})

test('multipleSites off (default): POST /sites is refused, webapp-config says so, existing site untouched', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  const res = await server.post('/sites', { name: 'Shed' })
  assert.equal(res.status, 403)
  assert.match((await json(res)).error, /multiple sites is disabled/)
  assert.equal((await json(await server.get('/webapp-config'))).multipleSites, false)
  assert.equal((await json(await server.get('/sites'))).length, 1)

  const on = await startTestServer({ options: { multipleSites: true } })
  t.after(() => on.close())
  assert.equal((await json(await on.get('/webapp-config'))).multipleSites, true)
})

test('multipleSites off: stock alerts judge the whole inventory on item totals and item targets, ignoring sites', async (t) => {
  const messages = []
  const server = await startTestServer({ handleMessage: (_id, delta) => messages.push(delta) })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  // A second site left over from an earlier run with the option on.
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(path.join(server.dataDir, 'inventory.db'))
  db.prepare("INSERT INTO sites (id, name, is_vessel) VALUES ('shed', 'Shed', 0)").run()
  db.prepare("INSERT INTO locations (id, name, type, site_id) VALUES ('rack', 'Rack', 'storage_space', 'shed')").run()
  db.close()

  // 1 on the boat + 3 in the shed = 4 in total, item target 4: not understocked overall.
  const bunk = await json(await server.post('/locations', { name: 'Bunk', type: 'storage_space', site_id: boat.id }))
  const hammer = await json(await server.post('/items', { name: 'Hammer', actual_quantity: 4, target_quantity: 4, location_id: bunk.id }))
  await server.post(`/items/${hammer.id}/split`, { from_location_id: bunk.id, to_location_id: 'rack', quantity: 3 })
  // Lives only in the shed: still counted, and out of stock.
  const saw = await json(await server.post('/items', { name: 'Saw', location_id: 'rack' }))
  await server.patch(`/items/${saw.id}`, { actual_quantity: 0 })

  const stock = () => messages[messages.length - 1].updates[0].values.find(v => v.path === 'notifications.stowage.stock').value
  assert.equal(stock().state, 'alarm')
  assert.match(stock().message, /1 item out of stock \(Saw\)/)
  assert.doesNotMatch(stock().message, /understocked/)
})

// A snapshot exactly as a pre-multisite plugin version exported it: no
// `sites`, no `site_id` on locations, no `site_targets` on items.
function preMultisiteSnapshot () {
  return {
    schema_version: 1,
    exported_at: '2026-09-01T10:00:00.000Z',
    categories: [{ id: 'cat1', name: 'Electrical', created_at: '2026-08-01 10:00:00' }],
    floorplans: [{ id: 'fp1', name: 'Deck', svg_content: '<svg><path id="p1"/></svg>' }],
    locations: [
      { id: 'aft', name: 'Aft Cabin', type: 'storage_space', parent_id: null, floorplan_id: 'fp1', svg_element_id: 'p1', created_at: '2026-08-01 10:00:00' },
      { id: 'locker', name: 'Locker', type: 'container', parent_id: 'aft', floorplan_id: null, svg_element_id: null, created_at: '2026-08-01 10:00:00' }
    ],
    items: [
      {
        id: 'fuse', name: 'Fuse', actual_quantity: 3, target_quantity: 5, notes: 'spares', location_id: 'locker',
        thumbnail: null, expires_at: null, acquired_date: null, price_paid: null, unit: null, created_at: '2026-08-01 10:00:00',
        category_ids: ['cat1'], placements: [], attachments: []
      },
      {
        id: 'rope', name: 'Rope', actual_quantity: 10, target_quantity: null, notes: null, location_id: null,
        thumbnail: null, expires_at: null, acquired_date: null, price_paid: null, unit: 'm', created_at: '2026-08-01 10:00:00',
        category_ids: [],
        placements: [{ id: 'pl1', location_id: 'aft', quantity: 6 }, { id: 'pl2', location_id: 'locker', quantity: 4 }],
        attachments: []
      }
    ]
  }
}

test('backward compat: a pre-multisite snapshot restores via replace into the vessel site, nothing lost', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  // Floorplans are never created by import; the mapping finds the one with identical content.
  await server.post('/floorplans', { name: 'Deck', svg_content: '<svg><path id="p1"/></svg>' })
  const res = await server.post('/import', preMultisiteSnapshot())
  assert.equal(res.status, 200)
  const body = await json(res)
  assert.deepEqual(body.restored, { categories: 1, sites: 1, locations: 2, items: 2 })

  const boat = (await json(await server.get('/sites')))[0]
  const locs = await json(await server.get('/locations'))
  assert.deepEqual(locs.map(l => [l.id, l.site_id]).sort(), [['aft', boat.id], ['locker', boat.id]])
  assert.equal(locs.find(l => l.id === 'aft').svg_element_id, 'p1')

  const items = Object.fromEntries((await json(await server.get('/items'))).map(i => [i.id, i]))
  assert.equal(items.fuse.location_id, 'locker')
  assert.deepEqual(items.fuse.categories.map(c => c.id), ['cat1'])
  assert.deepEqual(items.fuse.site_targets, [])
  assert.deepEqual(items.rope.placements.map(p => [p.id, p.quantity]).sort(), [['pl1', 6], ['pl2', 4]])
  assert.deepEqual(items.rope.site_quantities, [{ site_id: boat.id, quantity: 10 }])
})

test('backward compat: a pre-multisite snapshot merges into an existing multi-site database via the vessel site', async (t) => {
  const server = await startTestServer({ options: { multipleSites: true } })
  t.after(() => server.close())
  const boat = (await json(await server.get('/sites')))[0]
  const shed = await json(await server.post('/sites', { name: 'Shed' }))
  await server.post('/locations', { name: 'Rack', type: 'storage_space', site_id: shed.id })

  const res = await json(await server.post('/import', Object.assign(preMultisiteSnapshot(), { mode: 'merge' })))
  assert.equal(res.mode, 'merge')
  assert.equal(res.added.sites, 0)
  const locs = Object.fromEntries((await json(await server.get('/locations'))).map(l => [l.name, l.site_id]))
  assert.equal(locs['Aft Cabin'], boat.id)
  assert.equal(locs.Locker, boat.id)
  assert.equal(locs.Rack, shed.id)
  assert.equal((await json(await server.get('/sites'))).length, 2)
})

test('backward compat: an export still contains every pre-multisite field, only adding sites/site_id/site_targets', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  await server.post('/import', preMultisiteSnapshot())
  const exported = await json(await server.get('/export'))
  const legacy = preMultisiteSnapshot()

  assert.equal(exported.schema_version, legacy.schema_version)
  for (const key of Object.keys(legacy)) assert.ok(key in exported, `top-level ${key}`)
  for (const loc of legacy.locations) {
    const got = exported.locations.find(l => l.id === loc.id)
    for (const key of Object.keys(loc)) assert.ok(key in got, `location.${key}`)
  }
  for (const item of legacy.items) {
    const got = exported.items.find(i => i.id === item.id)
    for (const key of Object.keys(item)) assert.ok(key in got, `item.${key}`)
  }
  // And what a pre-multisite plugin would read from it still validates there:
  // the same required arrays are present.
  assert.ok(Array.isArray(exported.categories) && Array.isArray(exported.locations) && Array.isArray(exported.items))
})

test('backward compat: re-importing a snapshot with sites that carries a dangling site_id puts the location in the vessel site', async (t) => {
  const server = await startTestServer()
  t.after(() => server.close())
  const snap = preMultisiteSnapshot()
  snap.locations[0].site_id = 'no-such-site'
  await server.post('/import', snap)
  const boat = (await json(await server.get('/sites')))[0]
  assert.equal((await json(await server.get('/locations'))).find(l => l.id === 'aft').site_id, boat.id)
})
