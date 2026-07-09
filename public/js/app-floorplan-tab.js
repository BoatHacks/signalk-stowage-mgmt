import { html, useState, useEffect, useRef } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { FloorplanSvg, fitFloorplanSvgIn } from './app-floorplan-modals.js';
import { LocationNode } from './app-nodes.js';

export function FloorplanTab() {
  var app = useApp();
  var summary = app.data.floorplans.length ? app.data.floorplans[0] : null;

  var contentState = useState(null); // full floorplan { id, name, svg_content } or null
  var content = contentState[0], setContent = contentState[1];
  var contentsPanelState = useState(null); // storage space object, or null
  var contentsPanel = contentsPanelState[0], setContentsPanel = contentsPanelState[1];
  var hintState = useState('');
  var hint = hintState[0], setHint = hintState[1];
  var containerRef = useRef(null);
  var fileInputRef = useRef(null);

  useEffect(function () {
    if (!summary) { setContent(null); return; }
    var cancelled = false;
    app.getFloorplan(summary.id).then(function (fp) { if (!cancelled) setContent(fp); });
    return function () { cancelled = true; };
  }, [summary ? summary.id : null]);

  // Blink the target area (and keep the item chip popup up) whenever a
  // locate request comes in, once the floorplan content is actually loaded.
  useEffect(function () {
    if (!app.locateTarget || !content || app.locateTarget.floorplanId !== content.id) return;
    var el = containerRef.current && containerRef.current.querySelector('#' + CSS.escape(app.locateTarget.svgElementId));
    if (!el) return;
    el.classList.add('inv-blinking');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var timer = setTimeout(function () { el.classList.remove('inv-blinking'); }, 6000);
    return function () { clearTimeout(timer); el.classList.remove('inv-blinking'); };
  }, [app.locateTarget, content]);

  useEffect(function () {
    function onResize() { if (containerRef.current) fitFloorplanSvgIn(containerRef.current); }
    window.addEventListener('resize', onResize);
    return function () { window.removeEventListener('resize', onResize); };
  }, []);

  var floorplanId = content ? content.id : null;
  var mappedIds = app.data.locations
    .filter(function (l) { return l.type === 'storage_space' && l.floorplan_id === floorplanId; })
    .map(function (l) { return l.svg_element_id; });

  function onAreaClick(elementId) {
    if (app.floorplanMode === 'edit') {
      app.openLocationAssignModal(elementId);
    } else {
      var space = app.data.locations.find(function (l) {
        return l.type === 'storage_space' && l.floorplan_id === floorplanId && l.svg_element_id === elementId;
      });
      setContentsPanel(space || { __unmapped: true });
    }
  }

  function handleDrop(elementId, e) {
    var dragType = e.dataTransfer.getData('application/x-drag-type');
    var draggedId = e.dataTransfer.getData('text/plain');
    if (dragType !== 'item' || !draggedId) return;
    var space = app.data.locations.find(function (l) {
      return l.type === 'storage_space' && l.floorplan_id === floorplanId && l.svg_element_id === elementId;
    });
    if (!space) { app.showToast('This area is not assigned to a storage space yet.'); return; }
    app.moveItemTo(draggedId, space.id).then(function () {
      app.showToast('Stored in "' + space.name + '".');
    }).catch(function () {});
  }

  function onSvgReady(count) {
    if (count === 0) {
      setHint(
        'No assignable areas found. Shapes with an auto-generated ID from your SVG editor ' +
        '(e.g. "path10340") are ignored \u2014 give the shapes you want to use as storage areas a ' +
        'custom ID (e.g. in Inkscape\u2019s Object Properties panel) and re-upload.'
      );
      return;
    }
    setHint(app.floorplanMode === 'edit'
      ? count + ' assignable area(s) found. Light blue areas have no storage space assigned yet \u2014 click an area to assign it.'
      : count + " assignable area(s) found. Click an area to see what's stored there.");
  }

  function uploadFile(file) {
    file.text().then(function (text) {
      if (text.indexOf('<svg') === -1) { app.showToast('This is not a valid SVG file.'); return; }

      var affectedSpaces = app.data.locations.filter(function (l) {
        return l.type === 'storage_space' && l.floorplan_id && app.data.floorplans.some(function (fp) { return fp.id === l.floorplan_id; });
      });

      var proceed = Promise.resolve();
      if (affectedSpaces.length) {
        var names = affectedSpaces.map(function (s) { return s.name; }).join(', ');
        var confirmed = confirm(
          'Uploading a new floorplan will remove the area assignment for ' + affectedSpaces.length +
          ' storage space(s): ' + names + ". This can't be undone. Continue?"
        );
        if (!confirmed) return;
        proceed = affectedSpaces.reduce(function (p, space) {
          return p.then(function () { return app.setSvgMapping(space.id, null, null); });
        }, Promise.resolve());
      }

      proceed
        .then(function () {
          return app.data.floorplans.reduce(function (p, fp) {
            return p.then(function () { return app.deleteFloorplan(fp.id); });
          }, Promise.resolve());
        })
        .then(function () {
          return app.uploadFloorplan(file.name.replace(/\.svg$/i, ''), text);
        })
        .then(function () { app.refreshData(); })
        .catch(function () {});
    });
  }

  return html`
    <section class="tab-panel active">
      <div class="toolbar">
        <span class="floorplan-name-label">${summary ? summary.name + ' (uploaded ' + new Date(summary.uploaded_at).toLocaleString() + ')' : 'No floorplan uploaded yet.'}</span>
        <label class="upload-btn">
          Upload SVG
          <input ref=${fileInputRef} type="file" accept=".svg,image/svg+xml" hidden
                 onChange=${function (e) { if (e.target.files[0]) uploadFile(e.target.files[0]); e.target.value = ''; }} />
        </label>
        <button type="button" onClick=${function () { app.setFloorplanMode(app.floorplanMode === 'edit' ? 'display' : 'edit'); }}>
          ${app.floorplanMode === 'edit' ? 'Save' : 'Edit'}
        </button>
        <span class="hint">${hint}</span>
      </div>

      ${content ? html`
        <div ref=${containerRef}>
          <${FloorplanSvg} svgContent=${content.svg_content} mappedIds=${mappedIds}
                           unmappedHighlight=${app.floorplanMode === 'edit'}
                           onAreaClick=${onAreaClick} onAreaDrop=${handleDrop} onReady=${onSvgReady} fit=${true} />
        </div>
      ` : html`<div class="floorplan-container"><p class="hint">No floorplan uploaded yet. Use "Upload SVG" above to add one.</p></div>`}
    </section>

    ${contentsPanel ? html`
      <div class="orphaned-panel floorplan-contents-panel">
        <button class="modal-close floorplan-contents-close" aria-label="Close" onClick=${function () { setContentsPanel(null); }}>×</button>
        ${contentsPanel.__unmapped ? html`
          <div class="orphaned-panel-title">No Storage Space</div>
          <p class="hint">This area is not assigned to a storage space yet.</p>
        ` : html`
          <div class="orphaned-panel-title">${contentsPanel.name}</div>
          <${LocationNode} loc=${contentsPanel} />
        `}
      </div>
    ` : null}
  `;
}
