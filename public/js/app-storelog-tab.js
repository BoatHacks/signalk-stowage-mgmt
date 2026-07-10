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

  var individual = useMemo(function () { return buildIndividualRows(rows); }, [rows]);
  var aggregate = useMemo(function () { return buildAggregateRows(rows); }, [rows]);
  var targetAdjustments = useMemo(function () {
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
      </div>

      ${loading ? html`<p class="hint">Loading\u2026</p>` : html`
        <div class="store-log-section-header">
          <h3 class="store-log-heading">Individual Movements</h3>
          <button type="button" onClick=${function () { app.openExportModal('storelog-individual', { start: start, end: end, rows: individual }); }}>Export as Markdown</button>
        </div>
        <table class="overview-table">
          <thead><tr><th>Item</th><th>Added</th><th>Used</th><th>Timestamp</th><th>Note</th></tr></thead>
          <tbody>
            ${!individual.length ? html`<tr class="empty-row"><td colspan="5">No inventory changes in this date range.</td></tr>` : null}
            ${individual.map(function (m) {
              return html`
                <tr key=${m.id}>
                  <td>${m.itemName}</td>
                  <td>${m.added || ''}</td>
                  <td>${m.used || ''}</td>
                  <td>${new Date(m.createdAt).toLocaleString()}</td>
                  <td>${m.note || ''}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>

        <div class="store-log-section-header">
          <h3 class="store-log-heading">Aggregate Movements</h3>
          <button type="button" onClick=${function () { app.openExportModal('storelog-aggregate', { start: start, end: end, rows: aggregate }); }}>Export as Markdown</button>
        </div>
        <table class="overview-table">
          <thead><tr><th>Item</th><th>Added</th><th>Used</th></tr></thead>
          <tbody>
            ${!aggregate.length ? html`<tr class="empty-row"><td colspan="3">No inventory changes in this date range.</td></tr>` : null}
            ${aggregate.map(function (a) {
              return html`
                <tr key=${a.itemId}>
                  <td>${a.itemName}</td>
                  <td>${a.added}</td>
                  <td>${a.used}</td>
                </tr>
              `;
            })}
          </tbody>
        </table>

        <div class="store-log-section-header">
          <h3 class="store-log-heading">Target Adjustments</h3>
          <button type="button" onClick=${function () { app.openExportModal('storelog-target', { start: start, end: end, rows: targetAdjustments }); }}>Export as Markdown</button>
        </div>
        <table class="overview-table">
          <thead><tr><th>Item</th><th>From</th><th>To</th><th>Date</th><th>Note</th></tr></thead>
          <tbody>
            ${!targetAdjustments.length ? html`<tr class="empty-row"><td colspan="5">No target quantity changes in this date range.</td></tr>` : null}
            ${targetAdjustments.map(function (r) {
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

// One row per movement event (item creation, actual_quantity change, or
// deletion), newest first.
function buildIndividualRows (rows) {
  return rows
    .filter(function (r) { return r.event === 'created' || r.event === 'actual_quantity' || r.event === 'deleted'; })
    .map(function (r) {
      var added = 0;
      var used = 0;
      if (r.event === 'deleted') used = Math.abs(r.delta);
      else if (r.delta > 0) added = r.delta;
      else if (r.delta < 0) used = Math.abs(r.delta);
      return { id: r.id, itemName: r.item_name, added: added, used: used, createdAt: r.created_at, note: r.note };
    })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
}

// Per-item Added/Used totals across the whole date range.
function buildAggregateRows (rows) {
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
    if (r.event === 'deleted') entry.used += Math.abs(r.delta);
    else if (r.delta > 0) entry.added += r.delta;
    else if (r.delta < 0) entry.used += Math.abs(r.delta);
  });

  return order.map(function (id) { return byItem[id]; }).sort(function (a, b) { return b.used - a.used; });
}

function fmtDate (start, end) {
  return 'Date range: ' + start + ' to ' + end;
}

export function buildStoreLogMarkdown (kind, data) {
  if (kind === 'storelog-individual') {
    var lines1 = ['# Individual Movements', '', fmtDate(data.start, data.end), ''];
    if (!data.rows.length) {
      lines1.push('No inventory changes in this date range.', '');
    } else {
      lines1.push('| Item | Added | Used | Timestamp | Note |', '| --- | --- | --- | --- | --- |');
      data.rows.forEach(function (m) {
        lines1.push(
          '| ' + m.itemName + ' | ' + (m.added || '') + ' | ' + (m.used || '') + ' | ' +
          new Date(m.createdAt).toLocaleString() + ' | ' + (m.note || '') + ' |'
        );
      });
      lines1.push('');
    }
    return lines1.join('\n').trim() + '\n';
  }

  if (kind === 'storelog-aggregate') {
    var lines2 = ['# Aggregate Movements', '', fmtDate(data.start, data.end), ''];
    if (!data.rows.length) {
      lines2.push('No inventory changes in this date range.', '');
    } else {
      lines2.push('| Item | Added | Used |', '| --- | --- | --- |');
      data.rows.forEach(function (a) {
        lines2.push('| ' + a.itemName + ' | ' + a.added + ' | ' + a.used + ' |');
      });
      lines2.push('');
    }
    return lines2.join('\n').trim() + '\n';
  }

  // storelog-target
  var lines3 = ['# Target Adjustments', '', fmtDate(data.start, data.end), ''];
  if (!data.rows.length) {
    lines3.push('No target quantity changes in this date range.', '');
  } else {
    lines3.push('| Item | From | To | Date | Note |', '| --- | --- | --- | --- | --- |');
    data.rows.forEach(function (r) {
      var from = r.old_value === null ? '\u2014' : r.old_value;
      var to = r.new_value === null ? '\u2014' : r.new_value;
      lines3.push('| ' + r.item_name + ' | ' + from + ' | ' + to + ' | ' + new Date(r.created_at).toLocaleString() + ' | ' + (r.note || '') + ' |');
    });
    lines3.push('');
  }
  return lines3.join('\n').trim() + '\n';
}
