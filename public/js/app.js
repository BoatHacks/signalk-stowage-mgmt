import { html, render, useState, useEffect, useRef, useCallback } from '../vendor/preact-htm-standalone.js';
import { api } from './api.js';
import { AppCtx, Toast, POLL_INTERVAL_MS } from './app-core.js';
import { SearchBox, LocateItemPopup, ThemeToggle, EditModeToggle } from './app-search.js';
import { NotStoredPanel, SplitDropPanel } from './app-nodes.js';
import { InventoryTab } from './app-inventory-tab.js';
import { FloorplanTab } from './app-floorplan-tab.js';
import { CategoriesTab } from './app-categories-tab.js';
import { OverviewTab } from './app-overview-tab.js';
import { StockAlertsTab } from './app-stock-alerts-tab.js';
import { StoreLogTab, buildStoreLogMarkdown } from './app-storelog-tab.js';
import { ItemPropertiesModal, CategoryModal, ExportModal } from './app-item-modals.js';
import { PhotoModal } from './app-photo-modal.js';
import { LocationAssignModal, MoveModal } from './app-floorplan-modals.js';
import { SplitModal } from './app-split-modal.js';
import { buildInventoryMarkdown, buildShoppingListMarkdown, childLocations } from './helpers.js';
import { getPreferredTheme, applyTheme } from './theme.js';

var TABS = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'floorplan', label: 'Floorplan' },
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'Categories' },
  { id: 'stock-alerts', label: 'Stock Alerts' },
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
  var configState = useState({ autoTheme: false, themeRecommendation: null });
  var config = configState[0], setConfig = configState[1];
  var toastState = useState(null);
  var toastMessage = toastState[0], setToastMessage = toastState[1];
  var dragActiveState = useState(false);
  var dragActive = dragActiveState[0], setDragActive = dragActiveState[1];
  var dragEntityTypeState = useState(null);
  var dragEntityType = dragEntityTypeState[0], setDragEntityType = dragEntityTypeState[1];
  var editModeState = useState(false);
  var editMode = editModeState[0], setEditMode = editModeState[1];
  var expandedChipKeyState = useState(null);
  var expandedChipKey = expandedChipKeyState[0], setExpandedChipKey = expandedChipKeyState[1];
  var collapsedLocationIdsState = useState(function () { return new Set(); });
  var collapsedLocationIds = collapsedLocationIdsState[0], setCollapsedLocationIds = collapsedLocationIdsState[1];
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

  // When the plugin's "Automatically switch theme" option is on, follow
  // its recommendation (derived server-side from environment.sun/mode)
  // instead of waiting for a manual toggle. Only acts when the
  // recommendation actually differs from the current theme, so this
  // doesn't fight a fresh manual click mid-poll-cycle for no reason — and
  // does nothing at all if the option is off or the server has no
  // recommendation yet (e.g. neither environment path is populated).
  useEffect(function () {
    if (!config.autoTheme) return;
    var recommendation = config.themeRecommendation;
    if ((recommendation === 'light' || recommendation === 'dark') && recommendation !== theme) {
      setThemeState(recommendation);
    }
  }, [config.autoTheme, config.themeRecommendation]);

  var refreshData = useCallback(function () {
    if (fetchInFlightRef.current) return Promise.resolve();
    fetchInFlightRef.current = true;
    return Promise.all([
      api.listLocations(), api.listItems(), api.listCategories(), api.listFloorplans(),
      api.getConfig().catch(function () { return { autoTheme: false, themeRecommendation: null }; })
    ])
      .then(function (results) {
        setData({ locations: results[0], items: results[1], categories: results[2], floorplans: results[3] });
        setConfig(results[4]);
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
    editMode: editMode,
    toggleEditMode: function () { setEditMode(!editMode); setExpandedChipKey(null); },
    expandedChipKey: expandedChipKey,
    toggleExpandedChip: function (key) { setExpandedChipKey(expandedChipKey === key ? null : key); },
    collapsedLocationIds: collapsedLocationIds,
    toggleLocationCollapse: function (id) {
      setCollapsedLocationIds(function (prev) {
        var next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    },
    // "Collapse/Expand All" in the tabs nav: if any top-level storage space
    // is currently expanded, collapse them all; otherwise expand them all.
    toggleCollapseAllTopLevel: function () {
      var topLevelIds = childLocations(data, null)
        .filter(function (l) { return l.type === 'storage_space'; })
        .map(function (l) { return l.id; });
      var anyExpanded = topLevelIds.some(function (id) { return !collapsedLocationIds.has(id); });
      setCollapsedLocationIds(anyExpanded ? new Set(topLevelIds) : new Set());
    },
    allTopLevelCollapsed: function () {
      var topLevelIds = childLocations(data, null)
        .filter(function (l) { return l.type === 'storage_space'; })
        .map(function (l) { return l.id; });
      return topLevelIds.length > 0 && topLevelIds.every(function (id) { return collapsedLocationIds.has(id); });
    },
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
      else if (kind === 'storelog-individual' || kind === 'storelog-aggregate' || kind === 'storelog-target' || kind === 'storelog-splits' || kind === 'storelog-predictions') {
        text = buildStoreLogMarkdown(kind, payload);
      } else text = buildInventoryMarkdown(data);
      exportModalContentState[1](text);
    },
    closeExportModal: function () { exportModalContentState[1](null); },

    getItemLog: function (start, end) { return api.getItemLog(start, end); },

    // backup / restore
    exportSnapshot: function () {
      return api.exportSnapshot().then(function (snapshot) {
        var blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = 'stowage-export-' + stamp + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }).catch(function (err) { showToast(err.message); });
    },
    importSnapshot: function (payload) {
      return act(function () { return api.importSnapshot(payload); }).then(function (result) {
        var message = 'Restored ' + result.restored.items + ' items, ' + result.restored.locations +
          ' locations, ' + result.restored.categories + ' categories.';
        if (result.dropped_floorplan_mappings) {
          message += ' ' + result.dropped_floorplan_mappings + ' floorplan mapping(s) could not be restored ' +
            "(that floorplan isn't present here).";
        }
        showToast(message);
        return result;
      });
    },

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
  else if (activeTab === 'stock-alerts') activeTabView = html`<${StockAlertsTab} />`;
  else if (activeTab === 'storelog') activeTabView = html`<${StoreLogTab} />`;

  return html`
    <${AppCtx.Provider} value=${ctx}>
      <header>
        <h1><img class="header-icon" src="assets/icons/icon-512.png" alt="Stowage Management" /><span class="header-title-text">Stowage Management</span></h1>
        <${SearchBox} />
        <${EditModeToggle} />
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
