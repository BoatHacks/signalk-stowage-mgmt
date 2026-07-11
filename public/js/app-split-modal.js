import { h, html, useState, useEffect } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { pathToRoot } from './helpers.js';

// Returns the item's current allocation as a list of { location_id,
// location_name, quantity } — either its real placements (if split) or a
// single synthesized entry representing where it currently sits.
function currentAllocations (item, data) {
  if (item.placements && item.placements.length > 0) return item.placements;
  var loc = item.location_id ? data.locations.find(function (l) { return l.id === item.location_id; }) : null;
  return [{ id: null, location_id: item.location_id || null, location_name: loc ? loc.name : null, quantity: item.actual_quantity }];
}

export function SplitModal () {
  var app = useApp();
  var state = app.splitModal; // { item, fromLocationId } | null

  var fromState = useState(null);
  var from = fromState[0], setFrom = fromState[1];
  var toState = useState('__unset__');
  var to = toState[0], setTo = toState[1];
  var qtyState = useState('');
  var qty = qtyState[0], setQty = qtyState[1];
  var noteState = useState('');
  var note = noteState[0], setNote = noteState[1];

  useEffect(function () {
    if (!state) return;
    setFrom(state.fromLocationId !== undefined ? state.fromLocationId : (state.item.location_id || null));
    setTo('__unset__');
    setQty('');
    setNote('');
  }, [state && state.item.id, state && state.fromLocationId]);

  if (!state) return null;
  var item = app.data.items.find(function (i) { return i.id === state.item.id; }) || state.item;
  var allocations = currentAllocations(item, app.data);
  var fromAllocation = allocations.find(function (a) { return (a.location_id || null) === (from || null); });
  var available = fromAllocation ? fromAllocation.quantity : 0;

  var otherLocations = app.data.locations.filter(function (l) { return (l.id || null) !== (from || null); });

  function submit () {
    var n = parseInt(qty, 10);
    if (!n || n <= 0) return app.showToast('Enter a quantity greater than zero.');
    if (n > available) return app.showToast('Only ' + available + ' available at the source location.');
    if (to === '__unset__') return app.showToast('Choose where to split it to.');
    var toLocationId = to === '__none__' ? null : to;
    if ((toLocationId || null) === (from || null)) return app.showToast('Source and destination must be different.');
    app.splitItem(item.id, {
      from_location_id: from || null, to_location_id: toLocationId, quantity: n, note: note || null
    }).then(app.closeSplitModal).catch(function () {});
  }

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closeSplitModal(); }}>
      <div class="modal">
        <div class="modal-header">
          <h2>Split "${item.name}"</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closeSplitModal}>&times;</button>
        </div>

        <p class="hint">Current allocation:</p>
        <ul class="split-allocation-list">
          ${allocations.map(function (a) {
            return html`<li key=${a.location_id || 'none'}>${a.location_name || 'No Location'} \u2014 \u00d7${a.quantity}</li>`;
          })}
        </ul>

        <div class="form-field">
          <label>From</label>
          <select value=${from || '__none__'} onInput=${function (e) { setFrom(e.target.value === '__none__' ? null : e.target.value); }}>
            ${allocations.map(function (a) {
              return html`<option key=${a.location_id || 'none'} value=${a.location_id || '__none__'}>${a.location_name || 'No Location'} (\u00d7${a.quantity} available)</option>`;
            })}
          </select>
        </div>

        <div class="form-field">
          <label>To</label>
          <select value=${to} onInput=${function (e) { setTo(e.target.value); }}>
            <option value="__unset__" disabled>Choose a destination&hellip;</option>
            ${(from !== null) ? html`<option value="__none__">No Location</option>` : null}
            ${otherLocations.map(function (l) {
              return html`<option key=${l.id} value=${l.id}>${pathToRoot(app.data, l.id)} [${l.type === 'storage_space' ? 'Storage Space' : 'Container'}]</option>`;
            })}
          </select>
        </div>

        <div class="form-field-row">
          <div class="form-field">
            <label>Quantity to move</label>
            <input type="number" min="1" max=${available} placeholder=${'up to ' + available} value=${qty}
                   onInput=${function (e) { setQty(e.target.value); }} />
          </div>
        </div>

        <div class="form-field">
          <label>Reason for split <span class="hint">(optional, shown in the Store Log)</span></label>
          <input type="text" placeholder="e.g. keeping spares near the engine room too" value=${note}
                 onInput=${function (e) { setNote(e.target.value); }} />
        </div>

        <div class="modal-footer">
          <button type="button" class="primary-btn" onClick=${submit}>Split</button>
        </div>
      </div>
    </div>
  `;
}
