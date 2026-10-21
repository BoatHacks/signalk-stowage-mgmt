import { html, useState } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';

// Header control: which site the Inventory, Floorplan, Overview, Stock
// Alerts and Store Log tabs show ("All sites" removes the filter), plus a
// button for the site manager. The select is hidden while only one site
// exists, so single-site installs see no new UI beyond the small button.
export function SiteSwitcher() {
  var app = useApp();
  return html`
    <div class="site-switcher">
      ${app.sites.length > 1 ? html`
        <select class="site-select" aria-label="Site" value=${app.activeSite ? app.activeSite.id : ''}
                onChange=${function (e) { app.setActiveSiteId(e.target.value || null); }}>
          <option value="">All sites</option>
          ${app.sites.map(function (s) {
            return html`<option key=${s.id} value=${s.id}>${s.name}</option>`;
          })}
        </select>
      ` : null}
      <button type="button" class="site-manage-btn" onClick=${app.openSitesModal}>Sites</button>
    </div>
  `;
}

function SiteRow(props) {
  var app = useApp();
  var site = props.site;
  var nameState = useState(site.name);
  var name = nameState[0], setName = nameState[1];

  function commitName() {
    var trimmed = name.trim();
    if (!trimmed) { setName(site.name); return; }
    if (trimmed !== site.name) app.updateSite(site.id, { name: trimmed }).catch(function () { setName(site.name); });
  }

  return html`
    <div class="site-row">
      <input type="text" class="site-name-input" value=${name} aria-label="Site name"
             onInput=${function (e) { setName(e.target.value); }} onBlur=${commitName}
             onKeyDown=${function (e) { if (e.key === 'Enter') e.target.blur(); }} />
      <label class="site-vessel">
        <input type="radio" name="vessel-site" checked=${!!site.is_vessel}
               onChange=${function () { app.updateSite(site.id, { is_vessel: true }).catch(function () {}); }} />
        Vessel
      </label>
      <select aria-label="Default floorplan" value=${site.floorplan_id || ''}
              onChange=${function (e) { app.updateSite(site.id, { floorplan_id: e.target.value || null }).catch(function () {}); }}>
        <option value="">No default floorplan</option>
        ${app.allData.floorplans.map(function (fp) {
          return html`<option key=${fp.id} value=${fp.id}>${fp.name}</option>`;
        })}
      </select>
      <button type="button" disabled=${!!site.is_vessel}
              title=${site.is_vessel ? 'The vessel site cannot be deleted' : 'Delete site'}
              onClick=${function () {
                if (!confirm('Really delete the site "' + site.name + '"?')) return;
                app.deleteSite(site.id).catch(function () {});
              }}>Delete</button>
    </div>
  `;
}

export function SitesModal() {
  var app = useApp();
  var newNameState = useState('');
  var newName = newNameState[0], setNewName = newNameState[1];
  if (!app.sitesModalOpen) return null;

  function add() {
    var trimmed = newName.trim();
    if (!trimmed) return;
    app.createSite({ name: trimmed }).then(function () { setNewName(''); }).catch(function () {});
  }

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closeSitesModal(); }}>
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Sites</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closeSitesModal}>×</button>
        </div>
        <p class="hint">A site is a place that holds inventory, such as the boat or a shed. Only the vessel site publishes stock alerts to Signal K.
          A site's default floorplan is the one the Floorplan tab opens first.</p>
        <div class="site-list">
          ${app.sites.map(function (s) { return html`<${SiteRow} key=${s.id} site=${s} />`; })}
        </div>
        <div class="site-add-row">
          <input type="text" placeholder="New site, e.g. Shed" value=${newName}
                 onInput=${function (e) { setNewName(e.target.value); }}
                 onKeyDown=${function (e) { if (e.key === 'Enter') add(); }} />
          <button type="button" class="primary-btn" onClick=${add}>Add site</button>
        </div>
      </div>
    </div>
  `;
}
