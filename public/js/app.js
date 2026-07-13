import { html, render, useState, useEffect, useRef, useCallback } from '../vendor/preact-htm-standalone.js';
import { api } from './api.js';
import { AppCtx, Toast, POLL_INTERVAL_MS } from './app-core.js';
import { SearchBox, LocateItemPopup, ThemeToggle } from './app-search.js';
import { NotStoredPanel, SplitDropPanel } from './app-nodes.js';
import { InventoryTab } from './app-inventory-tab.js';
import { FloorplanTab } from './app-floorplan-tab.js';
import { CategoriesTab } from './app-categories-tab.js';
import { OverviewTab } from './app-overview-tab.js';
import { UnderstockedTab } from './app-understocked-tab.js';
import { ExpiringTab, buildExpiringMarkdown } from './app-expiring-tab.js';
import { StoreLogTab, buildStoreLogMarkdown } from './app-storelog-tab.js';
import { ItemPropertiesModal, CategoryModal, ExportModal } from './app-item-modals.js';
import { PhotoModal } from './app-photo-modal.js';
import { LocationAssignModal, MoveModal } from './app-floorplan-modals.js';
import { SplitModal } from './app-split-modal.js';
import { buildInventoryMarkdown, buildShoppingListMarkdown } from './helpers.js';
import { getPreferredTheme, applyTheme } from './theme.js';

// Sourced from the <meta name="version"> tag in index.html, which is kept
// in sync manually with package.json's "version" field (no build step here
// to inject it automatically) — this way there's only one place to update.
var versionMeta = document.querySelector('meta[name="version"]');
var APP_VERSION = (versionMeta && versionMeta.content) || '0.0.0';

var TABS = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'floorplan', label: 'Floorplan' },
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'Categories' },
  { id: 'understocked', label: 'Understocked' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'storelog', label: 'Store Log' }
];

var EMPTY_DATA = { locations: [], items: [], categories: [], floorplans: [] };

function App() {
  var dataState = useState(EMPTY_DATA);
  var data = dataState[0], setData = dataState[1];
  var loadedState = useState(false);
  var loaded = loadedState[0], setLoaded = loadedState[1];
  var tabState = useState('inventory');
  var activeTab = tabState[0], setActiveTab = tabState[1];
  var themeState = useState(getPreferredTheme());
  var theme = themeState[0], setThemeState = themeState[1];
  var toastState = useState(null);
  var toastMessage = toastState[0], setToastMessage = toastState[1];
  var dragActiveState = useState(false);
  var dragActive = dragActiveState[0], setDragActive = dragActiveState[1];
  var dragEntityTypeState = useState(null);
  var dragEntityType = dragEntityTypeState[0], setDragEntityType = dragEntityTypeState[1];
  var floorplanModeState = useState('display');
  var floorplanMode = floorplanModeState[0], setFloorplanModeState = floorplanModeState[1];

  var propertiesModalItemState = useState(null);
  var attachmentsState = useState([]);
  var attachmentsLoadingState = useState(false);
  var photoModalItemState = useState(null);
  var categoryModalItemState = useState(null);
  var moveModalState = useState(null);
  var splitModalState = useState(null);
  var locationAssignSvgElementIdState = useState(null);
  var exportModalContentState = useState(null);
  var locateTargetState = useState(null);
  var locatePopupItemState = useState(null);

  var toastTimerRef = useRef(null);
  var fetchInFlightRef = useRef(false);

  useEffect(function () { applyTheme(theme); }, [theme]);

  var refreshData = useCallback(function () {
    if (fetchInFlightRef.current) return Promise.resolve();
    fetchInFlightRef.current = true;
    return Promise.all([api.listLocations(), api.listItems(), api.listCategories(), api.listFloorplans()])
      .then(function (results) {
        setData({ locations: results[0], items: results[1], categories: results[2], floorplans: results[3] });
        setLoaded(true);
      })
      .catch(function (err) { showToast(err.message); })
      .then(function () { fetchInFlightRef.current = false; });
  }, []);

  useEffect(function () {
    refreshData();
    var timer = setInterval(refreshData, POLL_INTERVAL_MS);
    return function () { clearInterval(timer); };
  }, [refreshData]);

  // Attachments are fetched separately from the main polled dataset (only
  // while the Item Properties modal is open for a given item), since they
  // can be numerous/large and there's no reason to carry them along on
  // every 5s refresh of the whole app.
  function loadAttachments (itemId) {
    attachmentsLoadingState[1](true);
    return api.listAttachments(itemId)
      .then(function (list) { attachmentsState[1](list); })
      .catch(function (err) { showToast(err.message); })
      .then(function () { attachmentsLoadingState[1](false); });
  }

  useEffect(function () {
    var item = propertiesModalItemState[0];
    if (!item) { attachmentsState[1]([]); return; }
    loadAttachments(item.id);
  }, [propertiesModalItemState[0] && propertiesModalItemState[0].id]);

  function showToast(message) {
    setToastMessage(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(function () { setToastMessage(null); }, 3000);
  }

  // ---- generic action wrappers: call the API, then refresh, surfacing errors as toasts ----
  function act(promiseFn) {
    return promiseFn().then(function (result) { return refreshData().then(function () { return result; }); })
      .catch(function (err) { showToast(err.message); throw err; });
  }

  var ctx = {
    data: data,
    loaded: loaded,
    activeTab: activeTab,
    theme: theme,
    dragActive: dragActive,
    floorplanMode: floorplanMode,
    toastMessage: toastMessage,
    showToast: showToast,
    setDragActive: setDragActive,
    dragEntityType: dragEntityType,
    setDragEntityType: setDragEntityType,
    setTheme: setThemeState,
    setFloorplanMode: setFloorplanModeState,
    refreshData: refreshData,

    // locations
    addStorageSpace: function (parentId) {
      var name = prompt('Name of the new storage space (e.g. "Lazarette"):');
      if (!name) return;
      act(function () { return api.createLocation({ name: name, type: 'storage_space', parent_id: parentId || null }); });
    },
    addContainer: function (parentId) {
      var name = prompt('Name of the new container (e.g. "First Aid Box"):');
      if (!name) return;
      act(function () { return api.createLocation({ name: name, type: 'container', parent_id: parentId }); });
    },
    createLocation: function (body) { return act(function () { return api.createLocation(body); }); },
    renameLocation: function (loc) {
      var name = prompt('New name:', loc.name);
      if (!name || name === loc.name) return;
      act(function () { return api.renameLocation(loc.id, name); });
    },
    setManualSvgId: function (loc) {
      var current = loc.svg_element_id || '';
      var answer = prompt(
        'SVG element id for "' + loc.name + '" (from the floorplan\u2019s SVG source). ' +
        'Useful for areas that overlap another one on the map and can\u2019t be clicked directly. ' +
        'Leave blank to remove the mapping.',
        current
      );
      if (answer === null) return;
      var trimmed = answer.trim();
      if (trimmed === current) return;
      var floorplanId = trimmed ? (data.floorplans.length ? data.floorplans[0].id : null) : null;
      if (trimmed && !floorplanId) return showToast('Upload a floorplan first.');
      act(function () { return api.setSvgMapping(loc.id, floorplanId, trimmed || null); });
    },
    deleteLocation: function (loc) {
      if (!confirm('Really delete "' + loc.name + '"?')) return;
      act(function () { return api.deleteLocation(loc.id); });
    },
    moveContainer: function (id, parentId) { return act(function () { return api.moveLocation(id, parentId); }); },
    setSvgMapping: function (id, floorplanId, svgElementId) { return act(function () { return api.setSvgMapping(id, floorplanId, svgElementId); }); },

    // items
    addItem: function (locationId) {
      var name = prompt('Item Name:');
      if (!name) return;
      var qtyRaw = prompt('Actual Quantity:', '1');
      var actualQuantity = parseInt(qtyRaw, 10) || 1;
      act(function () { return api.createItem({ name: name, actual_quantity: actualQuantity, location_id: locationId }); });
    },
    updateItem: function (id, body) { return act(function () { return api.updateItem(id, body); }); },
    setThumbnail: function (id, thumbnail) { return act(function () { return api.setThumbnail(id, thumbnail); }); },
    moveItemTo: function (id, locationId) { return act(function () { return api.moveItem(id, locationId); }); },
    movePlacementTo: function (itemId, placementId, locationId) { return act(function () { return api.movePlacement(itemId, placementId, locationId); }); },
    setPlacementQuantity: function (itemId, placementId, quantity, note) { return act(function () { return api.setPlacementQuantity(itemId, placementId, quantity, note); }); },
    splitItem: function (itemId, body) { return act(function () { return api.splitItem(itemId, body); }); },
    addItemCategory: function (id, categoryId) { return act(function () { return api.addItemCategory(id, categoryId); }); },
    removeItemCategory: function (id, categoryId) { return act(function () { return api.removeItemCategory(id, categoryId); }); },
    deleteItem: function (item, skipConfirm) {
      if (!skipConfirm && !confirm('Really delete "' + item.name + '"?')) return;
      act(function () { return api.deleteItem(item.id); });
    },

    // categories
    createCategory: function (name) { return act(function () { return api.createCategory(name); }); },
    renameCategory: function (id, name) { return act(function () { return api.renameCategory(id, name); }); },
    deleteCategory: function (id) { return act(function () { return api.deleteCategory(id); }); },

    // floorplans
    getFloorplan: function (id) { return api.getFloorplan(id); },
    uploadFloorplan: function (name, svgContent) { return act(function () { return api.uploadFloorplan(name, svgContent); }); },
    deleteFloorplan: function (id) { return act(function () { return api.deleteFloorplan(id); }); },

    // attachments
    attachments: attachmentsState[0],
    attachmentsLoading: attachmentsLoadingState[0],
    uploadAttachment: function (itemId, file) {
      return api.uploadAttachment(itemId, file)
        .then(function () { return loadAttachments(itemId); })
        .catch(function (err) { showToast(err.message); throw err; });
    },
    deleteAttachment: function (itemId, attachmentId) {
      return api.deleteAttachment(itemId, attachmentId)
        .then(function () { return loadAttachments(itemId); })
        .catch(function (err) { showToast(err.message); throw err; });
    },
    attachmentUrl: function (itemId, attachmentId) { return api.attachmentUrl(itemId, attachmentId); },

    // modals
    propertiesModalItem: propertiesModalItemState[0],
    openPropertiesModal: function (item) { propertiesModalItemState[1](item); },
    closePropertiesModal: function () { propertiesModalItemState[1](null); },

    photoModalItem: photoModalItemState[0],
    openPhotoModal: function (item) { photoModalItemState[1](item); },
    closePhotoModal: function () { photoModalItemState[1](null); },

    categoryModalItem: categoryModalItemState[0],
    openCategoryModal: function (item) { categoryModalItemState[1](item); },
    closeCategoryModal: function () { categoryModalItemState[1](null); },

    moveModal: moveModalState[0],
    openMoveModal: function (type, entity) { moveModalState[1]({ type: type, entity: entity }); },
    closeMoveModal: function () { moveModalState[1](null); },

    splitModal: splitModalState[0],
    openSplitModal: function (item, fromLocationId) { splitModalState[1]({ item: item, fromLocationId: fromLocationId }); },
    closeSplitModal: function () { splitModalState[1](null); },

    locationAssignSvgElementId: locationAssignSvgElementIdState[0],
    openLocationAssignModal: function (svgElementId) { locationAssignSvgElementIdState[1](svgElementId); },
    closeLocationAssignModal: function () { locationAssignSvgElementIdState[1](null); },

    exportModalContent: exportModalContentState[0],
    openExportModal: function (kind, payload) {
      var text;
      if (kind === 'shopping') text = buildShoppingListMarkdown(data);
      else if (kind === 'expiring') text = buildExpiringMarkdown(data);
      else if (kind === 'storelog-individual' || kind === 'storelog-aggregate' || kind === 'storelog-target' || kind === 'storelog-splits' || kind === 'storelog-predictions') {
        text = buildStoreLogMarkdown(kind, payload);
      } else text = buildInventoryMarkdown(data);
      exportModalContentState[1](text);
    },
    closeExportModal: function () { exportModalContentState[1](null); },

    getItemLog: function (start, end) { return api.getItemLog(start, end); },

    // search / locate
    locateTarget: locateTargetState[0],
    locatePopupItem: locatePopupItemState[0],
    closeLocatePopup: function () { locatePopupItemState[1](null); locateTargetState[1](null); },
    locateItem: function (item) {
      api.locateItem(item.id).then(function (result) {
        setActiveTab('floorplan');
        var targets = result.split
          ? result.matches.map(function (m) { return { floorplanId: m.floorplan_id, svgElementId: m.svg_element_id }; })
          : [{ floorplanId: result.floorplan_id, svgElementId: result.svg_element_id }];
        locateTargetState[1](targets);
        locatePopupItemState[1](item);
      }).catch(function (err) { showToast('"' + item.name + '": ' + err.message); });
    }
  };

  function switchTab(id) {
    setActiveTab(id);
    if (id !== 'floorplan') { locatePopupItemState[1](null); locateTargetState[1](null); }
  }

  var activeTabView = null;
  if (activeTab === 'inventory') activeTabView = html`<${InventoryTab} />`;
  else if (activeTab === 'floorplan') activeTabView = html`<${FloorplanTab} />`;
  else if (activeTab === 'overview') activeTabView = html`<${OverviewTab} />`;
  else if (activeTab === 'categories') activeTabView = html`<${CategoriesTab} />`;
  else if (activeTab === 'understocked') activeTabView = html`<${UnderstockedTab} />`;
  else if (activeTab === 'expiring') activeTabView = html`<${ExpiringTab} />`;
  else if (activeTab === 'storelog') activeTabView = html`<${StoreLogTab} />`;

  return html`
    <${AppCtx.Provider} value=${ctx}>
      <header>
        <h1>Stowage Management</h1>
        <${SearchBox} />
        <span class="app-version">v${APP_VERSION}</span>
        <${ThemeToggle} />
      </header>

      <nav class="tabs">
        ${TABS.map(function (t) {
          return html`
            <button key=${t.id} class=${'tab-btn' + (activeTab === t.id ? ' active' : '')}
                    onClick=${function () { switchTab(t.id); }}>${t.label}</button>
          `;
        })}
      </nav>

      <main>
        ${!loaded ? html`<p class="hint">Loading…</p>` : activeTabView}
      </main>

      <${NotStoredPanel} />
      <${SplitDropPanel} />
      <${LocateItemPopup} />
      <${Toast} />

      <${ItemPropertiesModal} />
      <${PhotoModal} />
      <${CategoryModal} />
      <${LocationAssignModal} />
      <${MoveModal} />
      <${SplitModal} />
      <${ExportModal} />
    </${AppCtx.Provider}>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
