import { html, useState, useEffect } from '../vendor/preact-htm-standalone.js';
import { useApp } from './app-core.js';
import { renderMarkdown } from './markdown.js';
import { isSplit } from './helpers.js';

// ---------- item properties modal ----------

export function ItemPropertiesModal() {
  var app = useApp();
  var item = app.propertiesModalItem;

  var nameState = useState('');
  var actualState = useState(0);
  var targetState = useState('');
  var notesState = useState('');
  var changeNoteState = useState('');
  var noteViewState = useState('show'); // 'show' | 'edit'

  useEffect(function () {
    if (!item) return;
    nameState[1](item.name);
    actualState[1](item.actual_quantity);
    targetState[1](item.target_quantity === null || item.target_quantity === undefined ? '' : String(item.target_quantity));
    notesState[1](item.notes || '');
    changeNoteState[1]('');
    noteViewState[1]('show');
  }, [item && item.id]);

  if (!item) return null;

  var name = nameState[0], setName = nameState[1];
  var actualQty = actualState[0], setActualQty = actualState[1];
  var targetQty = targetState[0], setTargetQty = targetState[1];
  var notes = notesState[0], setNotes = notesState[1];
  var changeNote = changeNoteState[0], setChangeNote = changeNoteState[1];
  var noteView = noteViewState[0], setNoteView = noteViewState[1];

  function save() {
    var trimmedName = (name || '').trim();
    if (!trimmedName) return app.showToast('Name is required.');
    var body = {
      name: trimmedName,
      target_quantity: targetQty === '' ? null : Math.max(0, parseInt(targetQty, 10) || 0),
      notes: notes || null,
      note: changeNote || null
    };
    if (!isSplit(item)) body.actual_quantity = Math.max(0, parseInt(actualQty, 10) || 0);
    app.updateItem(item.id, body).then(app.closePropertiesModal).catch(function () {});
  }

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closePropertiesModal(); }}>
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Properties for "${item.name}"</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closePropertiesModal}>×</button>
        </div>

        <div class="form-field">
          <label>Name</label>
          <input type="text" value=${name} onInput=${function (e) { setName(e.target.value); }} />
        </div>

        <div class="properties-quick-actions">
          <button type="button" onClick=${function () { app.openPhotoModal(item); }}>Add Photo</button>
          <button type="button" onClick=${function () { app.openCategoryModal(item); }}>+ Category</button>
        </div>

        <div class="form-field-row">
          <div class="form-field">
            <label>Actual Quantity</label>
            ${isSplit(item) ? html`
              <input type="text" readonly value=${'\u00d7' + item.actual_quantity + ' (split across ' + item.placements.length + ' locations)'} />
              <span class="hint">Split items' quantity can only be changed via the Split dialog.
                <button type="button" class="link-btn" onClick=${function () { app.closePropertiesModal(); app.openSplitModal(item, item.placements[0].location_id); }}>Open Split dialog</button>
              </span>
            ` : html`
              <input type="number" min="0" step="1" value=${actualQty} onInput=${function (e) { setActualQty(e.target.value); }} />
            `}
          </div>
          <div class="form-field">
            <label>Target Quantity</label>
            <input type="number" min="0" step="1" placeholder="none" value=${targetQty} onInput=${function (e) { setTargetQty(e.target.value); }} />
          </div>
        </div>

        <div class="form-field">
          <label>Reason for quantity change <span class="hint">(optional, shown in the Store Log)</span></label>
          <input type="text" placeholder="e.g. used some for repairs, restocked at the chandlery\u2026" value=${changeNote}
                 onInput=${function (e) { setChangeNote(e.target.value); }} />
        </div>

        <div class="form-field">
          <label>Notes</label>
          <div class="notes-editor-tabs">
            <button type="button" class=${'notes-editor-tab' + (noteView === 'show' ? ' active' : '')} onClick=${function () { setNoteView('show'); }}>Show</button>
            <button type="button" class=${'notes-editor-tab' + (noteView === 'edit' ? ' active' : '')} onClick=${function () { setNoteView('edit'); }}>Edit</button>
          </div>
          ${noteView === 'edit' ? html`
            <textarea class="notes-textarea" placeholder="Markdown supported: **bold**, _italic_, # headings, - lists, \`code\`, [links](url)…"
                      value=${notes} onInput=${function (e) { setNotes(e.target.value); }}></textarea>
            <div class="notes-preview-label">Preview</div>
          ` : null}
          <div class="notes-preview" dangerouslySetInnerHTML=${{ __html: renderMarkdown(notes) }}></div>
        </div>

        <div class="modal-footer">
          <button type="button" class="primary-btn" onClick=${save}>Save</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- category assignment modal ----------

export function CategoryModal() {
  var app = useApp();
  var item = app.categoryModalItem;
  var newNameState = useState('');
  var newName = newNameState[0], setNewName = newNameState[1];

  useEffect(function () { setNewName(''); }, [item ? item.id : null]);

  if (!item) return null;
  var liveItem = app.data.items.find(function (i) { return i.id === item.id; }) || item;
  var assignedIds = {};
  (liveItem.categories || []).forEach(function (c) { assignedIds[c.id] = true; });

  function createCategory() {
    var name = newName.trim();
    if (!name) return;
    app.createCategory(name).then(function () { setNewName(''); }).catch(function () {});
  }

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closeCategoryModal(); }}>
      <div class="modal">
        <div class="modal-header">
          <h2>Categories for "${liveItem.name}"</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closeCategoryModal}>×</button>
        </div>
        <p class="hint">Click a category to assign or remove it.</p>
        <div class="category-chip-list">
          ${!app.data.categories.length ? html`<span class="category-chip-empty">No categories exist yet. Create one below.</span>` : null}
          ${app.data.categories.map(function (cat) {
            var isAssigned = !!assignedIds[cat.id];
            return html`
              <button type="button" key=${cat.id} class=${'category-chip' + (isAssigned ? ' assigned' : '')}
                      onClick=${function () {
                        var action = isAssigned ? app.removeItemCategory(item.id, cat.id) : app.addItemCategory(item.id, cat.id);
                        action.catch(function () {});
                      }}>${cat.name}</button>
            `;
          })}
        </div>
        <div class="modal-footer">
          <input type="text" placeholder="New category name" value=${newName}
                 onInput=${function (e) { setNewName(e.target.value); }}
                 onKeyDown=${function (e) { if (e.key === 'Enter') createCategory(); }} />
          <button type="button" onClick=${createCategory}>+ New Category</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- export as markdown modal ----------

export function ExportModal() {
  var app = useApp();
  if (!app.exportModalContent) return null;

  function copy() {
    var text = app.exportModalContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { app.showToast('Copied to clipboard.'); }).catch(function () {
        app.showToast('Could not copy automatically — please select and copy manually.');
      });
    } else {
      app.showToast('Clipboard API not available — please select and copy manually.');
    }
  }

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closeExportModal(); }}>
      <div class="modal modal-wide">
        <div class="modal-header">
          <h2>Export as Markdown</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closeExportModal}>×</button>
        </div>
        <p class="hint">Select all and copy, or use the button below.</p>
        <textarea class="notes-textarea export-textarea" readonly value=${app.exportModalContent}></textarea>
        <div class="modal-footer">
          <button type="button" class="primary-btn" onClick=${copy}>Copy to Clipboard</button>
        </div>
      </div>
    </div>
  `;
}
