import { html, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm-standalone.js';
import { useApp, Icon, IconBtn, QuantityEditor } from './app-core.js';
import { renderMarkdown } from './markdown.js';
import { AttachmentsSection } from './app-item-modals.js';
import { buildIndividualRows } from './app-storelog-tab.js';
import { FloorplanSvg } from './app-floorplan-modals.js';
import { isSplit, pathToRoot, itemHasFloorplanMapping, itemFloorplanTargets, resolveDetailPageSections, daysUntil, expiringStatusText } from './helpers.js';

// ---------- placements ----------

function PlacementsSection(props) {
  var app = useApp();
  var item = props.item;
  var hasMapping = itemHasFloorplanMapping(app.data, item);
  // "Locate on floorplan" only makes sense as a jump-to-Floorplan-tab
  // button when the floorplan isn't already shown inline on this page —
  // if the Floorplan section (below) is visible, it already shows the
  // blinking area right here.
  var showLocateButton = hasMapping && !props.floorplanSectionVisible;
  var rows = isSplit(item)
    ? item.placements.map(function (p) {
      return {
        placementId: p.id,
        locationId: p.location_id,
        isDefault: p.location_id === item.default_location_id,
        // A view with actual_quantity overridden to this placement's own
        // share, the same trick resolvedItemsIn() uses elsewhere — without
        // it, QuantityEditor falls back to the item's total (all
        // placements combined) instead of this row's own quantity.
        itemView: Object.assign({}, item, { actual_quantity: p.quantity })
      };
    })
    : [{ placementId: null, locationId: item.location_id, isDefault: false, itemView: item }];

  return html`
    <div class="detail-section">
      <div class="detail-section-header">
        <h3>Placements</h3>
        ${showLocateButton ? html`
          <button type="button" onClick=${function () { app.locateItem(item); }}>
            <${Icon} name="locate" /> Locate on floorplan
          </button>
        ` : null}
      </div>
      <ul class="placement-list">
        ${rows.map(function (r) {
          return html`
            <li key=${r.placementId || 'single'} class="placement-row">
              <span class="placement-location">
                ${r.locationId ? pathToRoot(app.data, r.locationId) : 'Not stored anywhere'}
                ${r.isDefault ? html`<span class="hint"> (default)</span>` : null}
              </span>
              <${QuantityEditor} item=${r.itemView} placementId=${r.placementId} className="qty" />
            </li>
          `;
        })}
      </ul>
    </div>
  `;
}

// ---------- floorplan ----------

function FloorplanSection(props) {
  var app = useApp();
  var item = props.item;
  var containerRef = useRef(null);
  var contentState = useState(null); // full floorplan { id, name, svg_content } or null

  var targets = itemFloorplanTargets(app.data, item);
  // Only one floorplan is ever active app-wide (README.md's Data Model
  // section — older ones are deleted on upload of a new one), so every
  // target necessarily shares the same floorplanId.
  var floorplanId = targets.length ? targets[0].floorplanId : null;

  useEffect(function () {
    if (!floorplanId) { contentState[1](null); return; }
    var cancelled = false;
    app.getFloorplan(floorplanId).then(function (fp) { if (!cancelled) contentState[1](fp); }).catch(function () {});
    return function () { cancelled = true; };
  }, [floorplanId]);

  var content = contentState[0];
  // Stable string key so mappedIds's array reference only changes when the
  // actual set of mapped areas changes — not on every unrelated re-render
  // (e.g. the attachments-loading effect in app.js) — see the identical
  // comment/fix in app-floorplan-tab.js. Without this, FloorplanSvg's own
  // inject effect (keyed on this array's reference) reruns and wipes the
  // freshly-injected SVG, losing the blink almost immediately.
  var mappedIdsKey = targets.map(function (t) { return t.svgElementId; }).sort().join(',');
  var mappedIds = useMemo(function () { return mappedIdsKey ? mappedIdsKey.split(',') : []; }, [mappedIdsKey]);

  // Blinks every target for 6s, same as the Floorplan tab's own
  // click-to-locate — re-triggers whenever the item changes or the
  // floorplan content (re)loads.
  useEffect(function () {
    if (!content || !containerRef.current) return;
    var elements = mappedIds
      .map(function (id) { return containerRef.current.querySelector('#' + CSS.escape(id)); })
      .filter(Boolean);
    if (!elements.length) return;
    elements.forEach(function (el) { el.classList.add('inv-blinking'); });
    var timer = setTimeout(function () {
      elements.forEach(function (el) { el.classList.remove('inv-blinking'); });
    }, 6000);
    return function () {
      clearTimeout(timer);
      elements.forEach(function (el) { el.classList.remove('inv-blinking'); });
    };
  }, [content, item.id]);

  return html`
    <div class="detail-section">
      <h3>Floorplan</h3>
      ${!targets.length
        ? html`<p class="hint">This item isn't on the floorplan.</p>`
        : (!content ? html`<p class="hint">Loading…</p>` : html`
            <div ref=${containerRef}>
              <${FloorplanSvg} svgContent=${content.svg_content} mappedIds=${mappedIds}
                               className="floorplan-container item-detail-floorplan" />
            </div>
          `)}
    </div>
  `;
}

// ---------- history ----------

function HistorySection(props) {
  var app = useApp();
  var item = props.item;
  var rowsState = useState([]);
  var loadingState = useState(true);

  useEffect(function () {
    loadingState[1](true);
    app.getItemLog(null, null, item.id).then(function (data) {
      rowsState[1](data);
      loadingState[1](false);
    }).catch(function (err) {
      app.showToast(err.message);
      loadingState[1](false);
    });
  }, [item.id]);

  var individual = buildIndividualRows(rowsState[0]);

  return html`
    <div class="detail-section">
      <h3>History</h3>
      ${loadingState[0] ? html`<p class="hint">Loading…</p>` : html`
        <div class="table-scroll">
          <table class="overview-table">
            <thead><tr><th>Added</th><th>Used</th><th>Location</th><th>Timestamp</th><th>Note</th></tr></thead>
            <tbody>
              ${!individual.length ? html`<tr class="empty-row"><td colspan="5">No history yet.</td></tr>` : null}
              ${individual.map(function (m) {
                return html`
                  <tr key=${m.id}>
                    <td>${m.added || ''}</td>
                    <td>${m.used || ''}</td>
                    <td>${m.location || ''}</td>
                    <td>${new Date(m.createdAt).toLocaleString()}</td>
                    <td>${m.note || ''}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

// ---------- properties (read-only; editing stays in ItemPropertiesModal) ----------

function PropertiesSection(props) {
  var app = useApp();
  var item = props.item;

  return html`
    <div class="detail-section">
      <div class="detail-section-header">
        <h3>Properties</h3>
        <button type="button" onClick=${function () { app.openPropertiesModal(item); }}>Edit</button>
      </div>
      ${item.thumbnail ? html`<img class="item-detail-photo" src=${item.thumbnail} alt="" />` : null}
      <div class="category-chip-list">
        ${(item.categories || []).map(function (cat) {
          return html`<span class="category-badge" key=${cat.id}><span class="type-icon"><${Icon} name="tag" title="Category" /></span>${cat.name}</span>`;
        })}
        ${!(item.categories || []).length ? html`<span class="hint">No categories.</span>` : null}
      </div>
      <p class="hint">
        ${item.expires_at ? expiringStatusText(daysUntil(item.expires_at)) + ' (' + item.expires_at + ')' : 'No expiration date set.'}
      </p>
      <div class="notes-preview" dangerouslySetInnerHTML=${{ __html: renderMarkdown(item.notes) }}></div>
    </div>
  `;
}

// ---------- section dispatch ----------

// AttachmentsSection is reused as-is from the Item Properties modal (it's
// already a self-contained "form-field" block) — wrapped here just enough
// to get the same section heading/divider the other three sections have.
function WrappedAttachmentsSection(props) {
  return html`
    <div class="detail-section">
      <h3>Attachments</h3>
      <${AttachmentsSection} item=${props.item} />
    </div>
  `;
}

var SECTION_COMPONENTS = {
  placements: PlacementsSection,
  floorplan: FloorplanSection,
  history: HistorySection,
  properties: PropertiesSection,
  attachments: WrappedAttachmentsSection
};

// ---------- item detail view ----------

export function ItemDetailView() {
  var app = useApp();
  var item = app.data.items.find(function (i) { return i.id === app.selectedItemId; });

  if (!item) {
    return html`
      <section class="tab-panel active item-detail-view">
        <p class="hint">This item no longer exists.</p>
        <button type="button" onClick=${app.closeItemDetail}><${Icon} name="back" /> Back</button>
      </section>
    `;
  }

  var sections = resolveDetailPageSections(app.config.detailPageSections);
  var floorplanSectionVisible = sections.indexOf('floorplan') !== -1;

  return html`
    <section class="tab-panel active item-detail-view">
      <div class="item-detail-header">
        <${IconBtn} icon="back" title="Back" onClick=${app.closeItemDetail} />
        ${item.thumbnail ? html`<img class="item-thumb" src=${item.thumbnail} alt="" />` : null}
        <h2 class="item-detail-name">${item.name}</h2>
        <span class="item-detail-qty">
          ×${item.actual_quantity}${item.target_quantity !== null && item.target_quantity !== undefined ? ' / ' + item.target_quantity : ''}
        </span>
      </div>
      ${sections.map(function (key) {
        var Section = SECTION_COMPONENTS[key];
        return html`<${Section} item=${item} floorplanSectionVisible=${floorplanSectionVisible} key=${key} />`;
      })}
    </section>
  `;
}
