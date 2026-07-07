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
  const storageSpaces = topLevel.filter(l => l.type === 'storage_space')
  if (storageSpaces.length === 0) {
    root.innerHTML = '<p class="hint">No storage spaces created yet.</p>'
  }
  storageSpaces.forEach(loc => root.appendChild(renderNode(loc)))

  renderOrphanedPanel()
}

function renderOrphanedPanel () {
  const panel = document.getElementById('orphaned-panel')
  panel.innerHTML = ''

  const title = document.createElement('div')
  title.className = 'orphaned-panel-title'
  title.textContent = 'Not Stored'
  panel.appendChild(title)

  const dropHeader = document.createElement('div')
  dropHeader.className = 'node-header'
  dropHeader.innerHTML = '<span class="node-title">Drop here to unassign</span>'
  addDropTargetHandlers(dropHeader, null)
  panel.appendChild(dropHeader)

  // Top-level containers (parent_id null) aren't nested under any storage
  // space, so they'd otherwise be invisible in the main tree — surface them
  // here along with their own children/items.
  const orphanedContainers = childLocations(null).filter(l => l.type === 'container')
  orphanedContainers.forEach(loc => panel.appendChild(renderNode(loc)))

  const unassigned = itemsIn(null)
  if (unassigned.length) {
    const list = document.createElement('div')
    list.className = 'children'
    unassigned.forEach(item => list.appendChild(renderItemRow(item)))
    panel.appendChild(list)
  }

  if (!orphanedContainers.length && !unassigned.length) {
    const empty = document.createElement('p')
    empty.className = 'hint'
    empty.textContent = 'Nothing unstored right now.'
    panel.appendChild(empty)
  }

  updateOrphanedPanelVisibility()
}

let dragDepth = 0
let currentTab = 'tree'
function updateOrphanedPanelVisibility () {
  const panel = document.getElementById('orphaned-panel')
  const hiddenForTab = currentTab === 'overview' || currentTab === 'categories' || currentTab === 'understocked'
  const hasOrphans = childLocations(null).some(l => l.type === 'container') || itemsIn(null).length > 0
  if (!hiddenForTab && (hasOrphans || dragDepth > 0)) {
    panel.classList.remove('hidden')
  } else {
    panel.classList.add('hidden')
  }
}
function showNoLocationPanel () {
  dragDepth++
  updateOrphanedPanelVisibility()
}
function hideNoLocationPanel () {
  dragDepth = Math.max(0, dragDepth - 1)
  updateOrphanedPanelVisibility()
}

// Wires up an element as a drag-and-drop target for items and containers.
// `locationId` is the destination (null = unassign item / move container to top level).
function addDropTargetHandlers (el, locationId) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    el.classList.add('drop-target')
  })
  el.addEventListener('dragleave', () => {
    el.classList.remove('drop-target')
  })
  el.addEventListener('drop', async (e) => {
    e.preventDefault()
    el.classList.remove('drop-target')
    const dragType = e.dataTransfer.getData('application/x-drag-type')
    const draggedId = e.dataTransfer.getData('text/plain')
    if (!draggedId) return

    try {
      if (dragType === 'container') {
        if (draggedId === locationId) return
        const forbidden = new Set([draggedId, ...descendantIds(draggedId)])
        if (forbidden.has(locationId)) return toast("Can't move a container into itself or its own contents.")
        const loc = state.locations.find(l => l.id === draggedId)
        if (!loc || (loc.parent_id || null) === (locationId || null)) return
        await api(`/locations/${draggedId}/move`, { method: 'PATCH', body: JSON.stringify({ parent_id: locationId }) })
      } else {
        const item = state.items.find(i => i.id === draggedId)
        if (!item || (item.location_id || null) === (locationId || null)) return
        await api(`/items/${draggedId}/move`, { method: 'PATCH', body: JSON.stringify({ location_id: locationId }) })
      }
      await refresh()
    } catch (err) {
      toast(err.message)
    }
  })
}

function renderNode (loc) {
  const el = document.createElement('div')
  el.className = 'node'

  const header = document.createElement('div')
  header.className = 'node-header'
  header.dataset.locationId = loc.id

  addDropTargetHandlers(header, loc.id)

  if (loc.type === 'container') {
    header.draggable = true
    header.classList.add('draggable-node')
    header.addEventListener('dragstart', (e) => {
      e.stopPropagation()
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', loc.id)
      e.dataTransfer.setData('application/x-drag-type', 'container')
      header.classList.add('dragging')
      showNoLocationPanel()
    })
    header.addEventListener('dragend', () => {
      header.classList.remove('dragging')
      hideNoLocationPanel()
    })
  }

  const mappedBadge = loc.type === 'storage_space' && loc.svg_element_id
    ? '<span class="svg-mapped-badge">on plan</span>'
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
    actions.appendChild(mkIconBtn('move', 'Move', () => moveLocation(loc)))
  }
  actions.appendChild(mkIconBtn('delete', 'Delete', () => deleteLocation(loc), 'danger'))

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
  row.draggable = true
  row.dataset.itemId = item.id

  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', item.id)
    e.dataTransfer.setData('application/x-drag-type', 'item')
    row.classList.add('dragging')
    showNoLocationPanel()
  })
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging')
    hideNoLocationPanel()
  })

  const main = document.createElement('div')
  main.className = 'item-row-main'
  const thumb = item.thumbnail
    ? `<img class="item-thumb" src="${item.thumbnail}" alt="">`
    : '<span class="item-thumb item-thumb-placeholder"></span>'
  const info = document.createElement('span')
  info.innerHTML = `${thumb}${escapeHtml(item.name)}`
  info.appendChild(renderQuantityDisplay(item, { prefix: '×', className: 'qty' }))
  if (item.target_quantity !== null && item.target_quantity !== undefined) {
    const target = document.createElement('span')
    target.className = 'qty-target-inline'
    target.textContent = ` / ${item.target_quantity}`
    target.title = 'Target quantity'
    info.appendChild(target)
  }
  main.appendChild(info)
  const actions = document.createElement('span')
  actions.appendChild(mkIconBtn('edit', 'Edit', () => openItemPropertiesDialog(item)))
  actions.appendChild(mkIconBtn('photo', 'Photo', () => openPhotoDialog(item)))
  actions.appendChild(mkIconBtn('move', 'Move', () => moveItem(item)))
  actions.appendChild(mkIconBtn('delete', 'Delete', () => deleteItem(item), 'danger'))
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
    removeBtn.title = `Remove "${cat.name}" from this item`
    removeBtn.onclick = (e) => { e.stopPropagation(); removeCategoryFromItem(item, cat.id) }
    badge.appendChild(removeBtn)
    catRow.appendChild(badge)
  })
  const addBtn = document.createElement('button')
  addBtn.className = 'add-category-inline'
  addBtn.textContent = '+ Category'
  addBtn.onclick = (e) => { e.stopPropagation(); openCategoryDialog(item) }
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

const ICONS = {
  photo: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  move: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>',
  delete: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  notes: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h13l3 3v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M17 3v4h4"/><line x1="7" y1="10" x2="15" y2="10"/><line x1="7" y1="14" x2="15" y2="14"/><line x1="7" y1="18" x2="12" y2="18"/></svg>'
}

function mkIconBtn (icon, label, onClick, extraClass) {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'icon-btn' + (extraClass ? ' ' + extraClass : '')
  b.innerHTML = ICONS[icon]
  b.title = label
  b.setAttribute('aria-label', label)
  b.onclick = onClick
  return b
}

// ---------- editable quantity ----------

function renderQuantityDisplay (item, opts = {}) {
  const field = opts.field || 'actual_quantity'
  const display = document.createElement('span')
  display.className = 'qty-display' + (opts.className ? ' ' + opts.className : '')
  display.textContent = `${opts.prefix || ''}${item[field]}`
  display.title = 'Click to edit quantity'
  display.onclick = (e) => {
    e.stopPropagation()
    startQuantityEdit(item, display, opts)
  }
  return display
}

function startQuantityEdit (item, display, opts = {}) {
  const field = opts.field || 'actual_quantity'
  let resolved = false

  const editor = document.createElement('span')
  editor.className = 'qty-editor'
  editor.onclick = (e) => e.stopPropagation()
  editor.onmousedown = (e) => e.stopPropagation()

  const input = document.createElement('input')
  input.type = 'number'
  input.className = 'qty-input'
  input.min = '0'
  input.step = '1'
  input.value = item[field]

  const steppers = document.createElement('span')
  steppers.className = 'qty-steppers'
  const upBtn = document.createElement('button')
  upBtn.type = 'button'
  upBtn.className = 'qty-step qty-up'
  upBtn.textContent = '▲'
  upBtn.setAttribute('aria-label', 'Increase quantity')
  const downBtn = document.createElement('button')
  downBtn.type = 'button'
  downBtn.className = 'qty-step qty-down'
  downBtn.textContent = '▼'
  downBtn.setAttribute('aria-label', 'Decrease quantity')
  steppers.append(upBtn, downBtn)

  editor.append(input, steppers)

  const step = (delta) => {
    input.value = Math.max(0, (parseInt(input.value, 10) || 0) + delta)
  }
  // Prevent the buttons from stealing focus on mousedown — otherwise the
  // input's blur handler would commit/tear down the editor before the
  // click handler ever runs.
  upBtn.onmousedown = (e) => e.preventDefault()
  downBtn.onmousedown = (e) => e.preventDefault()
  upBtn.onclick = (e) => { e.stopPropagation(); step(1) }
  downBtn.onclick = (e) => { e.stopPropagation(); step(-1) }

  const finish = (newDisplay) => {
    if (resolved) return
    resolved = true
    editor.replaceWith(newDisplay)
  }
  const cancel = () => finish(renderQuantityDisplay(item, opts))
  const commit = async () => {
    if (resolved) return
    const value = Math.max(0, parseInt(input.value, 10) || 0)
    if (value === item[field]) return cancel()
    resolved = true
    try {
      await api(`/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) })
      await refresh()
      if (typeof opts.onSaved === 'function') opts.onSaved()
    } catch (err) {
      toast(err.message)
      resolved = false
      cancel()
    }
  }

  input.onkeydown = (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') cancel()
  }
  input.onblur = () => commit()

  display.replaceWith(editor)
  input.focus()
  input.select()
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
  const name = prompt('Item Name:')
  if (!name) return
  const qtyRaw = prompt('Actual Quantity:', '1')
  const actualQuantity = parseInt(qtyRaw, 10) || 1

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

  await api('/items', { method: 'POST', body: JSON.stringify({ name, actual_quantity: actualQuantity, location_id: locationId, category_ids: categoryIds }) })
  await refresh()
}

let categoryModalItemId = null

function closeCategoryModal () {
  document.getElementById('category-modal-overlay').classList.add('hidden')
  categoryModalItemId = null
}

function openCategoryDialog (item) {
  categoryModalItemId = item.id
  document.getElementById('category-modal-title').textContent = `Categories for "${item.name}"`
  renderCategoryModalChips()
  document.getElementById('category-modal-overlay').classList.remove('hidden')
}

function renderCategoryModalChips () {
  const chipList = document.getElementById('category-modal-chips')
  chipList.innerHTML = ''
  const item = state.items.find(i => i.id === categoryModalItemId)
  if (!item) return closeCategoryModal()

  if (!state.categories.length) {
    chipList.innerHTML = '<span class="category-chip-empty">No categories exist yet. Create one below.</span>'
    return
  }

  const assignedIds = new Set((item.categories || []).map(c => c.id))
  state.categories.forEach(cat => {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'category-chip' + (assignedIds.has(cat.id) ? ' assigned' : '')
    chip.textContent = cat.name
    chip.onclick = () => toggleCategoryOnItem(item, cat.id, !assignedIds.has(cat.id))
    chipList.appendChild(chip)
  })
}

async function toggleCategoryOnItem (item, categoryId, shouldAssign) {
  try {
    if (shouldAssign) {
      await api(`/items/${item.id}/categories`, { method: 'POST', body: JSON.stringify({ category_id: categoryId }) })
    } else {
      await api(`/items/${item.id}/categories/${categoryId}`, { method: 'DELETE' })
    }
    await refresh()
    if (categoryModalItemId === item.id) renderCategoryModalChips()
  } catch (e) {
    toast(e.message)
  }
}

async function removeCategoryFromItem (item, categoryId) {
  await api(`/items/${item.id}/categories/${categoryId}`, { method: 'DELETE' })
  await refresh()
}

// ---------- photo capture / square-crop dialog ----------

const PHOTO_VIEWPORT_SIZE = 280
const PHOTO_OUTPUT_SIZE = 300

const photoState = {
  itemId: null,
  naturalWidth: 0,
  naturalHeight: 0,
  baseScale: 1,
  zoomPercent: 100,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragStartOffsetX: 0,
  dragStartOffsetY: 0
}

function openPhotoDialog (item) {
  photoState.itemId = item.id
  document.getElementById('photo-modal-title').textContent = `Photo for "${item.name}"`
  document.getElementById('photo-modal-empty').classList.remove('hidden')
  document.getElementById('photo-modal-editor').classList.add('hidden')
  document.getElementById('photo-modal-remove').style.display = item.thumbnail ? '' : 'none'
  document.getElementById('photo-file-input').value = ''
  document.getElementById('photo-modal-overlay').classList.remove('hidden')
}

function closePhotoModal () {
  document.getElementById('photo-modal-overlay').classList.add('hidden')
  photoState.itemId = null
}

function loadPhotoFile (file) {
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    const img = document.getElementById('photo-crop-image')
    img.onload = () => {
      photoState.naturalWidth = img.naturalWidth
      photoState.naturalHeight = img.naturalHeight
      photoState.baseScale = PHOTO_VIEWPORT_SIZE / Math.min(img.naturalWidth, img.naturalHeight)
      photoState.zoomPercent = 100
      const scaledW = img.naturalWidth * photoState.baseScale
      const scaledH = img.naturalHeight * photoState.baseScale
      photoState.offsetX = (PHOTO_VIEWPORT_SIZE - scaledW) / 2
      photoState.offsetY = (PHOTO_VIEWPORT_SIZE - scaledH) / 2
      document.getElementById('photo-zoom-slider').value = 100
      applyPhotoTransform()
      document.getElementById('photo-modal-empty').classList.add('hidden')
      document.getElementById('photo-modal-editor').classList.remove('hidden')
    }
    img.src = reader.result
  }
  reader.readAsDataURL(file)
}

function currentPhotoScale () {
  return photoState.baseScale * (photoState.zoomPercent / 100)
}

function clampPhotoOffsets () {
  const scale = currentPhotoScale()
  const scaledW = photoState.naturalWidth * scale
  const scaledH = photoState.naturalHeight * scale
  const minX = Math.min(0, PHOTO_VIEWPORT_SIZE - scaledW)
  const minY = Math.min(0, PHOTO_VIEWPORT_SIZE - scaledH)
  photoState.offsetX = Math.max(minX, Math.min(0, photoState.offsetX))
  photoState.offsetY = Math.max(minY, Math.min(0, photoState.offsetY))
}

function applyPhotoTransform () {
  clampPhotoOffsets()
  const img = document.getElementById('photo-crop-image')
  const scale = currentPhotoScale()
  img.style.width = `${photoState.naturalWidth * scale}px`
  img.style.height = `${photoState.naturalHeight * scale}px`
  img.style.left = `${photoState.offsetX}px`
  img.style.top = `${photoState.offsetY}px`
}

function initPhotoCropInteractions () {
  const viewport = document.getElementById('photo-crop-viewport')
  const img = document.getElementById('photo-crop-image')

  const startDrag = (clientX, clientY) => {
    photoState.dragging = true
    photoState.dragStartX = clientX
    photoState.dragStartY = clientY
    photoState.dragStartOffsetX = photoState.offsetX
    photoState.dragStartOffsetY = photoState.offsetY
  }
  const moveDrag = (clientX, clientY) => {
    if (!photoState.dragging) return
    photoState.offsetX = photoState.dragStartOffsetX + (clientX - photoState.dragStartX)
    photoState.offsetY = photoState.dragStartOffsetY + (clientY - photoState.dragStartY)
    applyPhotoTransform()
  }
  const endDrag = () => { photoState.dragging = false }

  img.addEventListener('mousedown', (e) => { e.preventDefault(); startDrag(e.clientX, e.clientY) })
  window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY))
  window.addEventListener('mouseup', endDrag)

  img.addEventListener('touchstart', (e) => {
    const t = e.touches[0]
    startDrag(t.clientX, t.clientY)
  }, { passive: true })
  viewport.addEventListener('touchmove', (e) => {
    const t = e.touches[0]
    moveDrag(t.clientX, t.clientY)
  }, { passive: true })
  viewport.addEventListener('touchend', endDrag)

  document.getElementById('photo-zoom-slider').addEventListener('input', (e) => {
    photoState.zoomPercent = parseInt(e.target.value, 10)
    applyPhotoTransform()
  })
}

async function savePhotoThumbnail () {
  const canvas = document.createElement('canvas')
  canvas.width = PHOTO_OUTPUT_SIZE
  canvas.height = PHOTO_OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  const scale = currentPhotoScale()
  const srcX = -photoState.offsetX / scale
  const srcY = -photoState.offsetY / scale
  const srcSize = PHOTO_VIEWPORT_SIZE / scale
  const img = document.getElementById('photo-crop-image')
  ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE)
  const dataUri = canvas.toDataURL('image/jpeg', 0.85)

  try {
    await api(`/items/${photoState.itemId}/thumbnail`, { method: 'PATCH', body: JSON.stringify({ thumbnail: dataUri }) })
    await refresh()
    closePhotoModal()
  } catch (e) {
    toast(e.message)
  }
}

async function removePhotoThumbnail () {
  try {
    await api(`/items/${photoState.itemId}/thumbnail`, { method: 'PATCH', body: JSON.stringify({ thumbnail: null }) })
    await refresh()
    closePhotoModal()
  } catch (e) {
    toast(e.message)
  }
}

async function moveLocation (loc) {
  const forbidden = new Set([loc.id, ...descendantIds(loc.id)])
  const targets = state.locations.filter(l => !forbidden.has(l.id))
  if (!targets.length) return toast('No valid target available.')
  const listStr = targets.map((t, i) => `${i + 1}: ${pathToRoot(t.id)} [${t.type === 'storage_space' ? 'Storage Space' : 'Container'}]`).join('\n')
  const answer = prompt(`Move "${loc.name}" to where?\n0 = top level\n${listStr}`)
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
  const answer = prompt(`Move "${item.name}" to where?\n0 = no location\n${listStr}`)
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
  const label = document.getElementById('floorplan-name-label')
  if (!state.floorplans.length) {
    label.textContent = 'No floorplan uploaded yet.'
    if (state.currentFloorplanId) loadFloorplan(null)
    return
  }
  // state.floorplans is ordered by uploaded_at DESC (see GET /floorplans),
  // so the first entry is always the most recently uploaded one.
  const latest = state.floorplans[0]
  label.textContent = `${latest.name} (uploaded ${new Date(latest.uploaded_at).toLocaleString()})`
  if (state.currentFloorplanId !== latest.id) {
    loadFloorplan(latest.id)
  }
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
    el.addEventListener('click', () => openAssignDialog(el.id))

    // Lets "not stored" items be dragged straight onto a floorplan area to
    // stow them in whichever storage space that area is assigned to.
    el.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      el.classList.add('floorplan-drop-target')
    })
    el.addEventListener('dragleave', () => el.classList.remove('floorplan-drop-target'))
    el.addEventListener('drop', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      el.classList.remove('floorplan-drop-target')
      const dragType = e.dataTransfer.getData('application/x-drag-type')
      const draggedId = e.dataTransfer.getData('text/plain')
      if (dragType !== 'item' || !draggedId) return

      const target = state.locations.find(
        l => l.type === 'storage_space' && l.floorplan_id === state.currentFloorplanId && l.svg_element_id === el.id
      )
      if (!target) return toast('This area is not assigned to a storage space yet.')

      try {
        await api(`/items/${draggedId}/move`, { method: 'PATCH', body: JSON.stringify({ location_id: target.id }) })
        await refresh()
        await loadFloorplan(state.currentFloorplanId)
        toast(`Stored in "${target.name}".`)
      } catch (err) {
        toast(err.message)
      }
    })
  })

  document.getElementById('assign-hint').textContent =
    `${assignable.length} assignable area(s) found. Click an area to assign it to a storage space.`

  fitFloorplanSvg()
}

let locationModalElementId = null

function closeLocationModal () {
  document.getElementById('location-modal-overlay').classList.add('hidden')
  locationModalElementId = null
}

function openAssignDialog (svgElementId) {
  locationModalElementId = svgElementId
  document.getElementById('location-modal-title').textContent = `Assign area "${svgElementId}"`
  renderLocationModalChips()
  document.getElementById('location-modal-overlay').classList.remove('hidden')
}

function renderLocationModalChips () {
  const chipList = document.getElementById('location-modal-chips')
  chipList.innerHTML = ''
  const storageSpaces = state.locations.filter(l => l.type === 'storage_space')

  if (!storageSpaces.length) {
    chipList.innerHTML = '<span class="category-chip-empty">Create a storage space in the "Inventory" tab first.</span>'
    return
  }

  storageSpaces.forEach(s => {
    const isAssigned = s.floorplan_id === state.currentFloorplanId && s.svg_element_id === locationModalElementId
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'category-chip' + (isAssigned ? ' assigned' : '')
    chip.textContent = s.name
    chip.onclick = () => toggleAreaAssignment(s, !isAssigned)
    chipList.appendChild(chip)
  })
}

async function toggleAreaAssignment (storageSpace, shouldAssign) {
  const svgElementId = locationModalElementId
  try {
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

    if (shouldAssign) {
      await api(`/locations/${storageSpace.id}/svg-mapping`, {
        method: 'PATCH',
        body: JSON.stringify({ floorplan_id: state.currentFloorplanId, svg_element_id: svgElementId })
      })
    }

    await refresh()
    await loadFloorplan(state.currentFloorplanId)
    if (locationModalElementId === svgElementId) renderLocationModalChips()
  } catch (e) {
    toast(e.message)
  }
}

async function uploadFloorplan (file) {
  const text = await file.text()
  if (!text.includes('<svg')) return toast('This is not a valid SVG file.')

  // This app shows only the single most-recently-uploaded floorplan, so
  // uploading a new one replaces whatever's currently shown. Any storage
  // spaces mapped to areas on the old floorplan(s) need to be unmapped
  // first — warn the user since this is a destructive, non-reversible step.
  const existingFloorplans = state.floorplans
  const affectedSpaces = state.locations.filter(
    l => l.type === 'storage_space' && l.floorplan_id && existingFloorplans.some(fp => fp.id === l.floorplan_id)
  )

  if (affectedSpaces.length) {
    const names = affectedSpaces.map(s => s.name).join(', ')
    const confirmed = confirm(
      `Uploading a new floorplan will remove the area assignment for ${affectedSpaces.length} ` +
      `storage space(s): ${names}. This can't be undone. Continue?`
    )
    if (!confirmed) return
    try {
      for (const space of affectedSpaces) {
        await api(`/locations/${space.id}/svg-mapping`, {
          method: 'PATCH',
          body: JSON.stringify({ floorplan_id: null, svg_element_id: null })
        })
      }
    } catch (e) {
      return toast(e.message)
    }
  }

  try {
    for (const fp of existingFloorplans) {
      await api(`/floorplans/${fp.id}`, { method: 'DELETE' })
    }
  } catch (e) {
    return toast(e.message)
  }

  const fp = await api('/floorplans', {
    method: 'POST',
    body: JSON.stringify({ name: file.name.replace(/\.svg$/i, ''), svg_content: text })
  })
  await refresh()
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
      actualQuantity: item.actual_quantity,
      targetQuantity: item.target_quantity,
      thumbnail: item.thumbnail || null,
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
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No items found.</td></tr>'
    return
  }

  rows.forEach(r => {
    const tr = document.createElement('tr')
    const thumbCell = r.thumbnail
      ? `<img class="item-thumb" src="${r.thumbnail}" alt="">`
      : '<span class="item-thumb item-thumb-placeholder"></span>'
    tr.innerHTML = `
      <td>${thumbCell}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${r.actualQuantity}</td>
      <td>${escapeHtml(r.directLocation)}${r.directType ? ` <span class="node-type">${r.directType}</span>` : ''}</td>
      <td>${escapeHtml(r.fullPath)}</td>
      <td>${escapeHtml(r.categoryNames)}</td>
      <td>${r.onFloorplan ? '<span class="badge-yes">yes</span>' : '<span class="badge-no">no</span>'}</td>
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
  const warning = count > 0 ? ` It is currently assigned to ${count} item(s) — this assignment will also be removed.` : ''
  if (!confirm(`Really delete category "${cat.name}"?${warning}`)) return
  await api(`/categories/${cat.id}`, { method: 'DELETE' })
  await refresh()
}

const expandedCategoryIds = new Set()

function toggleCategoryFold (categoryId) {
  if (expandedCategoryIds.has(categoryId)) {
    expandedCategoryIds.delete(categoryId)
  } else {
    expandedCategoryIds.add(categoryId)
  }
  renderCategories()
}

function renderCategories () {
  const list = document.getElementById('categories-list')
  list.innerHTML = ''
  if (!state.categories.length) {
    list.innerHTML = '<p class="hint">No categories created yet.</p>'
    return
  }
  state.categories.forEach(cat => {
    const items = state.items.filter(i => (i.categories || []).some(c => c.id === cat.id))
    const isExpanded = expandedCategoryIds.has(cat.id)

    const fold = document.createElement('div')
    fold.className = 'category-fold'

    const row = document.createElement('div')
    row.className = 'category-row category-fold-header'
    row.onclick = () => toggleCategoryFold(cat.id)

    const label = document.createElement('span')
    label.innerHTML = `<span class="fold-arrow">${isExpanded ? '▾' : '▸'}</span>${escapeHtml(cat.name)}<span class="category-count">${items.length} Item(s)</span>`
    row.appendChild(label)

    const actions = document.createElement('span')
    actions.className = 'node-actions'
    actions.appendChild(mkBtn('Rename', () => renameCategory(cat)))
    actions.appendChild(mkBtn('Delete', () => deleteCategory(cat)))
    actions.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => e.stopPropagation())
    })
    row.appendChild(actions)

    fold.appendChild(row)

    if (isExpanded) {
      const body = document.createElement('div')
      body.className = 'category-fold-body'
      if (!items.length) {
        body.innerHTML = '<p class="hint">No items in this category.</p>'
      } else {
        items.forEach(item => {
          const wrap = document.createElement('div')
          wrap.className = 'category-fold-item'
          const location = document.createElement('div')
          location.className = 'category-fold-item-location hint'
          location.textContent = item.location_id ? pathToRoot(item.location_id) : 'no location'
          wrap.appendChild(location)
          wrap.appendChild(renderItemRow(item))
          body.appendChild(wrap)
        })
      }
      fold.appendChild(body)
    }

    list.appendChild(fold)
  })
}

// ---------- understocked page ----------

function renderUnderstocked () {
  const list = document.getElementById('understocked-list')
  list.innerHTML = ''

  const understocked = state.items.filter(
    i => i.target_quantity !== null && i.target_quantity !== undefined && i.actual_quantity < i.target_quantity
  )

  if (!understocked.length) {
    list.innerHTML = '<p class="hint">Nothing understocked right now — every item with a target quantity has enough on hand.</p>'
    return
  }

  understocked.forEach(item => list.appendChild(renderUnderstockedChip(item)))
}

function renderUnderstockedChip (item) {
  const chip = document.createElement('div')
  chip.className = 'understocked-chip'

  const thumb = document.createElement('div')
  thumb.className = 'understocked-chip-thumb'
  if (item.thumbnail) {
    const img = document.createElement('img')
    img.src = item.thumbnail
    img.alt = ''
    thumb.appendChild(img)
  } else {
    thumb.classList.add('item-thumb-placeholder')
  }
  chip.appendChild(thumb)

  const info = document.createElement('div')
  info.className = 'understocked-chip-info'
  const name = document.createElement('div')
  name.className = 'understocked-chip-name'
  name.textContent = item.name
  info.appendChild(name)

  const qtyLine = document.createElement('div')
  qtyLine.className = 'understocked-chip-qty'
  qtyLine.appendChild(renderQuantityDisplay(item, { field: 'actual_quantity', prefix: 'Actual: ', className: 'qty-actual', onSaved: renderUnderstocked }))
  const targetSpan = document.createElement('span')
  targetSpan.className = 'qty-target'
  targetSpan.textContent = ` / Target: ${item.target_quantity}`
  qtyLine.appendChild(targetSpan)
  info.appendChild(qtyLine)

  chip.appendChild(info)

  const actions = document.createElement('div')
  actions.className = 'understocked-chip-actions'
  actions.appendChild(mkIconBtn('edit', 'Edit', () => openItemPropertiesDialog(item)))
  chip.appendChild(actions)

  return chip
}

// ---------- item properties modal ----------

let propertiesModalItemId = null

function openItemPropertiesDialog (item) {
  propertiesModalItemId = item.id
  document.getElementById('properties-modal-title').textContent = `Properties for "${item.name}"`
  document.getElementById('properties-name-input').value = item.name
  document.getElementById('properties-actual-qty-input').value = item.actual_quantity
  document.getElementById('properties-target-qty-input').value =
    item.target_quantity === null || item.target_quantity === undefined ? '' : item.target_quantity
  document.getElementById('properties-notes-textarea').value = item.notes || ''
  showPropertiesNotesTab('write')
  document.getElementById('properties-modal-overlay').classList.remove('hidden')
}

function closePropertiesModal () {
  document.getElementById('properties-modal-overlay').classList.add('hidden')
  propertiesModalItemId = null
}

function showPropertiesNotesTab (which) {
  const writeTab = document.getElementById('properties-notes-tab-write')
  const previewTab = document.getElementById('properties-notes-tab-preview')
  const textarea = document.getElementById('properties-notes-textarea')
  const preview = document.getElementById('properties-notes-preview')
  const isWrite = which === 'write'
  writeTab.classList.toggle('active', isWrite)
  previewTab.classList.toggle('active', !isWrite)
  textarea.classList.toggle('hidden', !isWrite)
  preview.classList.toggle('hidden', isWrite)
  if (!isWrite) preview.innerHTML = renderMarkdown(textarea.value)
}

async function savePropertiesModal () {
  const name = document.getElementById('properties-name-input').value.trim()
  if (!name) return toast('Name is required.')
  const actualQuantityRaw = document.getElementById('properties-actual-qty-input').value
  const targetQuantityRaw = document.getElementById('properties-target-qty-input').value
  const notes = document.getElementById('properties-notes-textarea').value

  const body = {
    name,
    actual_quantity: Math.max(0, parseInt(actualQuantityRaw, 10) || 0),
    target_quantity: targetQuantityRaw === '' ? null : Math.max(0, parseInt(targetQuantityRaw, 10) || 0),
    notes: notes || null
  }

  try {
    await api(`/items/${propertiesModalItemId}`, { method: 'PATCH', body: JSON.stringify(body) })
    await refresh()
    closePropertiesModal()
  } catch (e) {
    toast(e.message)
  }
}

// Small, dependency-free markdown-ish renderer covering the basics: headings,
// bold/italic, inline code, links, unordered/ordered lists, and paragraphs.
// Not a full CommonMark implementation — just enough for item notes.
function renderMarkdown (src) {
  const escaped = escapeHtml(src || '')
  const lines = escaped.split('\n')
  const htmlLines = []
  let inUl = false
  let inOl = false

  const closeLists = () => {
    if (inUl) { htmlLines.push('</ul>'); inUl = false }
    if (inOl) { htmlLines.push('</ol>'); inOl = false }
  }

  const inline = (text) => text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    const ulItem = line.match(/^[-*]\s+(.*)$/)
    const olItem = line.match(/^\d+\.\s+(.*)$/)

    if (heading) {
      closeLists()
      const level = heading[1].length
      htmlLines.push(`<h${level}>${inline(heading[2])}</h${level}>`)
    } else if (ulItem) {
      if (!inUl) { closeLists(); htmlLines.push('<ul>'); inUl = true }
      htmlLines.push(`<li>${inline(ulItem[1])}</li>`)
    } else if (olItem) {
      if (!inOl) { closeLists(); htmlLines.push('<ol>'); inOl = true }
      htmlLines.push(`<li>${inline(olItem[1])}</li>`)
    } else if (line === '') {
      closeLists()
    } else {
      closeLists()
      htmlLines.push(`<p>${inline(line)}</p>`)
    }
  }
  closeLists()
  return htmlLines.join('\n') || '<p class="hint">Nothing to preview yet.</p>'
}

// ---------- tabs ----------

function switchTab (name) {
  currentTab = name
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name))
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`))
  updateOrphanedPanelVisibility()
  if (name === 'floorplan') fitFloorplanSvg()
}

// Dynamically caps the floorplan SVG's height so it fits within the visible
// viewport (in addition to max-width:100% in CSS, which caps its width).
// Re-run whenever the SVG changes, the floorplan tab becomes active, or the
// window is resized.
function fitFloorplanSvg () {
  const container = document.getElementById('floorplan-container')
  const svg = container && container.querySelector('svg')
  if (!svg) return
  const style = window.getComputedStyle(container)
  const verticalChrome =
    parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
    parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
  const top = container.getBoundingClientRect().top
  const bottomMargin = 24 // breathing room below the container
  const available = Math.max(150, window.innerHeight - top - verticalChrome - bottomMargin)
  svg.style.maxHeight = `${available}px`
}

window.addEventListener('resize', () => {
  const floorplanTabActive = document.getElementById('tab-floorplan').classList.contains('active')
  if (floorplanTabActive) fitFloorplanSvg()
})

// ---------- wiring ----------

async function refresh () {
  await loadAll()
  renderTree()
  populateFloorplanSelect()
  renderOverview()
  renderCategories()
  renderUnderstocked()
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('add-storage-space').onclick = addStorageSpace
  document.getElementById('add-category').onclick = addCategory

  document.getElementById('category-modal-close').onclick = closeCategoryModal
  document.getElementById('category-modal-overlay').onclick = (e) => {
    if (e.target.id === 'category-modal-overlay') closeCategoryModal()
  }
  document.getElementById('location-modal-close').onclick = closeLocationModal
  document.getElementById('location-modal-overlay').onclick = (e) => {
    if (e.target.id === 'location-modal-overlay') closeLocationModal()
  }
  document.getElementById('photo-modal-close').onclick = closePhotoModal
  document.getElementById('photo-modal-overlay').onclick = (e) => {
    if (e.target.id === 'photo-modal-overlay') closePhotoModal()
  }
  document.getElementById('photo-file-input').onchange = (e) => loadPhotoFile(e.target.files[0])
  document.getElementById('photo-modal-choose-different').onclick = () => document.getElementById('photo-file-input').click()
  document.getElementById('photo-modal-save').onclick = savePhotoThumbnail
  document.getElementById('photo-modal-remove').onclick = removePhotoThumbnail
  initPhotoCropInteractions()

  document.getElementById('properties-modal-close').onclick = closePropertiesModal
  document.getElementById('properties-modal-overlay').onclick = (e) => {
    if (e.target.id === 'properties-modal-overlay') closePropertiesModal()
  }
  document.getElementById('properties-modal-save').onclick = savePropertiesModal
  document.getElementById('properties-notes-tab-write').onclick = () => showPropertiesNotesTab('write')
  document.getElementById('properties-notes-tab-preview').onclick = () => showPropertiesNotesTab('preview')

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCategoryModal()
      closeLocationModal()
      closePhotoModal()
      closePropertiesModal()
    }
  })
  document.getElementById('category-modal-new').onclick = async () => {
    const name = prompt('Name of the new category (e.g. "Electrical"):')
    if (!name) return
    try {
      await api('/categories', { method: 'POST', body: JSON.stringify({ name }) })
      await refresh()
      if (categoryModalItemId) renderCategoryModalChips()
    } catch (e) {
      toast(e.message)
    }
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab)
  })

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
