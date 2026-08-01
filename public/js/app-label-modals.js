import { html, useEffect, useRef, useState } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { pathToRoot } from './helpers.js';
import { locationDeepLink, buildLabelSvg } from './qr-label.js';

var APP_ICON_URL = 'assets/icons/icon-512.png';

// One printable label: a QR code (with the app icon centered in it, per
// the design in SPEC.md §6.1/§11) plus the location's own name (not its
// full breadcrumb path — kept short so it stays legible at label size).
// The QR SVG itself is trusted markup built entirely by qrcode-generator
// plus our own hardcoded overlay — nothing user-supplied is ever injected
// as raw markup here, only QR-encoded (the deep link) or rendered as
// ordinary (auto-escaped) text (the name) — so innerHTML is safe the same
// way it is for FloorplanSvg.
function Label(props) {
  var loc = props.loc;
  var app = useApp();
  var containerRef = useRef(null);
  var baseUrl = app.config.qrLabelBaseUrl || window.location.origin;
  var deepLink = locationDeepLink(baseUrl, loc.id);

  useEffect(function () {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = buildLabelSvg(deepLink, { logoUrl: APP_ICON_URL });
  }, [deepLink]);

  return html`
    <div class="qr-label">
      <div class="qr-label-code" ref=${containerRef}></div>
      <div class="qr-label-text">
        <div class="qr-label-name">${loc.name}</div>
      </div>
    </div>
  `;
}

// Single-label modal, opened from a location's own actions menu.
export function LabelModal() {
  var app = useApp();
  var loc = app.labelModalLocation;
  if (!loc) return null;

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closeLabelModal(); }}>
      <div class="modal">
        <div class="modal-header">
          <h2>Label: ${loc.name}</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closeLabelModal}>×</button>
        </div>
        <div class="label-print-area">
          <${Label} loc=${loc} />
        </div>
        <div class="modal-footer">
          <button type="button" class="primary-btn" onClick=${function () { window.print(); }}>Print</button>
        </div>
      </div>
    </div>
  `;
}

// Batch "Print Labels" page: multi-select any storage space/container
// (any depth), then print a grid of the selected labels.
export function PrintLabelsModal() {
  var app = useApp();
  var open = app.printLabelsModalOpen;
  var selectedState = useState(function () { return new Set(); });
  var selected = selectedState[0], setSelected = selectedState[1];

  if (!open) return null;

  function toggle(id) {
    setSelected(function (prev) {
      var next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function close() {
    setSelected(new Set());
    app.closePrintLabelsModal();
  }

  var sortedLocations = app.data.locations.slice().sort(function (a, b) {
    return pathToRoot(app.data, a.id).localeCompare(pathToRoot(app.data, b.id));
  });
  var selectedLocations = sortedLocations.filter(function (l) { return selected.has(l.id); });

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) close(); }}>
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Print Labels</h2>
          <button class="modal-close" aria-label="Close" onClick=${close}>×</button>
        </div>
        <p class="hint">Select any storage space or container, then print the selected labels.</p>
        ${sortedLocations.length ? html`
          <button type="button" onClick=${function () {
            setSelected(selected.size === sortedLocations.length ? new Set() : new Set(sortedLocations.map(function (l) { return l.id; })));
          }}>${selected.size === sortedLocations.length ? 'Select None' : 'Select All'}</button>
        ` : null}
        <div class="category-chip-list">
          ${!sortedLocations.length ? html`<span class="category-chip-empty">No storage spaces or containers yet.</span>` : null}
          ${sortedLocations.map(function (loc) {
            var isSelected = selected.has(loc.id);
            return html`
              <button type="button" key=${loc.id} class=${'category-chip' + (isSelected ? ' assigned' : '')}
                      onClick=${function () { toggle(loc.id); }}>${pathToRoot(app.data, loc.id)}</button>
            `;
          })}
        </div>
        <div class="label-print-area label-print-grid">
          ${selectedLocations.map(function (loc) { return html`<${Label} loc=${loc} key=${loc.id} />`; })}
        </div>
        <div class="modal-footer">
          <button type="button" class="primary-btn" disabled=${!selectedLocations.length}
                  onClick=${function () { window.print(); }}>
            Print ${selectedLocations.length} Label${selectedLocations.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  `;
}
