import { html } from '../vendor/preact-htm-standalone.js';
import { useApp, IconBtn, QuantityEditor } from './app-core.js';
import { isUnderstocked, isExpiringSoon, daysUntil, expiringStatusText, EXPIRING_WINDOW_DAYS } from './helpers.js';

// Union of understocked and expiring-soon items, most urgent first: items
// with an expiration date sort by days-until-expiry (soonest/most-expired
// first), and understocked-only items (no expiration date) follow, sorted
// by name for a stable order.
function alertItems (data) {
  var items = data.items.filter(function (item) { return isUnderstocked(item) || isExpiringSoon(item); });
  return items.slice().sort(function (a, b) {
    var aExp = isExpiringSoon(a), bExp = isExpiringSoon(b);
    if (aExp && bExp) return daysUntil(a.expires_at) - daysUntil(b.expires_at);
    if (aExp !== bExp) return aExp ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export function StockAlertsTab () {
  var app = useApp();
  var items = alertItems(app.data);

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <span class="hint">Understocked items, and items expiring within ${EXPIRING_WINDOW_DAYS} days or already expired.</span>
        <button type="button" onClick=${function () { app.openExportModal('shopping'); }}>Export as Markdown</button>
      </div>
      <div class="understocked-list">
        ${!items.length ? html`<p class="hint">Nothing needs attention right now.</p>` : null}
        ${items.map(function (item) {
          var thumb = item.thumbnail ? html`<img src=${item.thumbnail} alt="" />` : null;
          var understocked = isUnderstocked(item);
          var expiring = isExpiringSoon(item);
          var days = expiring ? daysUntil(item.expires_at) : null;
          var statusClass = expiring && days < 0 ? 'expiring-status-expired' : 'expiring-status-soon';
          return html`
            <div class="understocked-chip" key=${item.id}>
              <div class=${'understocked-chip-thumb' + (item.thumbnail ? '' : ' item-thumb-placeholder')}>${thumb}</div>
              <div class="understocked-chip-info">
                <div class="understocked-chip-name">
                  ${item.name}
                  ${understocked ? html`<span class="chip-badge chip-badge-understocked">Understocked</span>` : null}
                  ${expiring ? html`<span class="chip-badge chip-badge-expiring">Expiring</span>` : null}
                </div>
                ${understocked ? html`
                  <div class="understocked-chip-qty">
                    <${QuantityEditor} item=${item} prefix="Actual: " className="qty-actual" />
                    <span class="qty-target"> / Target: ${item.target_quantity}</span>
                  </div>
                ` : null}
                ${expiring ? html`
                  <div class="understocked-chip-qty">
                    <span>${new Date(item.expires_at + 'T00:00:00').toLocaleDateString()}</span>
                    <span class=${statusClass}> \u2014 ${expiringStatusText(days)}</span>
                  </div>
                ` : null}
              </div>
              <div class="understocked-chip-actions">
                <${IconBtn} icon="edit" title="Edit" onClick=${function () { app.openPropertiesModal(item); }} />
              </div>
            </div>
          `;
        })}
      </div>
    </section>
  `;
}
