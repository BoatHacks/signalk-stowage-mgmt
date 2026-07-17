import { html, useRef } from '../vendor/preact-htm-standalone.js';
import { useApp, IconBtn } from './app-core.js';
import { LocationNode } from './app-nodes.js';
import { childLocations } from './helpers.js';

export function InventoryTab() {
  var app = useApp();
  var topLevel = childLocations(app.data, null).filter(function (l) { return l.type === 'storage_space'; });
  var importFileRef = useRef(null);

  function handleImportFile (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;
    file.text().then(function (text) {
      var payload;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        app.showToast('That file is not valid JSON.');
        return;
      }
      var itemCount = Array.isArray(payload.items) ? payload.items.length : 0;
      var locationCount = Array.isArray(payload.locations) ? payload.locations.length : 0;
      var warning = 'Importing will DELETE all current items, storage spaces, containers, and ' +
        'categories, replacing them with this file\u2019s contents (' + itemCount + ' items, ' +
        locationCount + ' locations). Floorplans and attachment files are not affected. ' +
        'This can\u2019t be undone \u2014 consider exporting a fresh backup first if you haven\u2019t already. Continue?';
      if (!confirm(warning)) return;
      app.importSnapshot(payload).catch(function () {});
    });
  }

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <${IconBtn} icon="add-cabinet" title="Add storage space" onClick=${function () { app.addStorageSpace(); }} />
        <button type="button" onClick=${function () { app.openExportModal('inventory'); }}>Export as Markdown</button>
        <button type="button" onClick=${function () { app.exportSnapshot().catch(function () {}); }}>Export to JSON</button>
        <button type="button" onClick=${function () { importFileRef.current && importFileRef.current.click(); }}>Import from JSON</button>
        <input ref=${importFileRef} type="file" accept="application/json,.json" hidden onChange=${handleImportFile} />
        <button type="button" onClick=${app.toggleCollapseAllTopLevel}>
          ${app.allTopLevelCollapsed() ? 'Expand All' : 'Collapse All'}
        </button>
      </div>
      <div class="tree">
        ${!topLevel.length ? html`<p class="hint">No storage spaces created yet.</p>` : null}
        ${topLevel.map(function (loc) { return html`<${LocationNode} loc=${loc} topLevel=${true} key=${loc.id} />`; })}
      </div>
    </section>
  `;
}
