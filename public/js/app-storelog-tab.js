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

// A collapsible section — collapsed by default. The "Export as Markdown"
// button stays visible either way, so exporting never requires expanding.
function StoreLogSection (props) {
  var expandedState = useState(false);
  var expanded = expandedState[0], setExpanded = expandedState[1];

  return html`
    <div class="store-log-section">
      <div class="store-log-section-header">
        <div class="store-log-section-toggle" onClick=${function () { setExpanded(!expanded); }}>
          <span class="fold-arrow">${expanded ? '\u25be' : '\u25b8'}</span>
          <h3 class="store-log-heading">${props.title}</h3>
        </div>
        <button type="button" onClick=${props.onExport}>Export as Markdown</button>
      </div>
      ${expanded ? html`
        ${props.hint ? html`<p class="hint">${props.hint}</p>` : null}
        ${props.children}
      ` : null}
    </div>
  `;
}

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
  var splits = useMemo(function () {
    return rows.filter(function (r) { return r.event === 'split'; })
      .slice()
      .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
  }, [rows]);
  var predictions = useMemo(function () { return buildPredictionRows(rows, app.data.items, start, end); }, [rows, app.data.items, start, end]);

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
        <${StoreLogSection} title="Individual Movements"
                             onExport=${function () { app.openExportModal('storelog-individual', { start: start, end: end, rows: individual }); }}>
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
        </${StoreLogSection}>

        <${StoreLogSection} title="Aggregate Movements"
                             onExport=${function () { app.openExportModal('storelog-aggregate', { start: start, end: end, rows: aggregate }); }}>
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
        </${StoreLogSection}>

        <${StoreLogSection} title="Target Adjustments"
                             onExport=${function () { app.openExportModal('storelog-target', { start: start, end: end, rows: targetAdjustments }); }}>
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
        </${StoreLogSection}>

        <${StoreLogSection} title="Splits"
                             onExport=${function () { app.openExportModal('storelog-splits', { start: start, end: end, rows: splits }); }}>
          <table class="overview-table">
            <thead><tr><th>Item</th><th>From</th><th>To</th><th>Quantity</th><th>Date</th><th>Note</th></tr></thead>
            <tbody>
              ${!splits.length ? html`<tr class="empty-row"><td colspan="6">No splits in this date range.</td></tr>` : null}
              ${splits.map(function (r) {
                return html`
                  <tr key=${r.id}>
                    <td>${r.item_name}</td>
                    <td>${r.from_location_name || 'No Location'}</td>
                    <td>${r.to_location_name || 'No Location'}</td>
                    <td>${r.quantity}</td>
                    <td>${new Date(r.created_at).toLocaleString()}</td>
                    <td>${r.note || ''}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </${StoreLogSection}>

        <${StoreLogSection} title="Predicted Runway"
                             hint="Based on consumption in the date range above. Needs at least 3 separate uses in that range to estimate a rate; items without enough history aren't shown."
                             onExport=${function () { app.openExportModal('storelog-predictions', { start: start, end: end, rows: predictions }); }}>
          <table class="overview-table">
            <thead><tr><th>Item</th><th>Current Stock</th><th>Consumed (range)</th><th>Days Remaining</th><th>Runs Out Around</th></tr></thead>
            <tbody>
              ${!predictions.length ? html`<tr class="empty-row"><td colspan="5">Not enough usage history in this date range to predict anything.</td></tr>` : null}
              ${predictions.map(function (p) {
                return html`
                  <tr key=${p.itemId}>
                    <td>${p.itemName}</td>
                    <td>${p.currentStock}</td>
                    <td>${p.consumedInRange}</td>
                    <td>~${Math.round(p.daysRemaining)}</td>
                    <td>${p.projectedDate}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </${StoreLogSection}>
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

// Per-item consumption-rate projection over the selected date range.
// Requires at least 3 separate consumption events in range (actual_quantity
// decreases, or a deletion using up whatever remained) before predicting
// anything — a single/couple data points is too noisy to be worth showing.
// Restocking doesn't affect the rate, only the current-stock starting
// point (already accurate via the item's own actual_quantity).
function buildPredictionRows (rows, items, start, end) {
  var MIN_EVENTS = 3;
  var msPerDay = 24 * 60 * 60 * 1000;
  var daysInRange = Math.max(1, Math.round((new Date(end) - new Date(start)) / msPerDay) + 1);

  var byItem = {};
  rows.forEach(function (r) {
    var consumed;
    if (r.event === 'deleted') consumed = Math.abs(r.delta);
    else if (r.event === 'actual_quantity' && r.delta < 0) consumed = Math.abs(r.delta);
    else return;
    if (!byItem[r.item_id]) byItem[r.item_id] = { itemName: r.item_name, count: 0, totalConsumed: 0 };
    byItem[r.item_id].count += 1;
    byItem[r.item_id].totalConsumed += consumed;
    byItem[r.item_id].itemName = r.item_name;
  });

  var itemsById = {};
  items.forEach(function (i) { itemsById[i.id] = i; });

  var result = [];
  Object.keys(byItem).forEach(function (itemId) {
    var entry = byItem[itemId];
    if (entry.count < MIN_EVENTS) return;
    var currentItem = itemsById[itemId];
    if (!currentItem) return; // item no longer exists, nothing to project
    var rate = entry.totalConsumed / daysInRange;
    if (rate <= 0) return;
    var currentStock = currentItem.actual_quantity;
    var daysRemaining = currentStock / rate;
    var projected = new Date();
    projected.setDate(projected.getDate() + Math.round(daysRemaining));
    result.push({
      itemId: itemId,
      itemName: entry.itemName,
      currentStock: currentStock,
      consumedInRange: entry.totalConsumed,
      daysRemaining: daysRemaining,
      projectedDate: projected.toISOString().slice(0, 10)
    });
  });

  return result.sort(function (a, b) { return a.daysRemaining - b.daysRemaining; });
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

  if (kind === 'storelog-splits') {
    var lines4 = ['# Splits', '', fmtDate(data.start, data.end), ''];
    if (!data.rows.length) {
      lines4.push('No splits in this date range.', '');
    } else {
      lines4.push('| Item | From | To | Quantity | Date | Note |', '| --- | --- | --- | --- | --- | --- |');
      data.rows.forEach(function (r) {
        lines4.push(
          '| ' + r.item_name + ' | ' + (r.from_location_name || 'No Location') + ' | ' + (r.to_location_name || 'No Location') +
          ' | ' + r.quantity + ' | ' + new Date(r.created_at).toLocaleString() + ' | ' + (r.note || '') + ' |'
        );
      });
      lines4.push('');
    }
    return lines4.join('\n').trim() + '\n';
  }

  if (kind === 'storelog-predictions') {
    var lines5 = ['# Predicted Runway', '', fmtDate(data.start, data.end), ''];
    if (!data.rows.length) {
      lines5.push('Not enough usage history in this date range to predict anything.', '');
    } else {
      lines5.push('| Item | Current Stock | Consumed (range) | Days Remaining | Runs Out Around |', '| --- | --- | --- | --- | --- |');
      data.rows.forEach(function (p) {
        lines5.push('| ' + p.itemName + ' | ' + p.currentStock + ' | ' + p.consumedInRange + ' | ~' + Math.round(p.daysRemaining) + ' | ' + p.projectedDate + ' |');
      });
      lines5.push('');
    }
    return lines5.join('\n').trim() + '\n';
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
