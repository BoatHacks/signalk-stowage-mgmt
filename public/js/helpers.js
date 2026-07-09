// Pure data-layer helpers operating on a snapshot shaped like
// { locations, items, categories, floorplans }. No DOM access here, so
// these are easy to reason about and reuse across components.

export function childLocations(data, parentId) {
  return data.locations.filter(function (l) {
    return (l.parent_id || null) === (parentId || null);
  });
}

export function itemsIn(data, locationId) {
  return data.items.filter(function (i) {
    return (i.location_id || null) === (locationId || null);
  });
}

export function descendantIds(data, locationId) {
  var direct = childLocations(data, locationId).map(function (l) { return l.id; });
  var all = direct.slice();
  direct.forEach(function (id) {
    all = all.concat(descendantIds(data, id));
  });
  return all;
}

export function pathToRoot(data, locationId) {
  var names = [];
  var current = data.locations.find(function (l) { return l.id === locationId; });
  while (current) {
    names.unshift(current.name);
    current = current.parent_id ? data.locations.find(function (l) { return l.id === current.parent_id; }) : null;
  }
  return names.join(' \u2192 ');
}

export function locationHasAnyItems(data, locId) {
  if (itemsIn(data, locId).length > 0) return true;
  return childLocations(data, locId).some(function (child) {
    return locationHasAnyItems(data, child.id);
  });
}

export function isUnderstocked(item) {
  return item.target_quantity !== null && item.target_quantity !== undefined &&
    item.actual_quantity < item.target_quantity;
}

// Turns an SVG element id like "area-navtable" into a readable default
// name: "Navtable".
export function deriveNameFromSvgElementId(svgElementId) {
  return svgElementId
    .replace(/^area[-_]?/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\w\S*/g, function (w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); });
}

// ---------- markdown export builders ----------

function itemMarkdownLine(item) {
  var understocked = isUnderstocked(item);
  var qtyPart = '\u00d7' + item.actual_quantity;
  if (item.target_quantity !== null && item.target_quantity !== undefined) {
    qtyPart += ' (target ' + item.target_quantity + ')';
  }
  if (understocked) qtyPart = '**' + qtyPart + '**';
  return '- ' + item.name + ' \u2014 ' + qtyPart;
}

export function buildInventoryMarkdown(data) {
  var lines = [];

  function renderLocation(loc, depth) {
    var headingLevel = Math.min(depth, 6);
    lines.push('#'.repeat(headingLevel) + ' ' + loc.name);
    lines.push('');
    var items = itemsIn(data, loc.id);
    items.forEach(function (item) { lines.push(itemMarkdownLine(item)); });
    if (items.length) lines.push('');
    childLocations(data, loc.id).forEach(function (child) { renderLocation(child, depth + 1); });
  }

  var topLevel = childLocations(data, null).filter(function (l) { return l.type === 'storage_space'; });
  topLevel.forEach(function (loc) {
    if (locationHasAnyItems(data, loc.id)) renderLocation(loc, 1);
  });

  var orphanedContainers = childLocations(data, null).filter(function (l) { return l.type === 'container'; });
  var unassignedItems = itemsIn(data, null);
  if (orphanedContainers.length || unassignedItems.length) {
    lines.push('# Not Stored');
    lines.push('');
    orphanedContainers.forEach(function (loc) { renderLocation(loc, 2); });
    unassignedItems.forEach(function (item) { lines.push(itemMarkdownLine(item)); });
    if (unassignedItems.length) lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

export function extractSourceFromNotes(notes) {
  if (!notes) return null;
  var match = notes.match(/^\s*source:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

function categorySortKey(item) {
  var names = (item.categories || []).map(function (c) { return c.name; }).sort(function (a, b) { return a.localeCompare(b); });
  return names.length ? names[0].toLowerCase() : '\uffff';
}

export function buildShoppingListMarkdown(data) {
  var understocked = data.items.filter(isUnderstocked);
  var lines = ['# Shopping List', ''];

  if (!understocked.length) {
    lines.push('Nothing needed right now.');
    return lines.join('\n').trim() + '\n';
  }

  var groups = new Map();
  understocked.forEach(function (item) {
    var shop = extractSourceFromNotes(item.notes);
    var key = shop || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  var shopNames = Array.from(groups.keys()).filter(function (k) { return k !== null; }).sort(function (a, b) { return a.localeCompare(b); });
  var orderedKeys = groups.has(null) ? shopNames.concat([null]) : shopNames;

  orderedKeys.forEach(function (key) {
    lines.push('## ' + (key === null ? 'No Shop Specified' : key));
    lines.push('');
    var items = groups.get(key).slice().sort(function (a, b) {
      return categorySortKey(a).localeCompare(categorySortKey(b)) || a.name.localeCompare(b.name);
    });
    items.forEach(function (item) {
      var needed = item.target_quantity - item.actual_quantity;
      lines.push('- ' + item.name + ' \u2014 need ' + needed);
    });
    lines.push('');
  });

  return lines.join('\n').trim() + '\n';
}
