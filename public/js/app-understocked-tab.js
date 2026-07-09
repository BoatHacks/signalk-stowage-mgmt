import { h, html } from '../vendor/preact-htm-standalone.js';
import { useApp, IconBtn, QuantityEditor } from './app-core.js';
import { isUnderstocked } from './helpers.js';

export function UnderstockedTab() {
  var app = useApp();
  var understocked = app.data.items.filter(isUnderstocked);

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <button type="button" onClick=${function () { app.openExportModal('shopping'); }}>Export as Markdown</button>
      </div>
      <div class="understocked-list">
        ${!understocked.length ? html`<p class="hint">Nothing understocked right now &mdash; every item with a target quantity has enough on hand.</p>` : null}
        ${understocked.map(function (item) {
          var thumb = item.thumbnail
            ? html`<img src=${item.thumbnail} alt="" />`
            : null;
          return html`
            <div class="understocked-chip" key=${item.id}>
              <div class=${'understocked-chip-thumb' + (item.thumbnail ? '' : ' item-thumb-placeholder')}>${thumb}</div>
              <div class="understocked-chip-info">
                <div class="understocked-chip-name">${item.name}</div>
                <div class="understocked-chip-qty">
                  <${QuantityEditor} item=${item} prefix="Actual: " className="qty-actual" />
                  <span class="qty-target"> / Target: ${item.target_quantity}</span>
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
