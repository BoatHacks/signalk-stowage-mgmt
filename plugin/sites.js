// Helpers for resolving which site a location, placement or item belongs to
// (#83). Only root locations store a site_id; every other location takes its
// root's, so the answer is computed by walking parent_id instead of being
// kept in sync on re-parenting.

function getVesselSiteId (db) {
  const row = db.prepare('SELECT id FROM sites WHERE is_vessel = 1').get()
  return row ? row.id : null
}

// Map of every location id -> the id of the site its root belongs to.
// parent_id cycles are rejected on write, but the walk is bounded anyway.
function buildLocationSiteMap (db) {
  const rows = db.prepare('SELECT id, parent_id, site_id FROM locations').all()
  const byId = new Map(rows.map(r => [r.id, r]))
  const siteOf = new Map()
  for (const row of rows) {
    let cursor = row
    let hops = 0
    while (cursor.parent_id && byId.has(cursor.parent_id) && hops++ <= rows.length) {
      cursor = byId.get(cursor.parent_id)
    }
    siteOf.set(row.id, cursor.site_id || null)
  }
  return siteOf
}

function getLocationSiteId (db, locationId) {
  if (!locationId) return null
  return buildLocationSiteMap(db).get(locationId) || null
}

// Map of item id -> Map(site id -> quantity held there). An item with no
// location, a placement with no location, or one pointing at a location
// without a site all count towards the vessel site, which is where
// everything lived before sites existed.
function buildItemSiteQuantities (db) {
  const vesselId = getVesselSiteId(db)
  const siteOf = buildLocationSiteMap(db)
  const resolve = (locationId) => (locationId && siteOf.get(locationId)) || vesselId
  const result = new Map()
  const add = (itemId, siteId, quantity) => {
    if (!siteId) return
    if (!result.has(itemId)) result.set(itemId, new Map())
    const perSite = result.get(itemId)
    perSite.set(siteId, (perSite.get(siteId) || 0) + quantity)
  }

  const placementsByItem = new Map()
  for (const p of db.prepare('SELECT item_id, location_id, quantity FROM item_placements').all()) {
    if (!placementsByItem.has(p.item_id)) placementsByItem.set(p.item_id, [])
    placementsByItem.get(p.item_id).push(p)
  }
  for (const item of db.prepare('SELECT id, location_id, actual_quantity FROM items').all()) {
    const placements = placementsByItem.get(item.id)
    if (placements) {
      for (const p of placements) add(item.id, resolve(p.location_id), p.quantity)
    } else {
      add(item.id, resolve(item.location_id), item.actual_quantity)
    }
  }
  return result
}

module.exports = { getVesselSiteId, buildLocationSiteMap, getLocationSiteId, buildItemSiteQuantities }
