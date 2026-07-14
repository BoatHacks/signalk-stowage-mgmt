// Thin REST client for the plugin's own API, mounted at
// /plugins/signalk-stowage-mgmt by the Signal K server.
const BASE = '/plugins/signalk-stowage-mgmt';

async function request(path, options) {
  const opts = options || {};
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body
  });
  if (res.status === 204) return null;
  var data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    var message = (data && data.error) || (res.status + ' ' + res.statusText);
    throw new Error(message);
  }
  return data;
}

function get(path) {
  return request(path);
}
function post(path, body) {
  return request(path, { method: 'POST', body: JSON.stringify(body) });
}
function patch(path, body) {
  return request(path, { method: 'PATCH', body: JSON.stringify(body) });
}
function del(path) {
  return request(path, { method: 'DELETE' });
}

// Attachments upload as raw bytes (not JSON) since there's no size limit and
// files can be arbitrarily large — see api.uploadAttachment below.
async function uploadRaw(path, file) {
  var res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name || 'attachment')
    },
    body: file
  });
  var data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }
  if (!res.ok) {
    var message = (data && data.error) || (res.status + ' ' + res.statusText);
    throw new Error(message);
  }
  return data;
}

export const api = {
  // Locations (storage spaces & containers)
  listLocations: function () { return get('/locations'); },
  createLocation: function (body) { return post('/locations', body); },
  renameLocation: function (id, name) { return patch('/locations/' + id, { name: name }); },
  moveLocation: function (id, parentId) { return patch('/locations/' + id + '/move', { parent_id: parentId }); },
  setSvgMapping: function (id, floorplanId, svgElementId) {
    return patch('/locations/' + id + '/svg-mapping', { floorplan_id: floorplanId, svg_element_id: svgElementId });
  },
  deleteLocation: function (id) { return del('/locations/' + id); },

  // Items
  listItems: function () { return get('/items'); },
  createItem: function (body) { return post('/items', body); },
  updateItem: function (id, body) { return patch('/items/' + id, body); },
  setThumbnail: function (id, thumbnail) { return patch('/items/' + id + '/thumbnail', { thumbnail: thumbnail }); },
  moveItem: function (id, locationId) { return patch('/items/' + id + '/move', { location_id: locationId }); },
  getPlacements: function (id) { return get('/items/' + id + '/placements'); },
  movePlacement: function (itemId, placementId, locationId) {
    return patch('/items/' + itemId + '/placements/' + placementId + '/move', { location_id: locationId });
  },
  setPlacementQuantity: function (itemId, placementId, quantity, note) {
    return patch('/items/' + itemId + '/placements/' + placementId, { quantity: quantity, note: note });
  },
  splitItem: function (id, body) { return post('/items/' + id + '/split', body); },
  addItemCategory: function (id, categoryId) { return post('/items/' + id + '/categories', { category_id: categoryId }); },
  removeItemCategory: function (id, categoryId) { return del('/items/' + id + '/categories/' + categoryId); },
  deleteItem: function (id) { return del('/items/' + id); },
  locateItem: function (id) { return get('/items/' + id + '/locate'); },
  listAttachments: function (id) { return get('/items/' + id + '/attachments'); },
  uploadAttachment: function (id, file) { return uploadRaw('/items/' + id + '/attachments', file); },
  deleteAttachment: function (itemId, attachmentId) { return del('/items/' + itemId + '/attachments/' + attachmentId); },
  attachmentUrl: function (itemId, attachmentId) { return BASE + '/items/' + itemId + '/attachments/' + attachmentId; },
  exportSnapshot: function () { return get('/export'); },
  importSnapshot: function (payload) { return post('/import', payload); },

  // Categories
  listCategories: function () { return get('/categories'); },
  createCategory: function (name) { return post('/categories', { name: name }); },
  renameCategory: function (id, name) { return patch('/categories/' + id, { name: name }); },
  deleteCategory: function (id) { return del('/categories/' + id); },

  // Floorplans
  listFloorplans: function () { return get('/floorplans'); },
  getItemLog: function (start, end) {
    var params = [];
    if (start) params.push('start=' + encodeURIComponent(start));
    if (end) params.push('end=' + encodeURIComponent(end));
    return get('/item-log' + (params.length ? '?' + params.join('&') : ''));
  },
  getFloorplan: function (id) { return get('/floorplans/' + id); },
  uploadFloorplan: function (name, svgContent) { return post('/floorplans', { name: name, svg_content: svgContent }); },
  deleteFloorplan: function (id) { return del('/floorplans/' + id); }
};
