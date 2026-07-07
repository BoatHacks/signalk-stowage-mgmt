const API_BASE = '/plugins/signalk-stowage-mgmt'

const state = {
  locations: [],
  items: [],
  floorplans: [],
  categories: [],
  currentFloorplanId: null
}

// ---------- API helpers ----------

async function api (path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error((body && body.error) || `request failed (${res.status})`)
  return body
}

async function loadAll () {
  const [locations, items, floorplans, categories] = await Promise.all([
    api('/locations'),
    api('/items'),
    api('/floorplans'),
    api('/categories')
  ])
  state.locations = locations
  state.items = items
  state.floorplans = floorplans
  state.categories = categories
}

// ---------- toast ----------

let toastTimer = null
function toast (message) {
  const el = document.getElementById('toast')
  el.textContent = message
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600)
}

// ---------- tree helpers ----------

function childLocations (parentId) {
  return state.locations.filter(l => (l.parent_id || null) === (parentId || null))
}

function itemsIn (locationId) {
  return state.items.filter(i => (i.location_id || null) === (locationId || null))
}

// all descendant location ids of `loc`, used to prevent cycles when moving
function descendantIds (locationId) {
  const ids = []
  const stack = [locationId]
  while (stack.length) {
    const current = stack.pop()
    for (const child of childLocations(current)) {
      ids.push(child.id)
      stack.push(child.id)
    }
  }
  return ids
}

function pathToRoot (locationId) {
  const names = []
  let cursor = state.locations.find(l => l.id === locationId)
  while (cursor) {
    names.unshift(cursor.name)
    cursor = cursor.parent_id ? state.locations.find(l => l.id === cursor.parent_id) : null
  }
  return names.join(' \u2192 ')
}

// Walks the parent chain (client-side, mirrors the /locate endpoint) to find
// the nearest storage space that has an SVG area assigned, without a round trip.
function findMappedStorageSpace (locationId) {
  let cursor = state.locations.find(l => l.id === locationId)
  while (cursor) {
    if (cursor.type === 'storage_space' && cursor.floorplan_id && cursor.svg_element_id) return cursor
    cursor = cursor.parent_id ? state.locations.find(l => l.id === cursor.parent_id) : null
  }
  return null
}

// ---------- rendering: tree ----------

function renderTree () {
  const root = document.getElementById('tree-root')
  root.innerHTML = ''

  const topLevel = childLocations(null)
  if (topLevel.length === 0) {
    root.innerHTML = '<p class="hint">No storage spaces created yet.</p>'
  }
  topLevel.filter(l => l.type === 'storage_space').forEach(loc => root.appendChild(renderNode(loc)))

  const unassigned = itemsIn(null)
  if (unassigned.length) {
    const wrap = document.createElement('div')
    wrap.className = 'node'
    wrap.innerHTML = '<div class="node-header"><span class="node-title">No Location</span><span class="node-type">unassigned</span></div>'
    const list = document.createElement('div')
    list.className = 'children'
    unassigned.forEach(item => list.appendChild(renderItemRow(item)))
    wrap.appendChild(list)
    root.appendChild(wrap)
  }
}

function renderNode (loc) {
  const el = document.createElement('div')
  el.className = 'node'

  const header = document.createElement('div')
  header.className = 'node-header'

  const mappedBadge = loc.type === 'storage_space' && loc.svg_element_id
    ? '<span class="svg-mapped-badge">im Grundriss</span>'
    : ''

  header.innerHTML = `
    <span>
      <span class="node-title">${escapeHtml(loc.name)}</span>
      <span class="node-type">${loc.type === 'storage_space' ? 'Storage Space' : 'Container'}</span>
      ${mappedBadge}
    </span>
  `

  const actions = document.createElement('div')
  actions.className = 'node-actions'

  const addContainerBtn = mkBtn('+ Container', () => addContainer(loc.id))
  const addItemBtn = mkBtn('+ Item', () => addItem(loc.id))
  actions.appendChild(addContainerBtn)
  actions.appendChild(addItemBtn)

  if (loc.type === 'container') {
    actions.appendChild(mkBtn('Verschieben', () => moveLocation(loc)))
  }
  actions.appendChild(mkBtn('Delete', () => deleteLocation(loc)))

  header.appendChild(actions)
  el.appendChild(header)

  const children = childLocations(loc.id)
  const items = itemsIn(loc.id)
  if (children.length || items.length) {
    const childWrap = document.createElement('div')
    childWrap.className = 'children'
    children.forEach(child => childWrap.appendChild(renderNode(child)))
    items.forEach(item => childWrap.appendChild(renderItemRow(item)))
    el.appendChild(childWrap)
  }

  return el
}

function renderItemRow (item) {
  const row = document.createElement('div')
  row.className = 'item-row'

  const main = document.createElement('div')
  main.className = 'item-row-main'
  main.innerHTML = `<span>${escapeHtml(item.name)}<span class="qty">×${item.quantity}</span></span>`
  const actions = document.createElement('span')
  actions.appendChild(mkBtn('Verschieben', () => moveItem(item)))
  actions.appendChild(mkBtn('Delete', () => deleteItem(item)))
  main.appendChild(actions)
  row.appendChild(main)

  const catRow = document.createElement('div')
  catRow.className = 'item-categories'
  ;(item.categories || []).forEach(cat => {
    const badge = document.createElement('span')
    badge.className = 'category-badge'
    badge.innerHTML = `${escapeHtml(cat.name)} `
    const removeBtn = document.createElement('button')
    removeBtn.textContent = '×'
    removeBtn.title = `"${cat.name}" von diesem Item entfernen`
    removeBtn.onclick = (e) => { e.stopPropagation(); removeCategoryFromItem(item, cat.id) }
    badge.appendChild(removeBtn)
    catRow.appendChild(badge)
  })
  const addBtn = document.createElement('button')
  addBtn.className = 'add-category-inline'
  addBtn.textContent = '+ Category'
  addBtn.onclick = (e) => { e.stopPropagation(); addCategoryToItem(item) }
  catRow.appendChild(addBtn)
  row.appendChild(catRow)

  return row
}

function mkBtn (label, onClick) {
  const b = document.createElement('button')
  b.textContent = label
  b.onclick = onClick
  return b
}

function escapeHtml (str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ---------- location / item actions ----------

async function addStorageSpace () {
  const name = prompt('Name of the new storage space (e.g. "Lazarette"):')
  if (!name) return
  await api('/locations', { method: 'POST', body: JSON.stringify({ name, type: 'storage_space' }) })
  await refresh()
}

async function addContainer (parentId) {
  const name = prompt('Name of the new container (e.g. "First Aid Box"):')
  if (!name) return
  await api('/locations', { method: 'POST', body: JSON.stringify({ name, type: 'container', parent_id: parentId }) })
  await refresh()
}

async function addItem (locationId) {
  const name = prompt('Item-Name:')
  if (!name) return
  const qtyRaw = prompt('Quantity:', '1')
  const quantity = parseInt(qtyRaw, 10) || 1

  let categoryIds = []
  if (state.categories.length) {
    const listStr = state.categories.map((c, i) => `${i + 1}: ${c.name}`).join('\n')
    const catAnswer = prompt(`Assign categories (comma-separated numbers, optional):\n${listStr}`, '')
    if (catAnswer) {
      categoryIds = catAnswer.split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(i => i > 0 && i <= state.categories.length)
        .map(i => state.categories[i - 1].id)
    }
  }

  await api('/items', { method: 'POST', body: JSON.stringify({ name, quantity, location_id: locationId, category_ids: categoryIds }) })
  await refresh()
}

async function addCategoryToItem (item) {
  const assignedIds = new Set((item.categories || []).map(c => c.id))
  const available = state.categories.filter(c => !assignedIds.has(c.id))
  if (!available.length) return toast('All existing categories are already assigned to this item.')
  const listStr = available.map((c, i) => `${i + 1}: ${c.name}`).join('\n')
  const answer = prompt(`Which category to add to "${item.name}"?\n${listStr}`)
  if (answer === null) return
  const idx = parseInt(answer, 10)
  if (idx > 0 && idx <= available.length) {
    await api(`/items/${item.id}/categories`, { method: 'POST', body: JSON.stringify({ category_id: available[idx - 1].id }) })
    await refresh()
  }
}

async function removeCategoryFromItem (item, categoryId) {
  await api(`/items/${item.id}/categories/${categoryId}`, { method: 'DELETE' })
  await refresh()
}

async function moveLocation (loc) {
  const forbidden = new Set([loc.id, ...descendantIds(loc.id)])
  const targets = state.locations.filter(l => !forbidden.has(l.id))
  if (!targets.length) return toast('No valid target available.')
  const listStr = targets.map((t, i) => `${i + 1}: ${pathToRoot(t.id)} [${t.type === 'storage_space' ? 'Storage Space' : 'Container'}]`).join('\n')
  const answer = prompt(`"${loc.name}" wohin verschieben?\n0 = oberste Ebene\n${listStr}`)
  if (answer === null) return
  const idx = parseInt(answer, 10)
  if (idx === 0) {
    await api(`/locations/${loc.id}/move`, { method: 'PATCH', body: JSON.stringify({ parent_id: null }) })
  } else if (idx > 0 && idx <= targets.length) {
    await api(`/locations/${loc.id}/move`, { method: 'PATCH', body: JSON.stringify({ parent_id: targets[idx - 1].id }) })
  } else {
    return
  }
  await refresh()
}

async function moveItem (item) {
  const listStr = state.locations.map((l, i) => `${i + 1}: ${pathToRoot(l.id)} [${l.type === 'storage_space' ? 'Storage Space' : 'Container'}]`).join('\n')
  const answer = prompt(`"${item.name}" wohin verschieben?\n0 = ohne Ort\n${listStr}`)
  if (answer === null) return
  const idx = parseInt(answer, 10)
  if (idx === 0) {
    await api(`/items/${item.id}/move`, { method: 'PATCH', body: JSON.stringify({ location_id: null }) })
  } else if (idx > 0 && idx <= state.locations.length) {
    await api(`/items/${item.id}/move`, { method: 'PATCH', body: JSON.stringify({ location_id: state.locations[idx - 1].id }) })
  } else {
    return
  }
  await refresh()
}

async function deleteLocation (loc) {
  if (!confirm(`Really delete "${loc.name}"?`)) return
  try {
    await api(`/locations/${loc.id}`, { method: 'DELETE' })
    await refresh()
  } catch (e) {
    toast(e.message)
  }
}

async function deleteItem (item) {
  if (!confirm(`Really delete "${item.name}"?`)) return
  await api(`/items/${item.id}`, { method: 'DELETE' })
  await refresh()
}

// ---------- floorplan tab ----------

function populateFloorplanSelect () {
  const select = document.getElementById('floorplan-select')
  const current = select.value
  select.innerHTML = '<option value="">Select floorplan…</option>'
  state.floorplans.forEach(fp => {
    const opt = document.createElement('option')
    opt.value = fp.id
    opt.textContent = fp.name
    select.appendChild(opt)
  })
  if (current) select.value = current
}

async function loadFloorplan (floorplanId) {
  const container = document.getElementById('floorplan-container')
  if (!floorplanId) {
    container.innerHTML = '<p class="hint">Select a floorplan above or upload an SVG file.</p>'
    state.currentFloorplanId = null
    return
  }
  const fp = await api(`/floorplans/${floorplanId}`)
  state.currentFloorplanId = floorplanId
  container.innerHTML = fp.svg_content

  const svg = container.querySelector('svg')
  if (!svg) {
    container.innerHTML = '<p class="hint">This file does not contain a valid &lt;svg&gt;.</p>'
    return
  }

  // Any shape-like element that already has an id in the source SVG can be
  // assigned to a storage space. Elements without an id can't be targeted —
  // add ids to the areas you care about in the SVG source (e.g. in Inkscape's
  // Object Properties panel) before uploading.
  const assignable = svg.querySelectorAll('path[id], polygon[id], rect[id], circle[id], ellipse[id]')
  const mappedElementIds = new Set(
    state.locations
      .filter(l => l.floorplan_id === floorplanId && l.svg_element_id)
      .map(l => l.svg_element_id)
  )

  assignable.forEach(el => {
    el.setAttribute('data-assignable', 'true')
    if (mappedElementIds.has(el.id)) el.setAttribute('data-mapped', 'true')
    el.addEventListener('click', () => assignAreaToStorageSpace(el.id))
  })

  document.getElementById('assign-hint').textContent =
    `${assignable.length} assignable area(s) found. Click an area to assign it to a storage space.`
}

async function assignAreaToStorageSpace (svgElementId) {
  const storageSpaces = state.locations.filter(l => l.type === 'storage_space')
  if (!storageSpaces.length) return toast('Create a storage space in the "Inventory" tab first.')

  const listStr = storageSpaces
    .map((s, i) => `${i + 1}: ${s.name}${s.svg_element_id === svgElementId ? ' (aktuell zugeordnet)' : ''}`)
    .join('\n')
  const answer = prompt(`Assign area "${svgElementId}" to which storage space?\n0 = remove assignment\n${listStr}`)
  if (answer === null) return
  const idx = parseInt(answer, 10)

  // Clear any existing location that already points at this exact element,
  // so an SVG area never maps to more than one storage space.
  const existingOwner = state.locations.find(
    l => l.floorplan_id === state.currentFloorplanId && l.svg_element_id === svgElementId
  )
  if (existingOwner) {
    await api(`/locations/${existingOwner.id}/svg-mapping`, {
      method: 'PATCH',
      body: JSON.stringify({ floorplan_id: null, svg_element_id: null })
    })
  }

  if (idx > 0 && idx <= storageSpaces.length) {
    await api(`/locations/${storageSpaces[idx - 1].id}/svg-mapping`, {
      method: 'PATCH',
      body: JSON.stringify({ floorplan_id: state.currentFloorplanId, svg_element_id: svgElementId })
    })
  }

  await refresh()
  await loadFloorplan(state.currentFloorplanId)
}

async function uploadFloorplan (file) {
  const text = await file.text()
  if (!text.includes('<svg')) return toast('This is not a valid SVG file.')
  const fp = await api('/floorplans', {
    method: 'POST',
    body: JSON.stringify({ name: file.name.replace(/\.svg$/i, ''), svg_content: text })
  })
  await refresh()
  document.getElementById('floorplan-select').value = fp.id
  await loadFloorplan(fp.id)
}

// ---------- search + locate/blink ----------

let blinkTimer = null

function renderSearchResults (query) {
  const box = document.getElementById('search-results')
  if (!query) {
    box.classList.remove('open')
    box.innerHTML = ''
    return
  }
  const q = query.toLowerCase()
  const matches = state.items.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8)
  if (!matches.length) {
    box.innerHTML = '<div class="search-result">Keine Treffer</div>'
    box.classList.add('open')
    return
  }
  box.innerHTML = ''
  matches.forEach(item => {
    const row = document.createElement('div')
    row.className = 'search-result'
    const where = item.location_id ? pathToRoot(item.location_id) : 'no location'
    row.innerHTML = `${escapeHtml(item.name)}<span class="path">${escapeHtml(where)}</span>`
    row.onclick = () => locateItem(item)
    box.appendChild(row)
  })
  box.classList.add('open')
}

async function locateItem (item) {
  document.getElementById('search-results').classList.remove('open')
  document.getElementById('search-input').value = item.name
  try {
    const result = await api(`/items/${item.id}/locate`)
    switchTab('floorplan')
    document.getElementById('floorplan-select').value = result.floorplan_id
    await loadFloorplan(result.floorplan_id)

    const svg = document.querySelector('#floorplan-container svg')
    const target = svg && svg.getElementById(result.svg_element_id)
    clearTimeout(blinkTimer)
    document.querySelectorAll('.inv-blinking').forEach(el => el.classList.remove('inv-blinking'))
    if (target) {
      target.classList.add('inv-blinking')
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      blinkTimer = setTimeout(() => target.classList.remove('inv-blinking'), 6000)
      toast(`"${item.name}" is located in ${result.storage_space.name}`)
    }
  } catch (e) {
    toast(`"${item.name}": ${e.message}`)
  }
}

// ---------- overview table ----------

const overviewState = { sortKey: 'fullPath', sortDir: 1, filter: '' }

function buildOverviewRows () {
  return state.items.map(item => {
    const directLoc = item.location_id ? state.locations.find(l => l.id === item.location_id) : null
    const mapped = item.location_id ? findMappedStorageSpace(item.location_id) : null
    const categoryNames = (item.categories || []).map(c => c.name).join(', ')
    return {
      item,
      name: item.name,
      quantity: item.quantity,
      directLocation: directLoc ? directLoc.name : '\u2014',
      directType: directLoc ? (directLoc.type === 'storage_space' ? 'Storage Space' : 'Container') : '',
      fullPath: item.location_id ? pathToRoot(item.location_id) : 'no location',
      categoryNames: categoryNames || '\u2014',
      onFloorplan: !!mapped
    }
  })
}

function renderOverview () {
  const tbody = document.getElementById('overview-tbody')
  let rows = buildOverviewRows()

  if (overviewState.filter) {
    const q = overviewState.filter.toLowerCase()
    rows = rows.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.directLocation.toLowerCase().includes(q) ||
      r.fullPath.toLowerCase().includes(q) ||
      r.categoryNames.toLowerCase().includes(q)
    )
  }

  rows.sort((a, b) => {
    const va = a[overviewState.sortKey]
    const vb = b[overviewState.sortKey]
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * overviewState.sortDir
    return String(va).localeCompare(String(vb)) * overviewState.sortDir
  })

  document.querySelectorAll('#overview-table th').forEach(th => {
    const arrow = th.dataset.sort === overviewState.sortKey ? (overviewState.sortDir === 1 ? ' \u2191' : ' \u2193') : ''
    th.querySelectorAll('.sort-arrow').forEach(a => a.remove())
    if (arrow) {
      const span = document.createElement('span')
      span.className = 'sort-arrow'
      span.textContent = arrow.trim()
      th.appendChild(span)
    }
  })

  tbody.innerHTML = ''
  if (!rows.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Keine Items gefunden.</td></tr>'
    return
  }

  rows.forEach(r => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${escapeHtml(r.name)}</td>
      <td>${r.quantity}</td>
      <td>${escapeHtml(r.directLocation)}${r.directType ? ` <span class="node-type">${r.directType}</span>` : ''}</td>
      <td>${escapeHtml(r.fullPath)}</td>
      <td>${escapeHtml(r.categoryNames)}</td>
      <td>${r.onFloorplan ? '<span class="badge-yes">ja</span>' : '<span class="badge-no">nein</span>'}</td>
    `
    tr.onclick = () => locateItem(r.item)
    tbody.appendChild(tr)
  })
}

// ---------- category management ----------

async function addCategory () {
  const name = prompt('Name of the new category (e.g. "Electrical"):')
  if (!name) return
  try {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name }) })
    await refresh()
  } catch (e) {
    toast(e.message)
  }
}

async function renameCategory (cat) {
  const name = prompt('New name:', cat.name)
  if (!name || name === cat.name) return
  try {
    await api(`/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ name }) })
    await refresh()
  } catch (e) {
    toast(e.message)
  }
}

async function deleteCategory (cat) {
  const count = state.items.filter(i => (i.categories || []).some(c => c.id === cat.id)).length
  const warning = count > 0 ? ` Sie ist aktuell ${count} Item(s) zugeordnet — diese Zuordnung wird ebenfalls entfernt.` : ''
  if (!confirm(`Really delete category "${cat.name}"?${warning}`)) return
  await api(`/categories/${cat.id}`, { method: 'DELETE' })
  await refresh()
}

function renderCategories () {
  const list = document.getElementById('categories-list')
  list.innerHTML = ''
  if (!state.categories.length) {
    list.innerHTML = '<p class="hint">No categories created yet.</p>'
    return
  }
  state.categories.forEach(cat => {
    const count = state.items.filter(i => (i.categories || []).some(c => c.id === cat.id)).length
    const row = document.createElement('div')
    row.className = 'category-row'
    row.innerHTML = `<span>${escapeHtml(cat.name)}<span class="category-count">${count} Item(s)</span></span>`
    const actions = document.createElement('span')
    actions.appendChild(mkBtn('Umbenennen', () => renameCategory(cat)))
    actions.appendChild(mkBtn('Delete', () => deleteCategory(cat)))
    row.appendChild(actions)
    list.appendChild(row)
  })
}

// ---------- tabs ----------

function switchTab (name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`))
}

// ---------- wiring ----------

async function refresh () {
  await loadAll()
  renderTree()
  populateFloorplanSelect()
  renderOverview()
  renderCategories()
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('add-storage-space').onclick = addStorageSpace
  document.getElementById('add-category').onclick = addCategory

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab)
  })

  document.getElementById('floorplan-select').onchange = e => loadFloorplan(e.target.value)
  document.getElementById('floorplan-upload').onchange = e => {
    if (e.target.files[0]) uploadFloorplan(e.target.files[0])
    e.target.value = ''
  }

  document.querySelectorAll('#overview-table th[data-sort]').forEach(th => {
    th.onclick = () => {
      const key = th.dataset.sort
      if (overviewState.sortKey === key) {
        overviewState.sortDir *= -1
      } else {
        overviewState.sortKey = key
        overviewState.sortDir = 1
      }
      renderOverview()
    }
  })

  document.getElementById('overview-filter').addEventListener('input', e => {
    overviewState.filter = e.target.value.trim()
    renderOverview()
  })

  const searchInput = document.getElementById('search-input')
  searchInput.addEventListener('input', () => renderSearchResults(searchInput.value.trim()))
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-box')) document.getElementById('search-results').classList.remove('open')
  })

  try {
    await refresh()
  } catch (e) {
    toast('Error loading: ' + e.message)
  }
})
