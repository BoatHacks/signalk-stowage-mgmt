import { html, useState, useEffect } from '../vendor/preact-htm-standalone.js';
import { useApp, Icon, IconBtn, QuantityEditor } from './app-core.js';
import { renderMarkdown } from './markdown.js';
import { AttachmentsSection } from './app-item-modals.js';
import { buildIndividualRows } from './app-storelog-tab.js';
import { isSplit, pathToRoot, itemHasFloorplanMapping, resolveDetailPageSections, daysUntil, expiringStatusText } from './helpers.js';

// ---------- placements ----------

function PlacementsSection(props) {
  var app = useApp();
  var item = props.item;
  var hasMapping = itemHasFloorplanMapping(app.data, item);
  var rows = isSplit(item)
    ? item.placements.map(function (p) { return { placementId: p.id, locationId: p.location_id, isDefault: p.location_id === item.default_location_id }; })
    : [{ placementId: null, locationId: item.location_id, isDefault: false }];

  return html`
    <div class="detail-section">
      <div class="detail-section-header">
        <h3>Placements</h3>
        ${hasMapping ? html`
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
              <${QuantityEditor} item=${item} placementId=${r.placementId} className="qty" />
            </li>
          `;
        })}
      </ul>
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
        return html`<${Section} item=${item} key=${key} />`;
      })}
    </section>
  `;
}
