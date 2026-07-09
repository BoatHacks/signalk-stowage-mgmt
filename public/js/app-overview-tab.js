import { h, html, useState, useMemo } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { pathToRoot } from './helpers.js';

export function OverviewTab() {
  var app = useApp();
  var filterState = useState('');
  var filter = filterState[0], setFilter = filterState[1];
  var sortState = useState({ key: 'fullPath', dir: 1 });
  var sort = sortState[0], setSort = sortState[1];

  var rows = useMemo(function () {
    return app.data.items.map(function (item) {
      var directLoc = item.location_id ? app.data.locations.find(function (l) { return l.id === item.location_id; }) : null;
      var categoryNames = (item.categories || []).map(function (c) { return c.name; }).join(', ');
      var floorplanId = app.data.floorplans.length ? app.data.floorplans[0].id : null;
      var mapped = directLoc && directLoc.type === 'storage_space' && directLoc.floorplan_id === floorplanId && directLoc.svg_element_id;
      // Storage-space ancestor walk, to also catch items nested in containers
      // inside a mapped storage space.
      if (!mapped && item.location_id) {
        var cur = directLoc;
        while (cur) {
          if (cur.type === 'storage_space' && cur.floorplan_id === floorplanId && cur.svg_element_id) { mapped = true; break; }
          cur = cur.parent_id ? app.data.locations.find(function (l) { return l.id === cur.parent_id; }) : null;
        }
      }
      return {
        item: item,
        name: item.name,
        actualQuantity: item.actual_quantity,
        thumbnail: item.thumbnail || null,
        directLocation: directLoc ? directLoc.name : '\u2014',
        directType: directLoc ? (directLoc.type === 'storage_space' ? 'Storage Space' : 'Container') : '',
        fullPath: item.location_id ? pathToRoot(app.data, item.location_id) : 'no location',
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
      r.fullPath.toLowerCase().indexOf(q) !== -1;
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

  var columns = [
    { key: null, label: 'Photo' },
    { key: 'name', label: 'Item' },
    { key: 'actualQuantity', label: 'Actual Quantity' },
    { key: 'directLocation', label: 'Direct Location' },
    { key: 'fullPath', label: 'Full Path' },
    { key: 'categoryNames', label: 'Categories' },
    { key: 'onFloorplan', label: 'On Floorplan' }
  ];

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <input type="text" placeholder="Filter table&hellip;" value=${filter} onInput=${function (e) { setFilter(e.target.value); }} />
      </div>
      <p class="hint">Clicking a row jumps to the floorplan (if assigned).</p>
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
          ${!sorted.length ? html`<tr class="empty-row"><td colspan="7">No items found.</td></tr>` : null}
          ${sorted.map(function (r) {
            var thumb = r.thumbnail
              ? html`<img class="item-thumb" src=${r.thumbnail} alt="" />`
              : html`<span class="item-thumb item-thumb-placeholder"></span>`;
            return html`
              <tr key=${r.item.id} onClick=${function () { app.locateItem(r.item); }}>
                <td>${thumb}</td>
                <td>${r.name}</td>
                <td>${r.actualQuantity}</td>
                <td>${r.directLocation}${r.directType ? html` <span class="node-type">${r.directType}</span>` : null}</td>
                <td>${r.fullPath}</td>
                <td>${r.categoryNames}</td>
                <td>${r.onFloorplan ? html`<span class="badge-yes">yes</span>` : html`<span class="badge-no">no</span>`}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </section>
  `;
}
