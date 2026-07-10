import { h, html, useState, useEffect, useMemo } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';

function isoDate (d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo (n) {
  var d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

var PRESETS = [
  { label: 'Last Week', days: 7 },
  { label: 'Last Month', days: 30 },
  { label: 'Last Quarter', days: 91 },
  { label: 'Last 6 Months', days: 182 },
  { label: 'Last Year', days: 365 }
];

export function StoreLogTab () {
  var app = useApp();
  var startState = useState(isoDate(daysAgo(30)));
  var start = startState[0], setStart = startState[1];
  var endState = useState(isoDate(new Date()));
  var end = endState[0], setEnd = endState[1];
  var rowsState = useState([]);
  var rows = rowsState[0], setRows = rowsState[1];
  var loadingState = useState(true);
  var loading = loadingState[0], setLoading = loadingState[1];

  useEffect(function () {
    setLoading(true);
    app.getItemLog(start, end).then(function (data) {
      setRows(data);
      setLoading(false);
    }).catch(function (err) {
      app.showToast(err.message);
      setLoading(false);
    });
  }, [start, end]);

  function applyPreset (days) {
    setStart(isoDate(daysAgo(days)));
    setEnd(isoDate(new Date()));
  }

  var movement = useMemo(function () { return buildMovementRows(rows); }, [rows]);
  var targetChanges = useMemo(function () {
    return rows.filter(function (r) { return r.event === 'target_quantity'; })
      .slice()
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  }, [rows]);

  return html`
    <section class="tab-panel active">
      <div class="toolbar store-log-toolbar">
        <div class="store-log-presets">
          ${PRESETS.map(function (p) {
            return html`<button type="button" key=${p.label} onClick=${function () { applyPreset(p.days); }}>${p.label}</button>`;
          })}
        </div>
        <div class="store-log-dates">
          <label>From <input type="date" value=${start} onInput=${function (e) { setStart(e.target.value); }} /></label>
          <label>To <input type="date" value=${end} onInput=${function (e) { setEnd(e.target.value); }} /></label>
        </div>
        <button type="button" onClick=${function () { app.openExportModal('storelog', { start: start, end: end, movement: movement, targetChanges: targetChanges }); }}>Export as Markdown</button>
      </div>

      ${loading ? html`<p class="hint">Loading\u2026</p>` : html`
        <h3 class="store-log-heading">Inventory Movement</h3>
        <table class="overview-table">
          <thead><tr><th>Item</th><th>Added</th><th>Used</th><th>Net</th></tr></thead>
          <tbody>
            ${!movement.length ? html`<tr class="empty-row"><td colspan="4">No inventory changes in this date range.</td></tr>` : null}
            ${movement.map(function (m) {
              return html`
                <tr key=${m.itemId}>
                  <td>${m.itemName}</td>
                  <td>${m.added}</td>
                  <td>${m.used}</td>
                  <td>${m.net > 0 ? '+' + m.net : m.net}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>

        <h3 class="store-log-heading">Changes in Target Quantity</h3>
        <table class="overview-table">
          <thead><tr><th>Item</th><th>From</th><th>To</th><th>Date</th><th>Note</th></tr></thead>
          <tbody>
            ${!targetChanges.length ? html`<tr class="empty-row"><td colspan="5">No target quantity changes in this date range.</td></tr>` : null}
            ${targetChanges.map(function (r) {
              return html`
                <tr key=${r.id}>
                  <td>${r.item_name}</td>
                  <td>${r.old_value === null ? '\u2014' : r.old_value}</td>
                  <td>${r.new_value === null ? '\u2014' : r.new_value}</td>
                  <td>${new Date(r.created_at).toLocaleString()}</td>
                  <td>${r.note || ''}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      `}
    </section>
  `;
}

// Aggregates raw log rows into per-item Added/Used/Net totals. 'created'
// and positive 'actual_quantity' deltas count as Added; negative
// 'actual_quantity' deltas and 'deleted' events count as Used.
function buildMovementRows (rows) {
  var byItem = {};
  var order = [];

  rows.forEach(function (r) {
    if (r.event !== 'created' && r.event !== 'actual_quantity' && r.event !== 'deleted') return;
    if (!byItem[r.item_id]) {
      byItem[r.item_id] = { itemId: r.item_id, itemName: r.item_name, added: 0, used: 0 };
      order.push(r.item_id);
    }
    var entry = byItem[r.item_id];
    entry.itemName = r.item_name; // keep the most recent name seen
    if (r.event === 'deleted') {
      entry.used += Math.abs(r.delta);
    } else if (r.delta > 0) {
      entry.added += r.delta;
    } else if (r.delta < 0) {
      entry.used += Math.abs(r.delta);
    }
  });

  return order.map(function (id) {
    var e = byItem[id];
    return { itemId: e.itemId, itemName: e.itemName, added: e.added, used: e.used, net: e.added - e.used };
  }).sort(function (a, b) { return b.used - a.used; });
}

export function buildStoreLogMarkdown (data) {
  var lines = ['# Store Log', '', 'Date range: ' + data.start + ' to ' + data.end, ''];

  lines.push('## Inventory Movement', '');
  if (!data.movement.length) {
    lines.push('No inventory changes in this date range.', '');
  } else {
    lines.push('| Item | Added | Used | Net |', '| --- | --- | --- | --- |');
    data.movement.forEach(function (m) {
      lines.push('| ' + m.itemName + ' | ' + m.added + ' | ' + m.used + ' | ' + (m.net > 0 ? '+' + m.net : m.net) + ' |');
    });
    lines.push('');
  }

  lines.push('## Changes in Target Quantity', '');
  if (!data.targetChanges.length) {
    lines.push('No target quantity changes in this date range.', '');
  } else {
    lines.push('| Item | From | To | Date | Note |', '| --- | --- | --- | --- | --- |');
    data.targetChanges.forEach(function (r) {
      var from = r.old_value === null ? '\u2014' : r.old_value;
      var to = r.new_value === null ? '\u2014' : r.new_value;
      lines.push('| ' + r.item_name + ' | ' + from + ' | ' + to + ' | ' + new Date(r.created_at).toLocaleString() + ' | ' + (r.note || '') + ' |');
    });
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}
