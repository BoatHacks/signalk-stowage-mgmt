import { h, html } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { LocationNode } from './app-nodes.js';
import { childLocations } from './helpers.js';

export function InventoryTab() {
  var app = useApp();
  var topLevel = childLocations(app.data, null).filter(function (l) { return l.type === 'storage_space'; });

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <button type="button" onClick=${function () { app.addStorageSpace(); }}>+ Storage Space</button>
        <button type="button" onClick=${function () { app.openExportModal('inventory'); }}>Export as Markdown</button>
      </div>
      <div class="tree">
        ${!topLevel.length ? html`<p class="hint">No storage spaces created yet.</p>` : null}
        ${topLevel.map(function (loc) { return html`<${LocationNode} loc=${loc} key=${loc.id} />`; })}
      </div>
    </section>
  `;
}
