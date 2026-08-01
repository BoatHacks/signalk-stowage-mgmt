import { html, useEffect, useRef, useState } from '../vendor/preact-htm-standalone.js';
import { useApp, Icon } from './app-core.js';
import { childLocations, resolvedItemsIn } from './helpers.js';
import { locationDeepLink, itemDeepLink, buildLabelSvg } from './qr-label.js';

var APP_ICON_URL = 'assets/icons/icon-512.png';

// One printable label: a QR code (with the app icon centered in it, per
// the design in SPEC.md §6.1/§11) plus the target's own name (not its full
// breadcrumb path — kept short so it stays legible at label size). Works
// for either a location (storage space/container) or an item, per
// props.target = { type: 'location'|'item', entity }.
// The QR SVG itself is trusted markup built entirely by qrcode-generator
// plus our own hardcoded overlay — nothing user-supplied is ever injected
// as raw markup here, only QR-encoded (the deep link) or rendered as
// ordinary (auto-escaped) text (the name) — so innerHTML is safe the same
// way it is for FloorplanSvg.
function Label(props) {
  var target = props.target;
  var app = useApp();
  var containerRef = useRef(null);
  var baseUrl = app.config.qrLabelBaseUrl || window.location.origin;
  var deepLink = target.type === 'item'
    ? itemDeepLink(baseUrl, target.entity.id)
    : locationDeepLink(baseUrl, target.entity.id);

  useEffect(function () {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = buildLabelSvg(deepLink, { logoUrl: APP_ICON_URL });
  }, [deepLink]);

  return html`
    <div class="qr-label">
      <div class="qr-label-code" ref=${containerRef}></div>
      <div class="qr-label-text">
        <div class="qr-label-name">${target.entity.name}</div>
      </div>
    </div>
  `;
}

// Single-label modal, opened from a location's or item's own actions menu.
export function LabelModal() {
  var app = useApp();
  var target = app.labelModalTarget;
  if (!target) return null;

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closeLabelModal(); }}>
      <div class="modal">
        <div class="modal-header">
          <h2>Label: ${target.entity.name}</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closeLabelModal}>×</button>
        </div>
        <div class="label-print-area">
          <${Label} target=${target} />
        </div>
        <div class="modal-footer">
          <button type="button" class="primary-btn" onClick=${function () { window.print(); }}>Print</button>
        </div>
      </div>
    </div>
  `;
}

// One row of the compact picker tree: a checkbox for the location itself,
// plus a nested list of child locations and the items stored directly in
// it (each with its own checkbox). Deliberately not LocationNode — this
// has no drag/drop, editing, or collapse state, just enough recursion to
// pick label targets.
function LabelPickerNode(props) {
  var app = useApp();
  var loc = props.loc;
  var isContainer = loc.type === 'container';
  var children = childLocations(app.data, loc.id);
  var items = resolvedItemsIn(app.data, loc.id);

  return html`
    <div class="label-picker-node">
      <label class="label-picker-row">
        <input type="checkbox" checked=${props.selectedLocations.has(loc.id)}
               onChange=${function () { props.toggleLocation(loc.id); }} />
        <span class="type-icon"><${Icon} name=${isContainer ? 'box' : 'cabinet'} title=${isContainer ? 'Container' : 'Storage space'} /></span>
        <span>${loc.name}</span>
      </label>
      ${(children.length || items.length) ? html`
        <div class="label-picker-children">
          ${children.map(function (child) {
            return html`
              <${LabelPickerNode} loc=${child} key=${child.id}
                                  selectedLocations=${props.selectedLocations} selectedItems=${props.selectedItems}
                                  toggleLocation=${props.toggleLocation} toggleItem=${props.toggleItem} />
            `;
          })}
          ${items.map(function (item) {
            return html`
              <label class="label-picker-row label-picker-item" key=${item.id + ':' + (item.placementId || '')}>
                <input type="checkbox" checked=${props.selectedItems.has(item.id)}
                       onChange=${function () { props.toggleItem(item.id); }} />
                <span class="type-icon"><${Icon} name="dot" title="Item" /></span>
                <span>${item.name}</span>
              </label>
            `;
          })}
        </div>
      ` : null}
    </div>
  `;
}

// Batch "Print Labels" page: a compact version of the inventory tree
// (storage spaces/containers/items, any depth) with a checkbox per node,
// then a printed grid of the selected labels.
export function PrintLabelsModal() {
  var app = useApp();
  var open = app.printLabelsModalOpen;
  var selectedLocationsState = useState(function () { return new Set(); });
  var selectedLocations = selectedLocationsState[0], setSelectedLocations = selectedLocationsState[1];
  var selectedItemsState = useState(function () { return new Set(); });
  var selectedItems = selectedItemsState[0], setSelectedItems = selectedItemsState[1];

  if (!open) return null;

  function toggleLocation(id) {
    setSelectedLocations(function (prev) {
      var next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleItem(id) {
    setSelectedItems(function (prev) {
      var next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function close() {
    setSelectedLocations(new Set());
    setSelectedItems(new Set());
    app.closePrintLabelsModal();
  }

  // Root of the tree: top-level locations (any type — includes orphaned
  // containers, the same as the Inventory tab's "Not Stored" panel) plus
  // items with no location at all.
  var rootLocations = childLocations(app.data, null);
  var rootItems = resolvedItemsIn(app.data, null);

  var allLocationIds = app.data.locations.map(function (l) { return l.id; });
  var allItemIds = app.data.items.map(function (i) { return i.id; });
  var allSelected = allLocationIds.length + allItemIds.length > 0 &&
    allLocationIds.every(function (id) { return selectedLocations.has(id); }) &&
    allItemIds.every(function (id) { return selectedItems.has(id); });

  function selectAllOrNone() {
    if (allSelected) {
      setSelectedLocations(new Set());
      setSelectedItems(new Set());
    } else {
      setSelectedLocations(new Set(allLocationIds));
      setSelectedItems(new Set(allItemIds));
    }
  }

  var selectedTargets = app.data.locations
    .filter(function (l) { return selectedLocations.has(l.id); })
    .map(function (l) { return { type: 'location', entity: l }; })
    .concat(app.data.items
      .filter(function (i) { return selectedItems.has(i.id); })
      .map(function (i) { return { type: 'item', entity: i }; }))
    .sort(function (a, b) { return a.entity.name.localeCompare(b.entity.name); });

  var hasAnything = rootLocations.length || rootItems.length;

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) close(); }}>
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Print Labels</h2>
          <button class="modal-close" aria-label="Close" onClick=${close}>×</button>
        </div>
        <p class="hint">Select any storage space, container, or item, then print the selected labels.</p>
        <div class="label-picker">
          ${hasAnything ? html`
            <button type="button" onClick=${selectAllOrNone}>${allSelected ? 'Select None' : 'Select All'}</button>
          ` : null}
          <div class="label-picker-tree">
            ${!hasAnything ? html`<span class="category-chip-empty">Nothing to label yet.</span>` : null}
            ${rootLocations.map(function (loc) {
              return html`
                <${LabelPickerNode} loc=${loc} key=${loc.id}
                                    selectedLocations=${selectedLocations} selectedItems=${selectedItems}
                                    toggleLocation=${toggleLocation} toggleItem=${toggleItem} />
              `;
            })}
            ${rootItems.map(function (item) {
              return html`
                <label class="label-picker-row label-picker-item" key=${item.id}>
                  <input type="checkbox" checked=${selectedItems.has(item.id)}
                         onChange=${function () { toggleItem(item.id); }} />
                  <span class="type-icon"><${Icon} name="dot" title="Item" /></span>
                  <span>${item.name}</span>
                </label>
              `;
            })}
          </div>
        </div>
        <div class="label-print-area label-print-grid">
          ${selectedTargets.map(function (t) { return html`<${Label} target=${t} key=${t.type + ':' + t.entity.id} />`; })}
        </div>
        <div class="modal-footer">
          <button type="button" class="primary-btn" disabled=${!selectedTargets.length}
                  onClick=${function () { window.print(); }}>
            Print ${selectedTargets.length} Label${selectedTargets.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  `;
}
