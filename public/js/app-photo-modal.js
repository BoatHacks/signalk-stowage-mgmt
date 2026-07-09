import { h, html, useState, useRef, useEffect } from '../vendor/preact-htm-standalone.js';
import { useApp, PHOTO_VIEWPORT_SIZE, PHOTO_OUTPUT_SIZE } from './app-core.js';

export function PhotoModal() {
  var app = useApp();
  var item = app.photoModalItem;
  var imgRef = useRef(null);
  var fileInputRef = useRef(null);

  var stageState = useState('empty'); // 'empty' | 'editing'
  var stage = stageState[0];
  var setStage = stageState[1];

  var cropState = useState(null); // { naturalWidth, naturalHeight, baseScale, zoomPercent, offsetX, offsetY }
  var crop = cropState[0];
  var setCrop = cropState[1];

  var dragRef = useRef(null); // { startX, startY, startOffsetX, startOffsetY } while panning

  useEffect(function () {
    setStage('empty');
    setCrop(null);
  }, [item && item.id]);

  if (!item) return null;

  function scaleFor(c) { return c.baseScale * (c.zoomPercent / 100); }

  function clamp(c) {
    var scale = scaleFor(c);
    var scaledW = c.naturalWidth * scale;
    var scaledH = c.naturalHeight * scale;
    var minX = Math.min(0, PHOTO_VIEWPORT_SIZE - scaledW);
    var minY = Math.min(0, PHOTO_VIEWPORT_SIZE - scaledH);
    return Object.assign({}, c, {
      offsetX: Math.max(minX, Math.min(0, c.offsetX)),
      offsetY: Math.max(minY, Math.min(0, c.offsetY))
    });
  }

  function handleFile(file) {
    if (!file || file.type.indexOf('image/') !== 0) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var baseScale = PHOTO_VIEWPORT_SIZE / Math.min(img.naturalWidth, img.naturalHeight);
        var scaledW = img.naturalWidth * baseScale;
        var scaledH = img.naturalHeight * baseScale;
        setCrop({
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          baseScale: baseScale,
          zoomPercent: 100,
          offsetX: (PHOTO_VIEWPORT_SIZE - scaledW) / 2,
          offsetY: (PHOTO_VIEWPORT_SIZE - scaledH) / 2
        });
        setStage('editing');
      };
      img.src = reader.result;
      if (imgRef.current) imgRef.current.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function onPointerDown(e) {
    if (!crop) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startOffsetX: crop.offsetX, startOffsetY: crop.offsetY };
  }

  useEffect(function () {
    function onMove(e) {
      if (!dragRef.current || !crop) return;
      var next = Object.assign({}, crop, {
        offsetX: dragRef.current.startOffsetX + (e.clientX - dragRef.current.startX),
        offsetY: dragRef.current.startOffsetY + (e.clientY - dragRef.current.startY)
      });
      setCrop(clamp(next));
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return function () {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [crop]);

  function onZoom(e) {
    if (!crop) return;
    setCrop(clamp(Object.assign({}, crop, { zoomPercent: parseInt(e.target.value, 10) })));
  }

  function save() {
    if (!crop || !imgRef.current) return;
    var canvas = document.createElement('canvas');
    canvas.width = PHOTO_OUTPUT_SIZE;
    canvas.height = PHOTO_OUTPUT_SIZE;
    var ctx = canvas.getContext('2d');
    var scale = scaleFor(crop);
    var srcX = -crop.offsetX / scale;
    var srcY = -crop.offsetY / scale;
    var srcSize = PHOTO_VIEWPORT_SIZE / scale;
    ctx.drawImage(imgRef.current, srcX, srcY, srcSize, srcSize, 0, 0, PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE);
    var dataUri = canvas.toDataURL('image/jpeg', 0.85);
    app.setThumbnail(item.id, dataUri).then(app.closePhotoModal).catch(app.showToast);
  }

  function remove() {
    app.setThumbnail(item.id, null).then(app.closePhotoModal).catch(app.showToast);
  }

  var imgStyle = '';
  if (crop) {
    var scale = scaleFor(crop);
    imgStyle = 'width:' + (crop.naturalWidth * scale) + 'px;height:' + (crop.naturalHeight * scale) + 'px;' +
      'left:' + crop.offsetX + 'px;top:' + crop.offsetY + 'px;';
  }

  return html`
    <div class="modal-overlay" onClick=${function (e) { if (e.target === e.currentTarget) app.closePhotoModal(); }}>
      <div class="modal">
        <div class="modal-header">
          <h2>Photo for "${item.name}"</h2>
          <button class="modal-close" aria-label="Close" onClick=${app.closePhotoModal}>×</button>
        </div>

        ${stage === 'empty' ? html`
          <div>
            <p class="hint">Upload a photo, then drag to reposition and use the slider to zoom into a square thumbnail.</p>
            <label class="upload-btn">
              Choose Photo
              <input ref=${fileInputRef} type="file" accept="image/*" hidden
                     onChange=${function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
            </label>
          </div>
        ` : html`
          <div>
            <div class="photo-crop-viewport" onMouseDown=${onPointerDown}>
              <img ref=${imgRef} style=${imgStyle} />
            </div>
            <input type="range" min="100" max="400" value=${crop ? crop.zoomPercent : 100}
                   style="width:100%;margin-top:10px;" onInput=${onZoom} />
            <div class="modal-footer photo-modal-footer">
              <button type="button" onClick=${function () { fileInputRef.current && fileInputRef.current.click(); }}>Choose Different Photo</button>
              <input ref=${fileInputRef} type="file" accept="image/*" hidden
                     onChange=${function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              <button type="button" class="primary-btn" onClick=${save}>Save Thumbnail</button>
            </div>
          </div>
        `}

        <div class="modal-footer">
          ${item.thumbnail ? html`<button type="button" id="photo-modal-remove" onClick=${remove}>Remove Photo</button>` : null}
        </div>
      </div>
    </div>
  `;
}
