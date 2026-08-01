// Pure data-layer helpers operating on a snapshot shaped like
// { locations, items, categories, floorplans }. No DOM access here, so
// these are easy to reason about and reuse across components.

// Every section the item detail page can show, in the default order —
// also the fallback when config.detailPageSections is missing/invalid.
export var DETAIL_PAGE_SECTIONS = ['placements', 'history', 'properties', 'attachments'];

// Turns the detailPageSections config value into the actual ordered list
// of sections to render, dropping anything not in DETAIL_PAGE_SECTIONS
// (defensive against a stale/hand-edited config value) without silently
// re-adding a section the user deliberately removed.
export function resolveDetailPageSections(sections) {
  if (!Array.isArray(sections)) return DETAIL_PAGE_SECTIONS.slice();
  return sections.filter(function (s) { return DETAIL_PAGE_SECTIONS.indexOf(s) !== -1; });
}

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

export function formatBytes(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return bytes + ' B';
  var units = ['KB', 'MB', 'GB', 'TB'];
  var value = bytes;
  var unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return value.toFixed(value < 10 ? 1 : 0) + ' ' + units[unitIndex];
}

export function isSplit(item) {
  return !!(item.placements && item.placements.length > 0);
}

// For a split item with a default_location_id that matches one of its
// current placements, returns that placement ({ id, location_id,
// location_name, quantity }); otherwise null (including for a plain item,
// or a split item with no default set, or a default that's gone stale --
// the backend already clears default_location_id whenever that happens,
// but this stays defensive in case the frontend has a moment-stale copy).
export function defaultPlacementFor(item) {
  if (!isSplit(item) || !item.default_location_id) return null;
  return item.placements.find(function (p) { return p.location_id === item.default_location_id; }) || null;
}

// For the Overview tab's Touch view "dynamic +/- scale" option: a bigger
// on-hand quantity gets bigger quick-adjust steps, so nudging a 7450g bag
// of flour doesn't take a thousand taps. Returns a "fine" step
// (10^(digits-2)) and a "coarse" step (10^(digits-1)), each floored at 1,
// based on the number of digits in the quantity - not on its trailing
// zeros, so a step never balloons just because a number happens to be
// round (5000 and 5001 get the same steps; contrast with rounding to the
// first significant digit, which would make 5000's step 1000x bigger than
// 5001's for no meaningful reason). For single-digit quantities fine and
// coarse are equal (both 1) - callers should collapse to one +/- pair
// rather than showing four identical buttons.
// e.g. 0-9 -> {fine: 1, coarse: 1}; 100-999 -> {fine: 10, coarse: 100};
// 1000-9999 -> {fine: 100, coarse: 1000}.
export function quantityStepsFor(value) {
  var whole = Math.floor(Math.abs(value || 0));
  var digits = whole === 0 ? 1 : String(whole).length;
  return {
    fine: digits <= 2 ? 1 : Math.pow(10, digits - 2),
    coarse: digits <= 1 ? 1 : Math.pow(10, digits - 1)
  };
}

// Like itemsIn, but also surfaces split items: for each of an item's
// placements that matches this location, returns a "chip view" — a shallow
// copy of the item with actual_quantity replaced by that placement's
// quantity and a placementId set, so components can render one row per
// placement without needing to know about splitting themselves. Normal
// (unsplit) items come through unchanged, with placementId: null.
export function resolvedItemsIn(data, locationId) {
  var result = [];
  data.items.forEach(function (item) {
    if (isSplit(item)) {
      item.placements.forEach(function (p) {
        if ((p.location_id || null) === (locationId || null)) {
          var view = Object.assign({}, item, { actual_quantity: p.quantity, placementId: p.id });
          result.push(view);
        }
      });
    } else if ((item.location_id || null) === (locationId || null)) {
      result.push(Object.assign({ placementId: null }, item));
    }
  });
  return result;
}

export function descendantIds(data, locationId) {
  var direct = childLocations(data, locationId).map(function (l) { return l.id; });
  var all = direct.slice();
  direct.forEach(function (id) {
    all = all.concat(descendantIds(data, id));
  });
  return all;
}

// Counts, for the collapsed view of a top-level storage space: how many
// nested storage spaces and containers it contains (at any depth), and how
// many distinct items live anywhere in that subtree (including a split
// item with only some of its placements inside the subtree — counted once,
// not once per placement).
export function subtreeSummary(data, locationId) {
  var nestedIds = descendantIds(data, locationId);
  var idSet = new Set(nestedIds);
  idSet.add(locationId);

  var spaces = 0, containers = 0;
  nestedIds.forEach(function (id) {
    var loc = data.locations.find(function (l) { return l.id === id; });
    if (!loc) return;
    if (loc.type === 'storage_space') spaces++;
    else containers++;
  });

  var itemIds = new Set();
  data.items.forEach(function (item) {
    if (isSplit(item)) {
      var inSubtree = item.placements.some(function (p) { return idSet.has(p.location_id); });
      if (inSubtree) itemIds.add(item.id);
    } else if (item.location_id && idSet.has(item.location_id)) {
      itemIds.add(item.id);
    }
  });

  return { spaces: spaces, containers: containers, items: itemIds.size };
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

// The ids from the root down to (and including) locationId \u2014 the nodes
// that must be expanded for locationId to actually be visible in a
// collapsible tree. Empty array if locationId doesn't exist.
export function ancestorIds(data, locationId) {
  var ids = [];
  var current = data.locations.find(function (l) { return l.id === locationId; });
  while (current) {
    ids.unshift(current.id);
    current = current.parent_id ? data.locations.find(function (l) { return l.id === current.parent_id; }) : null;
  }
  return ids;
}

export function locationHasAnyItems(data, locId) {
  if (resolvedItemsIn(data, locId).length > 0) return true;
  return childLocations(data, locId).some(function (child) {
    return locationHasAnyItems(data, child.id);
  });
}

// True if locationId, or any storage-space ancestor of it, is mapped to a
// floorplan SVG element — mirrors the backend's locateFrom walk
// (plugin/routes/items.js) so the frontend can decide whether "Locate on
// floorplan" would succeed without making a request first.
export function locationHasFloorplanMapping(data, locationId) {
  var current = locationId ? data.locations.find(function (l) { return l.id === locationId; }) : null;
  while (current) {
    if (current.type === 'storage_space' && current.floorplan_id && current.svg_element_id) return true;
    current = current.parent_id ? data.locations.find(function (l) { return l.id === current.parent_id; }) : null;
  }
  return false;
}

// True if an item (or, for a split item, any of its placements) resolves
// to a floorplan-mapped storage space — used to decide whether the item
// detail page's "Locate on floorplan" button should show.
export function itemHasFloorplanMapping(data, item) {
  if (isSplit(item)) {
    return item.placements.some(function (p) { return locationHasFloorplanMapping(data, p.location_id); });
  }
  return locationHasFloorplanMapping(data, item.location_id);
}

// Case-insensitive name/notes match, the same rule SearchBox's dropdown
// results already use. Used both there and by the live-filter helper
// below, so the two behaviors can't drift apart.
export function itemMatchesQuery(item, q) {
  if (!q) return true;
  var needle = q.toLowerCase();
  if (item.name.toLowerCase().indexOf(needle) !== -1) return true;
  return !!(item.notes && item.notes.toLowerCase().indexOf(needle) !== -1);
}

// For live-filtering the Inventory tree and Overview rows (SPEC.md §6.3).
// A location "matches" either directly (its own name matches) or by
// containing a match (a descendant item or location matches) — a direct
// location match reveals its whole subtree, the same as browsing to it
// normally would, not just the path down to it. Returns the set of item
// ids to show and the set of location ids that must stay visible/expanded
// to keep every match reachable. An empty/falsy query returns null for
// both sets, meaning "show everything" — callers should treat null as
// "don't filter" rather than "filter to nothing".
export function filterQuery(data, query) {
  var q = (query || '').trim();
  if (!q) return { itemIds: null, locationIds: null };

  var itemIds = new Set();
  var locationIds = new Set();
  // Locations whose whole subtree is "inside a match" (a direct name
  // match) — distinct from locationIds, which just tracks which nodes
  // must stay visible/expanded. Using locationIds itself for this would
  // wrongly pull in unrelated siblings: reveal()ing the ancestor chain of
  // one matching item also adds that item's own location to locationIds,
  // which must NOT be read as "everything in this location is revealed".
  var revealedSubtreeIds = new Set();

  function reveal(locationId) {
    ancestorIds(data, locationId).forEach(function (id) { locationIds.add(id); });
  }
  function revealSubtree(locationId) {
    revealedSubtreeIds.add(locationId);
    descendantIds(data, locationId).forEach(function (id) { revealedSubtreeIds.add(id); });
    locationIds.add(locationId);
    descendantIds(data, locationId).forEach(function (id) { locationIds.add(id); });
  }

  data.locations.forEach(function (loc) {
    if (loc.name.toLowerCase().indexOf(q.toLowerCase()) === -1) return;
    reveal(loc.id);
    revealSubtree(loc.id);
  });

  data.items.forEach(function (item) {
    var matchedByName = itemMatchesQuery(item, q);
    if (isSplit(item)) {
      item.placements.forEach(function (p) {
        if (matchedByName || (p.location_id && revealedSubtreeIds.has(p.location_id))) {
          itemIds.add(item.id);
          if (p.location_id) reveal(p.location_id);
        }
      });
    } else if (matchedByName || (item.location_id && revealedSubtreeIds.has(item.location_id))) {
      itemIds.add(item.id);
      if (item.location_id) reveal(item.location_id);
    }
  });

  return { itemIds: itemIds, locationIds: locationIds };
}

export function isUnderstocked(item) {
  return item.target_quantity !== null && item.target_quantity !== undefined &&
    item.actual_quantity < item.target_quantity;
}

export var EXPIRING_WINDOW_DAYS = 14;

// Whole-days difference between today (local midnight) and a "YYYY-MM-DD"
// date string, parsed as local midnight too (avoids the classic off-by-one
// bug from parsing a bare date string as UTC).
export function daysUntil(dateStr) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

export function expiringStatusText(days) {
  if (days < 0) return 'Expired ' + Math.abs(days) + (Math.abs(days) === 1 ? ' day' : ' days') + ' ago';
  if (days === 0) return 'Expires today';
  return 'Expires in ' + days + (days === 1 ? ' day' : ' days');
}

export function isExpiringSoon(item) {
  return !!item.expires_at && daysUntil(item.expires_at) <= EXPIRING_WINDOW_DAYS;
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

// `view` is a resolvedItemsIn() entry: for a split item, its actual_quantity
// is already overridden to just this placement's share. The bold/understocked
// decision is still based on the item's overall total vs. target though,
// since a single placement being small doesn't mean the item as a whole is
// short on stock.
function itemMarkdownLine(view) {
  var isSplitView = view.placementId !== undefined && view.placementId !== null;
  var totalQuantity = isSplitView
    ? view.placements.reduce(function (sum, p) { return sum + p.quantity; }, 0)
    : view.actual_quantity;
  var understocked = view.target_quantity !== null && view.target_quantity !== undefined && totalQuantity < view.target_quantity;
  var qtyPart = '\u00d7' + view.actual_quantity;
  if (view.target_quantity !== null && view.target_quantity !== undefined) {
    qtyPart += ' (target ' + view.target_quantity + ')';
  }
  if (isSplitView) {
    qtyPart += ' (split item, ' + view.placements.length + ' locations)';
  }
  if (understocked) qtyPart = '**' + qtyPart + '**';
  return '- ' + view.name + ' \u2014 ' + qtyPart;
}

export function buildInventoryMarkdown(data) {
  var lines = [];

  function renderLocation(loc, depth) {
    var headingLevel = Math.min(depth, 6);
    var marker = loc.type === 'container' ? 'C' : 'S';
    lines.push('#'.repeat(headingLevel) + ' ' + loc.name + ' *' + marker + '*');
    lines.push('');
    var items = resolvedItemsIn(data, loc.id);
    items.forEach(function (item) { lines.push(itemMarkdownLine(item)); });
    if (items.length) lines.push('');
    childLocations(data, loc.id).forEach(function (child) { renderLocation(child, depth + 1); });
  }

  var topLevel = childLocations(data, null).filter(function (l) { return l.type === 'storage_space'; });
  topLevel.forEach(function (loc) { renderLocation(loc, 1); });

  var orphanedContainers = childLocations(data, null).filter(function (l) { return l.type === 'container'; });
  var unassignedItems = resolvedItemsIn(data, null);
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
  // Expiring items go on the list even if they're otherwise fully
  // stocked — soon they won't be, so they need replacing. For the
  // purposes of this list they're treated as if 0 were on hand, so the
  // amount to buy is the full target (falling back to whatever's on
  // hand today if there's no target set to size the replacement by).
  var understockedItems = data.items.filter(isUnderstocked);
  var expiringItems = data.items.filter(isExpiringSoon);
  var byId = new Map();
  understockedItems.forEach(function (item) { byId.set(item.id, item); });
  expiringItems.forEach(function (item) { byId.set(item.id, item); });
  var shoppingItems = Array.from(byId.values());

  var lines = ['# Shopping List', ''];

  if (!shoppingItems.length) {
    lines.push('Nothing needed right now.');
    return lines.join('\n').trim() + '\n';
  }

  var groups = new Map();
  shoppingItems.forEach(function (item) {
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
      var expiring = isExpiringSoon(item);
      var hasTarget = item.target_quantity !== null && item.target_quantity !== undefined;
      var onHand = expiring ? 0 : item.actual_quantity;
      var needed = hasTarget ? (item.target_quantity - onHand) : item.actual_quantity;
      var line = '- ' + item.name + ' \u2014 need ' + needed;
      if (expiring) line += ' (expires ' + item.expires_at + ')';
      lines.push(line);
    });
    lines.push('');
  });

  return lines.join('\n').trim() + '\n';
}
