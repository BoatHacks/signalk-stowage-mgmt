import { html } from '../vendor/preact-htm-standalone.js';
import { useApp, IconBtn } from './app-core.js';

var WINDOW_DAYS = 14;

// Whole-days difference between today (local midnight) and a "YYYY-MM-DD"
// date string, parsed as local midnight too (avoids the classic off-by-one
// bug from parsing a bare date string as UTC).
function daysUntil (dateStr) {
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function statusText (days) {
  if (days < 0) return 'Expired ' + Math.abs(days) + (Math.abs(days) === 1 ? ' day' : ' days') + ' ago';
  if (days === 0) return 'Expires today';
  return 'Expires in ' + days + (days === 1 ? ' day' : ' days');
}

export function isExpiringSoon (item) {
  return !!item.expires_at && daysUntil(item.expires_at) <= WINDOW_DAYS;
}

function expiringItems (data) {
  return data.items
    .filter(isExpiringSoon)
    .slice()
    .sort(function (a, b) { return daysUntil(a.expires_at) - daysUntil(b.expires_at); });
}

export function ExpiringTab () {
  var app = useApp();
  var items = expiringItems(app.data);

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <span class="hint">Items expiring within ${WINDOW_DAYS} days, or already expired.</span>
        <button type="button" onClick=${function () { app.openExportModal('expiring'); }}>Export as Markdown</button>
      </div>
      <div class="understocked-list">
        ${!items.length ? html`<p class="hint">Nothing expiring soon.</p>` : null}
        ${items.map(function (item) {
          var thumb = item.thumbnail ? html`<img src=${item.thumbnail} alt="" />` : null;
          var days = daysUntil(item.expires_at);
          var statusClass = days < 0 ? 'expiring-status-expired' : 'expiring-status-soon';
          return html`
            <div class="understocked-chip" key=${item.id}>
              <div class=${'understocked-chip-thumb' + (item.thumbnail ? '' : ' item-thumb-placeholder')}>${thumb}</div>
              <div class="understocked-chip-info">
                <div class="understocked-chip-name">${item.name}</div>
                <div class="understocked-chip-qty">
                  <span>${new Date(item.expires_at + 'T00:00:00').toLocaleDateString()}</span>
                  <span class=${statusClass}> \u2014 ${statusText(days)}</span>
                </div>
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

export function buildExpiringMarkdown (data) {
  var items = expiringItems(data);
  var lines = ['# Expiring Items', ''];
  if (!items.length) {
    lines.push('Nothing expiring within ' + WINDOW_DAYS + ' days.', '');
  } else {
    lines.push('| Item | Expires | Status |', '| --- | --- | --- |');
    items.forEach(function (item) {
      var days = daysUntil(item.expires_at);
      lines.push('| ' + item.name + ' | ' + item.expires_at + ' | ' + statusText(days) + ' |');
    });
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}
