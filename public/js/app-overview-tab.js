import { html, useState, useMemo, useEffect } from '../vendor/preact-htm-standalone.js';
import { useApp, QuantityEditor } from './app-core.js';
import { pathToRoot, isSplit, descendantIds, defaultPlacementFor } from './helpers.js';

function isoDate (d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo (n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

var ACTIVITY_WINDOW_DAYS = 30;

// True if this location, or any of its storage-space ancestors, is mapped
// to the current floorplan.
function isLocationOnFloorplan (data, locationId, floorplanId) {
  if (!locationId || !floorplanId) return false;
  var cur = data.locations.find(function (l) { return l.id === locationId; });
  while (cur) {
    if (cur.type === 'storage_space' && cur.floorplan_id === floorplanId && cur.svg_element_id) return true;
    cur = cur.parent_id ? data.locations.find(function (l) { return l.id === cur.parent_id; }) : null;
  }
  return false;
}

export function OverviewTab() {
  var app = useApp();
  var filterState = useState('');
  var filter = filterState[0], setFilter = filterState[1];
  var sortState = useState({ key: 'fullPath', dir: 1 });
  var sort = sortState[0], setSort = sortState[1];

  var viewModeState = useState('table');
  var viewMode = viewModeState[0], setViewMode = viewModeState[1];
  var touchSortState = useState('activity');
  var touchSort = touchSortState[0], setTouchSort = touchSortState[1];
  var locationFilterState = useState('');
  var locationFilter = locationFilterState[0], setLocationFilter = locationFilterState[1];
  var activityCountsState = useState({});
  var activityCounts = activityCountsState[0], setActivityCounts = activityCountsState[1];

  // Recent-activity sort needs a count of how often each item's quantity
  // has actually changed lately — fetched on demand (not part of the
  // regular poll) since it's only needed for this one sort mode.
  useEffect(function () {
    if (viewMode !== 'touch' || touchSort !== 'activity') return;
    app.getItemLog(isoDate(daysAgo(ACTIVITY_WINDOW_DAYS)), isoDate(new Date())).then(function (log) {
      var counts = {};
      log.forEach(function (entry) {
        if (entry.event !== 'actual_quantity') return;
        counts[entry.item_id] = (counts[entry.item_id] || 0) + 1;
      });
      setActivityCounts(counts);
    }).catch(function () {});
  }, [viewMode, touchSort]);

  var rows = useMemo(function () {
    var floorplanId = app.data.floorplans.length ? app.data.floorplans[0].id : null;
    return app.data.items.map(function (item) {
      var categoryNames = (item.categories || []).map(function (c) { return c.name; }).join(', ');
      var directLocation, directType, fullPath, mapped;

      if (isSplit(item)) {
        directLocation = 'Split (' + item.placements.length + ' locations)';
        directType = '';
        fullPath = item.placements.map(function (p) {
          return p.location_id ? pathToRoot(app.data, p.location_id) : 'no location';
        }).join('; ');
        mapped = item.placements.some(function (p) { return isLocationOnFloorplan(app.data, p.location_id, floorplanId); });
      } else {
        var directLoc = item.location_id ? app.data.locations.find(function (l) { return l.id === item.location_id; }) : null;
        directLocation = directLoc ? directLoc.name : '\u2014';
        directType = directLoc ? (directLoc.type === 'storage_space' ? 'Storage Space' : 'Container') : '';
        fullPath = item.location_id ? pathToRoot(app.data, item.location_id) : 'no location';
        mapped = isLocationOnFloorplan(app.data, item.location_id, floorplanId);
      }

      return {
        item: item,
        name: item.name,
        actualQuantity: item.actual_quantity,
        targetQuantity: item.target_quantity,
        thumbnail: item.thumbnail || null,
        directLocation: directLocation,
        directType: directType,
        fullPath: fullPath,
        categoryNames: categoryNames || '\u2014',
        onFloorplan: !!mapped
      };
    });
  }, [app.data.items, app.data.locations, app.data.floorplans]);

  var filtered = rows.filter(function (r) {
    if (!filter) return true;
    var q = filter.toLowerCase();
    return r.name.toLowerCase().indexOf(q) !== -1 ||
      r.directLocation.toLowerCase().indexOf(q) !== -1 ||
      r.fullPath.toLowerCase().indexOf(q) !== -1 ||
      (r.item.notes && r.item.notes.toLowerCase().indexOf(q) !== -1);
  });

  var sorted = filtered.slice().sort(function (a, b) {
    var av = a[sort.key], bv = b[sort.key];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
    return String(av).localeCompare(String(bv)) * sort.dir;
  });

  function toggleSort(key) {
    if (sort.key === key) setSort({ key: key, dir: sort.dir * -1 });
    else setSort({ key: key, dir: 1 });
  }

  function arrow(key) {
    if (sort.key !== key) return '';
    return sort.dir === 1 ? ' \u2191' : ' \u2193';
  }

  var locationOptions = useMemo(function () {
    return app.data.locations.map(function (l) {
      return { id: l.id, label: pathToRoot(app.data, l.id) };
    }).sort(function (a, b) { return a.label.localeCompare(b.label); });
  }, [app.data.locations]);

  function isUnderLocation (item, locId) {
    if (!locId) return true;
    var allowed = new Set(descendantIds(app.data, locId));
    allowed.add(locId);
    if (isSplit(item)) return item.placements.some(function (p) { return allowed.has(p.location_id); });
    return !!item.location_id && allowed.has(item.location_id);
  }

  var touchRows = rows.filter(function (r) { return isUnderLocation(r.item, locationFilter); });

  var touchSorted = touchRows.slice().sort(function (a, b) {
    if (touchSort === 'alphabetical') return a.name.localeCompare(b.name);
    var ac = activityCounts[a.item.id] || 0;
    var bc = activityCounts[b.item.id] || 0;
    if (ac !== bc) return bc - ac;
    return a.name.localeCompare(b.name);
  });

  function adjustQty (item, delta) {
    var defaultPlacement = defaultPlacementFor(item);
    if (defaultPlacement) {
      var nextPlacementQty = Math.max(0, defaultPlacement.quantity + delta);
      if (nextPlacementQty === defaultPlacement.quantity) return;
      app.setPlacementQuantity(item.id, defaultPlacement.id, nextPlacementQty, null).catch(function () {});
      return;
    }
    var next = Math.max(0, item.actual_quantity + delta);
    if (next === item.actual_quantity) return;
    app.updateItem(item.id, { actual_quantity: next }).catch(function () {});
  }

  var columns = [
    { key: null, label: 'Photo' },
    { key: 'name', label: 'Item' },
    { key: 'actualQuantity', label: 'Actual Quantity' },
    { key: 'targetQuantity', label: 'Target Quantity' },
    { key: 'directLocation', label: 'Direct Location' },
    { key: 'fullPath', label: 'Full Path' },
    { key: 'categoryNames', label: 'Categories' },
    { key: 'onFloorplan', label: 'On Floorplan' }
  ];

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <button type="button" class=${viewMode === 'table' ? 'active' : ''} onClick=${function () { setViewMode('table'); }}>Table</button>
        <button type="button" class=${viewMode === 'touch' ? 'active' : ''} onClick=${function () { setViewMode('touch'); }}>Touch</button>
        ${viewMode === 'table' ? html`
          <input type="text" placeholder="Filter table…" value=${filter} onInput=${function (e) { setFilter(e.target.value); }} />
        ` : html`
          <button type="button" class=${touchSort === 'activity' ? 'active' : ''} onClick=${function () { setTouchSort('activity'); }}>Recent Activity</button>
          <button type="button" class=${touchSort === 'alphabetical' ? 'active' : ''} onClick=${function () { setTouchSort('alphabetical'); }}>Alphabetical</button>
          <select onChange=${function (e) { setLocationFilter(e.target.value); }}>
            <option value="">All locations</option>
            ${locationOptions.map(function (l) { return html`<option key=${l.id} value=${l.id}>${l.label}</option>`; })}
          </select>
        `}
      </div>
      ${viewMode === 'table' ? html`
        <p class="hint">Clicking a row jumps to the floorplan (if assigned).</p>
        <div class="table-scroll">
        <table class="overview-table">
          <thead>
            <tr>
              ${columns.map(function (col) {
                return html`
                  <th key=${col.label} onClick=${col.key ? function () { toggleSort(col.key); } : null}>
                    ${col.label}${col.key ? arrow(col.key) : ''}
                  </th>
                `;
              })}
            </tr>
          </thead>
          <tbody>
            ${!sorted.length ? html`<tr class="empty-row"><td colspan="8">No items found.</td></tr>` : null}
            ${sorted.map(function (r) {
              var thumb = r.thumbnail
                ? html`<img class="item-thumb" src=${r.thumbnail} alt="" />`
                : html`<span class="item-thumb item-thumb-placeholder"></span>`;
              return html`
                <tr key=${r.item.id} onClick=${function () { app.locateItem(r.item); }}>
                  <td>${thumb}</td>
                  <td>${r.name}</td>
                  <td><${QuantityEditor} item=${r.item} showTotal=${true} /></td>
                  <td>${r.targetQuantity != null ? r.targetQuantity : '\u2014'}</td>
                  <td>${r.directLocation}${r.directType ? html` <span class="node-type">${r.directType}</span>` : null}</td>
                  <td>${r.fullPath}</td>
                  <td>${r.categoryNames}</td>
                  <td>${r.onFloorplan ? html`<span class="badge-yes">yes</span>` : html`<span class="badge-no">no</span>`}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
        </div>
      ` : html`
        <p class="hint">Tap a chip to jump to the floorplan (if assigned); tap −/+ to adjust stock. A split item
          with no default storage location set (see Item Properties) can't be adjusted here — use Split instead.</p>
        <div class="touch-grid">
          ${!touchSorted.length ? html`<p class="hint">No items found.</p>` : null}
          ${touchSorted.map(function (r) {
            var thumb = r.thumbnail
              ? html`<img class="touch-chip-thumb" src=${r.thumbnail} alt="" />`
              : html`<span class="touch-chip-thumb touch-chip-thumb-placeholder"></span>`;
            var defaultPlacement = defaultPlacementFor(r.item);
            var split = isSplit(r.item) && !defaultPlacement;
            var displayQty = defaultPlacement ? defaultPlacement.quantity : r.actualQuantity;
            var splitTooltip = 'This item is split across multiple locations — use Split to change its quantity, ' +
              'or set a default storage location in Item Properties to enable quick edits here.';
            return html`
              <div class="touch-chip" key=${r.item.id} onClick=${function () { app.locateItem(r.item); }}>
                ${thumb}
                <div class="touch-chip-name">${r.name}</div>
                <div class="touch-chip-location hint">
                  ${defaultPlacement ? 'Default: ' + (defaultPlacement.location_name || 'unnamed') : r.directLocation}
                </div>
                <div class="touch-chip-qty-row">
                  <button type="button" class="touch-qty-btn" disabled=${split}
                          title=${split ? splitTooltip : 'Remove one'}
                          onClick=${function (e) { e.stopPropagation(); adjustQty(r.item, -1); }}>\u2212</button>
                  <span class="touch-chip-qty" title=${defaultPlacement ? 'Total across all locations: ' + r.actualQuantity : ''}>
                    \u00d7${displayQty}${r.targetQuantity != null ? html` <span class="touch-chip-target">/ ${r.targetQuantity}</span>` : null}
                  </span>
                  <button type="button" class="touch-qty-btn" disabled=${split}
                          title=${split ? splitTooltip : 'Add one'}
                          onClick=${function (e) { e.stopPropagation(); adjustQty(r.item, 1); }}>+</button>
                </div>
              </div>
            `;
          })}
        </div>
      `}
    </section>
  `;
}
