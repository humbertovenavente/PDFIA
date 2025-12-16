/**
 * Document Editor - Combined PDF viewer with editable content extraction
 * This module handles the "Editor" tab functionality
 */

// Editor state
const editorState = {
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  scale: 1.5,
  baseScale: 0,
  pdfCanvas: null,
  overlayCanvas: null,
  annotationCanvas: null,
  pdfCtx: null,
  overlayCtx: null,
  annotationCtx: null,
  fabricCanvas: null, // Fabric.js canvas for annotations
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentSelection: null,
  jobId: null,
  fileUrl: null,
  rendering: false,
  contentBlocks: [], // Array of extracted content blocks
  blockIdCounter: 0,
  modifiedPdfBytes: null,
  modifiedPdfUrl: null,
  fileBytes: null,
  extractionMode: 'manual',
  autoScan: null,
  // Annotation state
  currentTool: 'select', // 'select', 'draw', 'highlight', 'strikethrough', 'text', 'arrow', 'eraser'
  annotationColor: '#ff0000',
  annotationSize: 4,
  annotations: {}, // Per-page annotations: { pageNum: [fabric JSON] }
  annotationHistory: {}, // For undo: { pageNum: [[state1], [state2], ...] }
  isAnnotating: false,
  currentPath: [] // Current drawing path
};

function setExtractionMode(mode) {
  if (mode !== 'manual' && mode !== 'auto') return;
  editorState.extractionMode = mode;
  if (mode === 'auto') {
    clearEditorSelection();
    const btnExtract = document.getElementById('btn-editor-extract');
    if (btnExtract) btnExtract.disabled = true;
  } else {
    // Clear auto overlay when returning to manual
    if (editorState.overlayCtx && editorState.overlayCanvas) {
      editorState.overlayCtx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
    }
  }
  updateExtractionModeUI();
  renderAutoScanPanel();
  redrawAutoRegionsOverlay();
}

function updateExtractionModeUI() {
  const btnModeManual = document.getElementById('btn-mode-manual');
  const btnModeAuto = document.getElementById('btn-mode-auto');
  const btnExtract = document.getElementById('btn-editor-extract');
  const btnAutoScan = document.getElementById('btn-auto-scan');
  const hint = document.getElementById('editor-hint');
  const autoPanel = document.getElementById('auto-scan-panel');

  if (btnModeManual) btnModeManual.classList.toggle('active', editorState.extractionMode === 'manual');
  if (btnModeAuto) btnModeAuto.classList.toggle('active', editorState.extractionMode === 'auto');

  if (btnExtract) btnExtract.classList.toggle('hidden', editorState.extractionMode !== 'manual');
  if (btnAutoScan) btnAutoScan.classList.toggle('hidden', editorState.extractionMode !== 'auto');
  if (autoPanel) autoPanel.classList.toggle('hidden', editorState.extractionMode !== 'auto');

  if (hint) {
    if (editorState.extractionMode === 'manual') {
      hint.innerHTML = '<i class="fas fa-info-circle"></i> Draw a rectangle to select a region';
    } else {
      hint.innerHTML = '<i class="fas fa-magic"></i> Auto mode: scan the full page and choose regions to edit';
    }
  }
}

function normalizePdfBytes(bytes) {
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) return bytes;
  if (bytes instanceof Uint8Array) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return bytes;
}

function clonePdfArrayBuffer(bytes) {
  const ab = normalizePdfBytes(bytes);
  if (!ab) return null;
  if (!(ab instanceof ArrayBuffer)) return ab;
  return ab.slice(0);
}

function toUint8Copy(bytes) {
  const ab = normalizePdfBytes(bytes);
  if (!ab) return null;
  return new Uint8Array(ab).slice();
}

function isDetachedBytes(bytes) {
  if (!bytes) return false;
  if (bytes instanceof ArrayBuffer) return bytes.byteLength === 0;
  if (bytes instanceof Uint8Array) return bytes.byteLength === 0 || bytes.buffer.byteLength === 0;
  if (ArrayBuffer.isView(bytes)) return bytes.byteLength === 0 || bytes.buffer.byteLength === 0;
  return false;
}

// Track if editor has been initialized
let editorInitialized = false;

// Initialize editor when DOM is ready
function initDocumentEditor() {
  if (editorInitialized) return;
  
  editorState.pdfCanvas = document.getElementById('editor-pdf-canvas');
  editorState.overlayCanvas = document.getElementById('editor-overlay-canvas');
  editorState.annotationCanvas = document.getElementById('editor-annotation-canvas');
  
  if (!editorState.pdfCanvas || !editorState.overlayCanvas) {
    console.log('Editor canvases not found, will retry on tab switch');
    return;
  }
  
  editorState.pdfCtx = editorState.pdfCanvas.getContext('2d');
  editorState.overlayCtx = editorState.overlayCanvas.getContext('2d');
  
  // Initialize Fabric.js canvas for annotations
  if (editorState.annotationCanvas && typeof fabric !== 'undefined') {
    editorState.fabricCanvas = new fabric.Canvas(editorState.annotationCanvas, {
      isDrawingMode: false,
      selection: true,
      preserveObjectStacking: true
    });
    editorState.fabricCanvas.freeDrawingBrush.color = editorState.annotationColor;
    editorState.fabricCanvas.freeDrawingBrush.width = editorState.annotationSize;
    console.log('Fabric.js canvas initialized');
  } else if (editorState.annotationCanvas) {
    editorState.annotationCtx = editorState.annotationCanvas.getContext('2d');
  }
  
  // Zoom controls
  const btnZoomIn = document.getElementById('btn-editor-zoom-in');
  const btnZoomOut = document.getElementById('btn-editor-zoom-out');
  
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => editorZoom(0.25));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => editorZoom(-0.25));
  
  // Page navigation
  const btnPrevPage = document.getElementById('btn-editor-prev-page');
  const btnNextPage = document.getElementById('btn-editor-next-page');
  
  if (btnPrevPage) btnPrevPage.addEventListener('click', () => editorGoToPage(editorState.currentPage - 1));
  if (btnNextPage) btnNextPage.addEventListener('click', () => editorGoToPage(editorState.currentPage + 1));
  
  // Extract/Add selection button
  const btnExtract = document.getElementById('btn-editor-extract');
  if (btnExtract) {
    btnExtract.addEventListener('click', editorExtractSelection);
    console.log('Extract button listener attached');
  }
  
  // Add text block button
  const btnAddText = document.getElementById('btn-add-text-block');
  if (btnAddText) btnAddText.addEventListener('click', () => addContentBlock('text', '', null));

  // Extraction mode toggle
  const btnModeManual = document.getElementById('btn-mode-manual');
  const btnModeAuto = document.getElementById('btn-mode-auto');
  if (btnModeManual) btnModeManual.addEventListener('click', () => setExtractionMode('manual'));
  if (btnModeAuto) btnModeAuto.addEventListener('click', () => setExtractionMode('auto'));

  const btnAutoScan = document.getElementById('btn-auto-scan');
  if (btnAutoScan) btnAutoScan.addEventListener('click', editorAutoScanPage);

  const btnAutoSelectAll = document.getElementById('btn-auto-select-all');
  if (btnAutoSelectAll) btnAutoSelectAll.addEventListener('click', () => setAllAutoScanCheckboxes(true));
  const btnAutoSelectNone = document.getElementById('btn-auto-select-none');
  if (btnAutoSelectNone) btnAutoSelectNone.addEventListener('click', () => setAllAutoScanCheckboxes(false));
  const btnAutoEditSelected = document.getElementById('btn-auto-edit-selected');
  // Unified action: single button runs auto classification (text/table/image)
  if (btnAutoEditSelected) btnAutoEditSelected.addEventListener('click', editorAutoAddSelectedRegions);
  
  // Canvas mouse events for selection and annotation
  editorState.overlayCanvas.addEventListener('mousedown', handleCanvasMouseDown);
  editorState.overlayCanvas.addEventListener('mousemove', handleCanvasMouseMove);
  editorState.overlayCanvas.addEventListener('mouseup', handleCanvasMouseUp);
  editorState.overlayCanvas.addEventListener('mouseleave', handleCanvasMouseUp);
  // Important: capture mouseup even if the user releases outside the canvas
  window.addEventListener('mouseup', handleCanvasMouseUp);
  
  // Default mode
  updateExtractionModeUI();
  
  // Preview Changes button (opens modal)
  const btnSave = document.getElementById('btn-save-changes');
  if (btnSave) btnSave.addEventListener('click', saveAndPreview);

  // Close preview modal on ESC
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('pdf-preview-modal');
    if (modal && !modal.classList.contains('hidden')) {
      closePdfPreviewModal();
    }
  });
  
  console.log('Document Editor initialized');
  editorInitialized = true;
}

// Load PDF document for the Editor tab
async function loadDocumentForEditor(job) {
  if (!job || !job.id) return;
  
  // Initialize editor if not already done
  initDocumentEditor();
  
  // Reset state for new document
  editorState.jobId = job.id;
  editorState.currentPage = 1;
  editorState.currentSelection = null;
  editorState.baseScale = 0;
  editorState.scale = 1.5;
  editorState.contentBlocks = [];
  editorState.blockIdCounter = 0;
  editorState.autoScan = null;
  editorState.extractionMode = 'manual';
  
  const loading = document.getElementById('editor-loading');
  if (loading) loading.classList.remove('hidden');
  
  // Clear content list
  renderContentList();
  clearEditorSelection();
  updateExtractionModeUI();
  
  try {
    // Get the file URL from the API
    const API_BASE = window.API_BASE || 'http://localhost:7071/api';
    const fileUrl = `${API_BASE.replace(/\/api$/, '')}/api/jobs/${job.id}/file`;
    editorState.fileUrl = fileUrl;
    editorState.fileBytes = null;

    const savedBytes = await loadPersistedPdfBytes(job.id);
    if (savedBytes) {
      // Keep a non-detached copy in state; pdf.js will transfer/detach the buffer passed in
      const savedBuffer = clonePdfArrayBuffer(savedBytes);
      editorState.fileBytes = savedBuffer;
      const pdfJsData = toUint8Copy(savedBuffer);
      const loadingTask = pdfjsLib.getDocument({ data: pdfJsData });
      editorState.pdfDoc = await loadingTask.promise;
    } else {
      // Load PDF with pdf.js
      const loadingTask = pdfjsLib.getDocument(fileUrl);
      editorState.pdfDoc = await loadingTask.promise;
    }
    editorState.totalPages = editorState.pdfDoc.numPages;
    
    // Update page indicator
    document.getElementById('editor-total-pages').textContent = editorState.totalPages;
    
    // Render first page
    await editorRenderPage(1);
    
  } catch (error) {
    console.error('Error loading document:', error);
    if (typeof showToast === 'function') showToast('Failed to load document');
  } finally {
    editorState.rendering = false;
    if (loading) loading.classList.add('hidden');
    renderAutoScanPanel();
    redrawAutoRegionsOverlay();
  }
}

async function saveChangesPersistently() {
  if (!editorState.jobId) {
    if (typeof showToast === 'function') showToast('No job loaded');
    return;
  }
  if (!editorState.pdfDoc || !editorState.fileUrl) {
    if (typeof showToast === 'function') showToast('No document loaded');
    return;
  }

  try {
    if (typeof showToast === 'function') showToast('Saving changes...');

    const pdfBytes = await generateModifiedPdf();
    // Important: pdf.js transfers/detaches buffers; IndexedDB can also detach.
    // Keep separate, independent buffers for state vs persistence vs pdf.js.
    const pdfBytesU8 = toUint8Copy(pdfBytes);
    const stateBuffer = pdfBytesU8.slice().buffer;
    const persistBuffer = pdfBytesU8.slice().buffer;

    await persistPdfBytes(editorState.jobId, persistBuffer);

    // Use the saved PDF as the new baseline (keep our own non-detached copy)
    editorState.fileBytes = stateBuffer;
    editorState.modifiedPdfBytes = stateBuffer;
    if (editorState.modifiedPdfUrl) {
      try { URL.revokeObjectURL(editorState.modifiedPdfUrl); } catch {}
    }
    editorState.modifiedPdfUrl = URL.createObjectURL(new Blob([pdfBytesU8], { type: 'application/pdf' }));

    // Reload pdf.js doc so left panel reflects saved PDF
    const pdfJsData = pdfBytesU8.slice();
    const loadingTask = pdfjsLib.getDocument({ data: pdfJsData });
    editorState.pdfDoc = await loadingTask.promise;
    editorState.totalPages = editorState.pdfDoc.numPages;
    const total = document.getElementById('editor-total-pages');
    if (total) total.textContent = editorState.totalPages;
    await editorRenderPage(editorState.currentPage);

    // Clear extracted content after saving
    editorState.contentBlocks = [];
    editorState.blockIdCounter = 0;
    editorState.annotations = {};
    editorState.annotationHistory = {};
    editorState.autoScan = null;
    renderContentList();
    clearEditorSelection();
    renderAutoScanPanel();
    redrawAutoRegionsOverlay();

    // Close the preview modal
    closePdfPreviewModal();

    if (typeof showToast === 'function') showToast('✓ Changes saved successfully!');
  } catch (e) {
    console.error('Save failed:', e);
    if (typeof showToast === 'function') showToast('Save failed: ' + (e && e.message ? e.message : 'Unknown error'));
  }
}

async function editorAutoScanPage() {
  if (!editorState.pdfDoc) return;

  // If user clicks scan without switching, force Auto mode
  if (editorState.extractionMode !== 'auto') setExtractionMode('auto');

  const loading = document.getElementById('editor-loading');
  if (loading) loading.classList.remove('hidden');

  try {
    const pageNum = editorState.currentPage;
    const page = await editorState.pdfDoc.getPage(pageNum);

    // Render at higher resolution for better region detection
    const ocrScale = 2.0;
    const viewport = page.getViewport({ scale: ocrScale });
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewport.width;
    tempCanvas.height = viewport.height;
    const tempCtx = tempCanvas.getContext('2d');

    await page.render({ canvasContext: tempCtx, viewport }).promise;

    const pageDataUrl = tempCanvas.toDataURL('image/png');
    const base64 = pageDataUrl.split(',')[1];

    const API_BASE = window.API_BASE || 'http://localhost:7071/api';
    const resp = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/detect-regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: base64, detect_visual: true })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    editorState.autoScan = {
      pageNum,
      ocrScale,
      imageBase64: base64,
      regions: Array.isArray(data.regions) ? data.regions : []
    };

    renderAutoScanPanel();
    redrawAutoRegionsOverlay();

    if (typeof showToast === 'function') showToast(`Auto scan found ${editorState.autoScan.regions.length} regions`);
  } catch (e) {
    console.error('Auto scan failed:', e);
    if (typeof showToast === 'function') showToast('Auto scan failed: ' + (e && e.message ? e.message : 'Unknown error'));
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

function openPdfPreviewInNewTab() {
  const iframe = document.getElementById('pdf-preview-iframe');
  const url = (iframe && iframe.src) || editorState.modifiedPdfUrl;
  if (!url) {
    if (typeof showToast === 'function') showToast('No preview available');
    return;
  }
  window.open(url, '_blank', 'noopener');
}

// Render a specific page
async function editorRenderPage(pageNum) {
  if (!editorState.pdfDoc || editorState.rendering) return;
  
  editorState.rendering = true;
  editorState.currentPage = pageNum;
  
  try {
    const page = await editorState.pdfDoc.getPage(pageNum);
    
    // Calculate scale to fit container width on first load
    if (editorState.baseScale === 0) {
      const container = document.querySelector('.editor-pdf-workspace');
      if (container && container.clientWidth > 0) {
        const containerWidth = container.clientWidth - 40;
        const viewport = page.getViewport({ scale: 1.0 });
        editorState.baseScale = Math.min(containerWidth / viewport.width, 1.5);
        editorState.scale = editorState.baseScale;
      } else {
        editorState.baseScale = 1.0;
        editorState.scale = 1.0;
      }
    }
    
    const viewport = page.getViewport({ scale: editorState.scale });
    
    // Set canvas dimensions
    editorState.pdfCanvas.width = viewport.width;
    editorState.pdfCanvas.height = viewport.height;
    editorState.overlayCanvas.width = viewport.width;
    editorState.overlayCanvas.height = viewport.height;
    
    // Resize Fabric.js canvas if available
    if (editorState.fabricCanvas) {
      editorState.fabricCanvas.setWidth(viewport.width);
      editorState.fabricCanvas.setHeight(viewport.height);
      editorState.fabricCanvas.renderAll();
    } else if (editorState.annotationCanvas) {
      editorState.annotationCanvas.width = viewport.width;
      editorState.annotationCanvas.height = viewport.height;
    }
    
    // Render PDF page
    const renderContext = {
      canvasContext: editorState.pdfCtx,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Update page indicator
    document.getElementById('editor-current-page').textContent = pageNum;
    
    // Update zoom level display
    const zoomPercent = Math.round((editorState.scale / editorState.baseScale) * 100);
    document.getElementById('editor-zoom-level').textContent = `${zoomPercent}%`;
    
    // Clear overlay and selection
    editorState.overlayCtx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
    editorState.currentSelection = null;
    document.getElementById('btn-editor-extract').disabled = true;
    
    // Redraw annotations for this page
    redrawAnnotations();
    
  } catch (error) {
    console.error('Error rendering page:', error);
  } finally {
    editorState.rendering = false;
    renderAutoScanPanel();
    redrawAutoRegionsOverlay();
  }
}

function renderAutoScanPanel() {
  const list = document.getElementById('auto-scan-list');
  const pageEl = document.getElementById('auto-scan-page');
  if (!list) return;

  if (editorState.extractionMode !== 'auto') return;

  if (!editorState.autoScan || editorState.autoScan.pageNum !== editorState.currentPage) {
    list.innerHTML = '<div class="auto-scan-item"><div><div class="auto-scan-item-title">No scan results</div><div class="auto-scan-item-meta">Click “Scan Page”</div></div></div>';
    return;
  }

  if (pageEl) pageEl.textContent = String(editorState.autoScan.pageNum);
  const regions = editorState.autoScan.regions || [];
  if (regions.length === 0) {
    list.innerHTML = '<div class="auto-scan-item"><div><div class="auto-scan-item-title">No regions detected</div><div class="auto-scan-item-meta">Try Manual mode</div></div></div>';
    return;
  }

  const max = Math.min(regions.length, 80);
  let html = '';
  for (let i = 0; i < max; i++) {
    const r = regions[i] || {};
    const type = r.type ? String(r.type) : 'region';
    const x = typeof r.x === 'number' ? r.x : 0;
    const y = typeof r.y === 'number' ? r.y : 0;
    const w = typeof r.width === 'number' ? r.width : 0;
    const h = typeof r.height === 'number' ? r.height : 0;
    html += `
      <label class="auto-scan-item">
        <input type="checkbox" class="auto-scan-checkbox" data-index="${i}" checked>
        <div>
          <div class="auto-scan-item-title">${escapeHtmlEditor(type)} #${i + 1}</div>
          <div class="auto-scan-item-meta">x:${x} y:${y} w:${w} h:${h}</div>
        </div>
      </label>
    `;
  }
  list.innerHTML = html;

  list.querySelectorAll('.auto-scan-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => redrawAutoRegionsOverlay());
  });
}

function setAllAutoScanCheckboxes(checked) {
  const list = document.getElementById('auto-scan-list');
  if (!list) return;
  list.querySelectorAll('.auto-scan-checkbox').forEach((cb) => {
    cb.checked = !!checked;
  });
  redrawAutoRegionsOverlay();
}

function getSelectedAutoScanIndices() {
  const list = document.getElementById('auto-scan-list');
  if (!list) return [];
  const indices = [];
  list.querySelectorAll('.auto-scan-checkbox').forEach((cb) => {
    if (cb.checked) indices.push(parseInt(cb.dataset.index, 10));
  });
  return indices.filter((n) => Number.isFinite(n));
}

function redrawAutoRegionsOverlay() {
  const ctx = editorState.overlayCtx;
  if (!ctx || !editorState.overlayCanvas) return;
  if (editorState.extractionMode !== 'auto') return;

  ctx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);

  if (!editorState.autoScan || editorState.autoScan.pageNum !== editorState.currentPage) return;
  const regions = editorState.autoScan.regions || [];
  const selected = new Set(getSelectedAutoScanIndices());

  const scaleFactor = editorState.autoScan.ocrScale / editorState.scale;
  const max = Math.min(regions.length, 80);
  for (let i = 0; i < max; i++) {
    const r = regions[i] || {};
    const x = (r.x || 0) / scaleFactor;
    const y = (r.y || 0) / scaleFactor;
    const w = (r.width || 0) / scaleFactor;
    const h = (r.height || 0) / scaleFactor;

    ctx.save();
    ctx.strokeStyle = selected.has(i) ? 'rgba(99, 102, 241, 0.95)' : 'rgba(148, 163, 184, 0.75)';
    ctx.lineWidth = selected.has(i) ? 2 : 1;
    ctx.setLineDash(selected.has(i) ? [] : [4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
}

async function editorAutoAddSelectedRegions() {
  if (!editorState.autoScan || editorState.autoScan.pageNum !== editorState.currentPage) {
    if (typeof showToast === 'function') showToast('Run Scan Page first');
    return;
  }

  const indices = getSelectedAutoScanIndices();
  if (indices.length === 0) {
    if (typeof showToast === 'function') showToast('Select at least one region');
    return;
  }

  const selectedMeta = indices
    .map((idx) => ({ idx, r: editorState.autoScan.regions[idx] }))
    .filter((x) => x.r)
    .map((x) => {
      const name = x.r.id || `region_${x.idx}`;
      return {
        name,
        type: x.r.type || null,
        is_visual: x.r.is_visual === true,
      };
    });

  const metaByName = new Map(selectedMeta.map((m) => [m.name, m]));

  const regions = indices
    .map((idx) => ({ idx, r: editorState.autoScan.regions[idx] }))
    .filter((x) => x.r)
    .map((x) => {
      const name = x.r.id || `region_${x.idx}`;
      return {
        x: Math.round(x.r.x || 0),
        y: Math.round(x.r.y || 0),
        width: Math.round(x.r.width || 0),
        height: Math.round(x.r.height || 0),
        name,
      };
    });

  const API_BASE = window.API_BASE || 'http://localhost:7071/api';
  const loading = document.getElementById('editor-loading');
  if (loading) loading.classList.remove('hidden');

  try {
    const resp = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/roi/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: editorState.autoScan.imageBase64, regions })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    const results = Array.isArray(data.results) ? data.results : [];
    const scaleFactor = editorState.autoScan.ocrScale / editorState.scale;

    for (const res of results) {
      if (!res || res.error) continue;
      const roi = res.roi || {};

      const regionInfo = {
        x: (roi.x || 0) / scaleFactor,
        y: (roi.y || 0) / scaleFactor,
        width: (roi.width || 0) / scaleFactor,
        height: (roi.height || 0) / scaleFactor,
        scale: editorState.scale,
        page: editorState.currentPage,
      };

      let detectedColor = null;
      if (res.cropped_image) {
        try { detectedColor = await detectDominantTextColor(res.cropped_image); } catch {}
      }

      const regionName = res.region_name || '';
      const meta = regionName ? metaByName.get(regionName) : null;
      const isVisualRegion = !!(meta && (meta.is_visual || String(meta.type || '').toLowerCase() === 'visual'));

      const hasTables = Array.isArray(res.tables) && res.tables.length > 0;
      const hasText = !!String(res.text || '').trim();
      const hasImage = typeof res.cropped_image === 'string' && !!res.cropped_image.trim();

      // Avoid creating empty blocks
      if (!hasImage && !hasTables && !hasText) {
        continue;
      }

      // Auto classification:
      // - If tables exist -> table
      // - Else if detected region is visual OR no text -> image
      // - Else -> text
      if (hasTables) {
        res.tables.forEach((table) => {
          addContentBlock('table', res.text, res.cropped_image, table, regionInfo, detectedColor);
        });
        continue;
      }

      if ((isVisualRegion || !hasText) && hasImage) {
        addContentBlock('image', '', res.cropped_image, null, regionInfo, null);
        continue;
      }

      addContentBlock('text', res.text || '', res.cropped_image, null, regionInfo, detectedColor);
    }

    if (typeof showToast === 'function') showToast('Selected regions added');
  } catch (e) {
    console.error('Add selected regions failed:', e);
    if (typeof showToast === 'function') showToast('Failed: ' + (e && e.message ? e.message : 'Unknown error'));
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

// (Previously) force-image add flow removed from UI.
// Keeping classification in editorAutoAddSelectedRegions as the single action.

// Zoom in/out
function editorZoom(delta) {
  const newScale = editorState.scale + (editorState.baseScale * delta);
  if (newScale < editorState.baseScale * 0.5 || newScale > editorState.baseScale * 3) return;
  
  editorState.scale = newScale;
  editorRenderPage(editorState.currentPage);
}

// Go to specific page
function editorGoToPage(pageNum) {
  if (pageNum < 1 || pageNum > editorState.totalPages) return;
  editorRenderPage(pageNum);
}

// Start selection
function editorStartSelection(e) {
  editorState.isDrawing = true;
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  editorState.startX = e.clientX - rect.left;
  editorState.startY = e.clientY - rect.top;
  editorState.currentSelection = null;
}

// Draw selection rectangle
function editorDrawSelection(e) {
  if (!editorState.isDrawing) return;
  
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  const x = Math.min(editorState.startX, currentX);
  const y = Math.min(editorState.startY, currentY);
  const width = Math.abs(currentX - editorState.startX);
  const height = Math.abs(currentY - editorState.startY);
  
  // Clear and redraw
  editorState.overlayCtx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
  
  // Draw selection rectangle
  editorState.overlayCtx.strokeStyle = '#6366f1';
  editorState.overlayCtx.lineWidth = 2;
  editorState.overlayCtx.setLineDash([5, 3]);
  editorState.overlayCtx.strokeRect(x, y, width, height);
  
  // Fill with semi-transparent color
  editorState.overlayCtx.fillStyle = 'rgba(99, 102, 241, 0.15)';
  editorState.overlayCtx.fillRect(x, y, width, height);
  
  editorState.overlayCtx.setLineDash([]);

  // Enable Add Selection while dragging once the selection is large enough
  if (width > 10 && height > 10) {
    editorState.currentSelection = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      scale: editorState.scale,
      page: editorState.currentPage
    };
    const btnExtract = document.getElementById('btn-editor-extract');
    if (btnExtract) btnExtract.disabled = false;
  }
}

// End selection
function editorEndSelection(e) {
  if (!editorState.isDrawing) return;
  editorState.isDrawing = false;
  
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  const x = Math.min(editorState.startX, currentX);
  const y = Math.min(editorState.startY, currentY);
  const width = Math.abs(currentX - editorState.startX);
  const height = Math.abs(currentY - editorState.startY);
  
  console.log('Selection ended:', { x, y, width, height });
  
  // Only save selection if it's large enough
  if (width > 10 && height > 10) {
    editorState.currentSelection = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      scale: editorState.scale,
      page: editorState.currentPage
    };
    const btnExtract = document.getElementById('btn-editor-extract');
    if (btnExtract) {
      btnExtract.disabled = false;
      console.log('Extract button enabled');
    }
  } else {
    clearEditorSelection();
  }
}

// Clear selection
function clearEditorSelection() {
  editorState.currentSelection = null;
  if (editorState.overlayCtx) {
    editorState.overlayCtx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
  }
  const btn = document.getElementById('btn-editor-extract');
  if (btn) btn.disabled = true;
}

// Extract content from selection and add to content list
async function editorExtractSelection() {
  if (!editorState.currentSelection || !editorState.pdfDoc) return;
  
  const sel = editorState.currentSelection;
  const loading = document.getElementById('editor-loading');
  
  if (loading) loading.classList.remove('hidden');
  
  try {
    // Get the current page as an image
    const page = await editorState.pdfDoc.getPage(editorState.currentPage);
    
    // Render at higher resolution for better OCR
    const ocrScale = 2.0;
    const viewport = page.getViewport({ scale: ocrScale });
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = viewport.width;
    tempCanvas.height = viewport.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    await page.render({
      canvasContext: tempCtx,
      viewport: viewport
    }).promise;
    
    // Calculate selection coordinates at OCR scale
    const scaleFactor = ocrScale / editorState.scale;
    const ocrX = Math.round(sel.x * scaleFactor);
    const ocrY = Math.round(sel.y * scaleFactor);
    const ocrWidth = Math.round(sel.width * scaleFactor);
    const ocrHeight = Math.round(sel.height * scaleFactor);
    
    // Get the full page as base64
    const pageDataUrl = tempCanvas.toDataURL('image/png');
    const base64 = pageDataUrl.split(',')[1];
    
    // Call OCR API
    const API_BASE = window.API_BASE || 'http://localhost:7071/api';
    const response = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/roi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: base64,
        x: ocrX,
        y: ocrY,
        width: ocrWidth,
        height: ocrHeight,
        prefer_method: 'auto'
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    // Store the region position for later PDF modification
    const regionInfo = {
      x: sel.x,
      y: sel.y,
      width: sel.width,
      height: sel.height,
      scale: sel.scale,
      page: sel.page
    };
    
    // Detect dominant text color from the cropped image
    let detectedColor = null;
    if (result.cropped_image) {
      detectedColor = await detectDominantTextColor(result.cropped_image);
    }
    
    const hasTables = Array.isArray(result.tables) && result.tables.length > 0;
    const hasText = !!String(result.text || '').trim();
    const hasImage = typeof result.cropped_image === 'string' && !!result.cropped_image.trim();

    // Avoid creating empty blocks
    if (!hasTables && !hasText && !hasImage) {
      if (typeof showToast === 'function') showToast('No content detected in that region');
      clearEditorSelection();
      return;
    }

    // Auto classify:
    // - table if tables exist
    // - image if no text but we have cropped image
    // - otherwise text
    if (hasTables) {
      result.tables.forEach(table => {
        addContentBlock('table', result.text, result.cropped_image, table, regionInfo, detectedColor);
      });
    } else if (!hasText && hasImage) {
      addContentBlock('image', '', result.cropped_image, null, regionInfo, null);
    } else {
      addContentBlock('text', result.text || '', result.cropped_image, null, regionInfo, detectedColor);
    }
    
    // Clear selection after extraction
    clearEditorSelection();
    
    if (typeof showToast === 'function') {
      showToast(`Content extracted from page ${sel.page}`);
    }
    
  } catch (error) {
    console.error('Error extracting content:', error);
    if (typeof showToast === 'function') showToast('Failed to extract: ' + error.message);
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

// Add a content block to the list
function addContentBlock(type, text, imageBase64, tableData = null, regionInfo = null, detectedColor = null) {
  const blockId = ++editorState.blockIdCounter;

  let normalizedImage = imageBase64 || null;
  if (normalizedImage && typeof normalizedImage === 'string') {
    const s = normalizedImage.trim();
    // If backend returns raw base64, convert to data URL so <img src> works
    if (s && !s.startsWith('data:') && !s.startsWith('http://') && !s.startsWith('https://')) {
      normalizedImage = `data:image/png;base64,${s}`;
    }
  }
  
  // Default color is black, but use detected color if available
  const textColor = detectedColor || '#000000';
  
  const block = {
    id: blockId,
    type: type, // 'text', 'table', 'image'
    text: text || '',
    originalText: text || '', // Keep original for comparison
    image: normalizedImage,
    table: tableData || null,
    page: regionInfo ? regionInfo.page : editorState.currentPage,
    region: regionInfo, // Store position for PDF modification
    format: { bold: false, fontSize: null, color: textColor }
  };
  
  editorState.contentBlocks.push(block);
  renderContentList();
  
  // Scroll to new block
  setTimeout(() => {
    const blockEl = document.querySelector(`[data-block-id="${blockId}"]`);
    if (blockEl) blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

// Render the content list
function renderContentList() {
  const container = document.getElementById('editor-content-list');
  if (!container) return;

  // Normalize any previously stored images so previews render reliably
  for (const b of editorState.contentBlocks) {
    if (!b || !b.image || typeof b.image !== 'string') continue;
    const s = b.image.trim();
    if (!s) continue;
    if (!s.startsWith('data:') && !s.startsWith('http://') && !s.startsWith('https://')) {
      b.image = `data:image/png;base64,${s}`;
    }
  }
  
  if (editorState.contentBlocks.length === 0) {
    container.innerHTML = `
      <div class="empty-state small">
        <i class="fas fa-mouse-pointer"></i>
        <p>Select regions from the PDF to extract content</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = editorState.contentBlocks.map(block => renderContentBlock(block)).join('');
  
  // Attach event listeners
  attachBlockEventListeners();
}

// Render a single content block
function renderContentBlock(block) {
  const typeIcon = block.type === 'table' ? 'fa-table' : (block.type === 'image' ? 'fa-image' : 'fa-font');
  const typeLabel = block.type === 'table' ? 'Table' : (block.type === 'image' ? 'Image' : 'Text');
  
  let bodyContent = '';

  if (block.type === 'image' && !block.image) {
    bodyContent += `<div class="image-missing">No image preview</div>`;
  }
  
  if (block.image) {
    bodyContent += `
      <div class="block-image-container" data-block-id="${block.id}">
        <img src="${block.image}" alt="Extracted region" class="block-preview-image" data-block-id="${block.id}" />
        <div class="image-edit-toolbar">
          <button class="img-tool-btn" data-action="crop" data-block-id="${block.id}" title="Crop / ROI">
            <i class="fas fa-crop-alt"></i>
          </button>
          <button class="img-tool-btn" data-action="annotate" data-block-id="${block.id}" title="Add Annotation">
            <i class="fas fa-pen"></i>
          </button>
          <button class="img-tool-btn" data-action="highlight" data-block-id="${block.id}" title="Highlight Area">
            <i class="fas fa-highlighter"></i>
          </button>
          <button class="img-tool-btn" data-action="text" data-block-id="${block.id}" title="Add Text">
            <i class="fas fa-font"></i>
          </button>
          <button class="img-tool-btn" data-action="arrow" data-block-id="${block.id}" title="Add Arrow">
            <i class="fas fa-arrow-right"></i>
          </button>
          <button class="img-tool-btn" data-action="reset" data-block-id="${block.id}" title="Reset Image">
            <i class="fas fa-undo"></i>
          </button>
        </div>
      </div>
    `;
  }
  
  if (block.type === 'table' && block.table) {
    bodyContent += renderEditableTable(block.table, block.id);
  } else if (block.type === 'image') {
    // Image type - only show image with edit tools, no text editor
    // The image container is already added above
  } else {
    // Text type - show formatting controls and text editor
    const textColor = (block.format && block.format.color) || '#000000';
    bodyContent += `
      <div class="block-formatting">
        <span class="block-formatting-label">Format:</span>
        <button class="format-btn ${block.format && block.format.bold ? 'active' : ''}" data-action="toggle-bold" data-block-id="${block.id}" type="button" title="Bold">B</button>
        <span class="block-formatting-label">Size:</span>
        <select class="format-select" data-action="font-size" data-block-id="${block.id}">
          <option value="">Auto</option>
          <option value="10" ${block.format && String(block.format.fontSize) === '10' ? 'selected' : ''}>10px</option>
          <option value="12" ${block.format && String(block.format.fontSize) === '12' ? 'selected' : ''}>12px</option>
          <option value="14" ${block.format && String(block.format.fontSize) === '14' ? 'selected' : ''}>14px</option>
          <option value="16" ${block.format && String(block.format.fontSize) === '16' ? 'selected' : ''}>16px</option>
          <option value="18" ${block.format && String(block.format.fontSize) === '18' ? 'selected' : ''}>18px</option>
          <option value="20" ${block.format && String(block.format.fontSize) === '20' ? 'selected' : ''}>20px</option>
        </select>
        <span class="block-formatting-label">Color:</span>
        <input type="color" class="format-color" data-action="text-color" data-block-id="${block.id}" value="${textColor}" title="Text Color">
      </div>
    `;
    bodyContent += `<textarea class="block-text-editor" data-block-id="${block.id}" placeholder="Edit extracted text here..." style="color: ${textColor};">${escapeHtmlEditor(block.text)}</textarea>`;
  }
  
  return `
    <div class="content-block" data-block-id="${block.id}">
      <div class="content-block-header">
        <span class="block-type"><i class="fas ${typeIcon}"></i> ${typeLabel} (Page ${block.page})</span>
        <div class="block-actions">
          <button class="move-up" title="Move Up"><i class="fas fa-arrow-up"></i></button>
          <button class="move-down" title="Move Down"><i class="fas fa-arrow-down"></i></button>
          <button class="delete" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>
      <div class="content-block-body">
        ${bodyContent}
      </div>
    </div>
  `;
}

// Render an editable table
function renderEditableTable(tableData, blockId) {
  if (!tableData || !tableData.rows) return '';
  
  let html = `<table class="block-table" data-block-id="${blockId}">`;
  
  tableData.rows.forEach((row, rowIdx) => {
    html += '<tr>';
    (row || []).forEach((cell, colIdx) => {
      const tag = rowIdx === 0 ? 'th' : 'td';
      html += `<${tag} contenteditable="true" data-row="${rowIdx}" data-col="${colIdx}">${escapeHtmlEditor(cell || '')}</${tag}>`;
    });
    html += '</tr>';
  });
  
  html += '</table>';
  return html;
}

// Attach event listeners to content blocks
function attachBlockEventListeners() {
  // Text editors
  document.querySelectorAll('.block-text-editor').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
      const blockId = parseInt(e.target.dataset.blockId);
      const block = editorState.contentBlocks.find(b => b.id === blockId);
      if (block) {
        block.text = e.target.value;
        console.log('Block', blockId, 'text updated. Original:', block.originalText, 'New:', block.text);
      }
    });
  });

  // Formatting controls (per block)
  document.querySelectorAll('.block-formatting [data-action="toggle-bold"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const blockId = parseInt(e.currentTarget.dataset.blockId);
      const block = editorState.contentBlocks.find(b => b.id === blockId);
      if (!block) return;
      if (!block.format) block.format = { bold: false, fontSize: null };
      block.format.bold = !block.format.bold;
      renderContentList();
    });
  });

  document.querySelectorAll('.block-formatting [data-action="font-size"]').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const blockId = parseInt(e.currentTarget.dataset.blockId);
      const block = editorState.contentBlocks.find(b => b.id === blockId);
      if (!block) return;
      if (!block.format) block.format = { bold: false, fontSize: null, color: '#000000' };
      const v = String(e.currentTarget.value || '').trim();
      block.format.fontSize = v ? parseFloat(v) : null;
    });
  });

  // Color picker
  document.querySelectorAll('.block-formatting [data-action="text-color"]').forEach(input => {
    input.addEventListener('input', (e) => {
      const blockId = parseInt(e.currentTarget.dataset.blockId);
      const block = editorState.contentBlocks.find(b => b.id === blockId);
      if (!block) return;
      if (!block.format) block.format = { bold: false, fontSize: null, color: '#000000' };
      block.format.color = e.currentTarget.value;
      // Update textarea color immediately
      const textarea = document.querySelector(`.block-text-editor[data-block-id="${blockId}"]`);
      if (textarea) textarea.style.color = e.currentTarget.value;
    });
  });
  
  // Table cells
  document.querySelectorAll('.block-table td[contenteditable], .block-table th[contenteditable]').forEach(cell => {
    cell.addEventListener('input', (e) => {
      const table = e.target.closest('.block-table');
      const blockId = parseInt(table.dataset.blockId);
      const row = parseInt(e.target.dataset.row);
      const col = parseInt(e.target.dataset.col);
      
      const block = editorState.contentBlocks.find(b => b.id === blockId);
      if (block && block.table && block.table.rows[row]) {
        block.table.rows[row][col] = e.target.textContent;
      }
    });
  });
  
  // Move up buttons
  document.querySelectorAll('.content-block .move-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const blockEl = e.target.closest('.content-block');
      const blockId = parseInt(blockEl.dataset.blockId);
      moveBlock(blockId, -1);
    });
  });
  
  // Move down buttons
  document.querySelectorAll('.content-block .move-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const blockEl = e.target.closest('.content-block');
      const blockId = parseInt(blockEl.dataset.blockId);
      moveBlock(blockId, 1);
    });
  });
  
  // Delete buttons
  document.querySelectorAll('.content-block .delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const blockEl = e.target.closest('.content-block');
      const blockId = parseInt(blockEl.dataset.blockId);
      deleteBlock(blockId);
    });
  });

  // Image editing tool buttons
  document.querySelectorAll('.img-tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = e.currentTarget.dataset.action;
      const blockId = parseInt(e.currentTarget.dataset.blockId);
      handleImageEditAction(action, blockId);
    });
  });
}

// Move a block up or down
function moveBlock(blockId, direction) {
  const idx = editorState.contentBlocks.findIndex(b => b.id === blockId);
  if (idx === -1) return;
  
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= editorState.contentBlocks.length) return;
  
  // Swap
  const temp = editorState.contentBlocks[idx];
  editorState.contentBlocks[idx] = editorState.contentBlocks[newIdx];
  editorState.contentBlocks[newIdx] = temp;
  
  renderContentList();
}

// Delete a block
function deleteBlock(blockId) {
  editorState.contentBlocks = editorState.contentBlocks.filter(b => b.id !== blockId);
  renderContentList();
}

// ==================== IMAGE EDITING TOOLS ====================

// State for image editing
const imageEditState = {
  activeBlockId: null,
  activeTool: null,
  isDrawing: false,
  startX: 0,
  startY: 0,
  canvas: null,
  ctx: null,
  originalImage: null,
  annotations: [] // Store annotations per image
};

// Handle image edit action
function handleImageEditAction(action, blockId) {
  console.log('handleImageEditAction called:', action, blockId);
  const block = editorState.contentBlocks.find(b => b.id === blockId);
  if (!block || !block.image) {
    console.log('Block not found or no image:', block);
    return;
  }

  // Store original image if not already stored
  if (!block.originalImage) {
    block.originalImage = block.image;
  }

  console.log('Opening modal for action:', action);
  switch (action) {
    case 'crop':
      openImageCropModal(block);
      break;
    case 'annotate':
      openImageAnnotateModal(block, 'draw');
      break;
    case 'highlight':
      openImageAnnotateModal(block, 'highlight');
      break;
    case 'text':
      openImageAnnotateModal(block, 'text');
      break;
    case 'arrow':
      openImageAnnotateModal(block, 'arrow');
      break;
    case 'reset':
      resetBlockImage(block);
      break;
  }
}

// Reset image to original
function resetBlockImage(block) {
  if (block.originalImage) {
    block.image = block.originalImage;
    block.imageAnnotations = [];
    renderContentList();
    if (typeof showToast === 'function') showToast('Image reset to original');
  }
}

// Open crop/ROI modal for image
function openImageCropModal(block) {
  // Create modal if it doesn't exist
  let modal = document.getElementById('image-crop-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'image-crop-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="closeImageCropModal()"></div>
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h3><i class="fas fa-crop-alt"></i> Crop / Select ROI</h3>
          <button class="btn-close" onclick="closeImageCropModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="image-crop-container">
            <canvas id="image-crop-canvas"></canvas>
          </div>
          <p class="crop-hint"><i class="fas fa-info-circle"></i> Draw a rectangle to select the region you want to keep</p>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeImageCropModal()">Cancel</button>
          <button class="btn-primary" id="btn-apply-crop" onclick="applyImageCrop()" disabled>
            <i class="fas fa-check"></i> Apply Crop
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // Load image into canvas
  const canvas = document.getElementById('image-crop-canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    // Scale to fit modal while maintaining aspect ratio
    const maxW = 800;
    const maxH = 500;
    let w = img.width;
    let h = img.height;
    
    if (w > maxW) {
      h = h * (maxW / w);
      w = maxW;
    }
    if (h > maxH) {
      w = w * (maxH / h);
      h = maxH;
    }
    
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    
    // Store state for cropping
    imageEditState.activeBlockId = block.id;
    imageEditState.canvas = canvas;
    imageEditState.ctx = ctx;
    imageEditState.originalImage = img;
    imageEditState.scaleX = img.width / w;
    imageEditState.scaleY = img.height / h;
    imageEditState.cropRect = null;
    
    // Add mouse events for selection
    canvas.onmousedown = startCropSelection;
    canvas.onmousemove = drawCropSelection;
    canvas.onmouseup = endCropSelection;
    canvas.onmouseleave = endCropSelection;
  };
  
  img.src = block.image;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function startCropSelection(e) {
  const rect = imageEditState.canvas.getBoundingClientRect();
  imageEditState.isDrawing = true;
  imageEditState.startX = e.clientX - rect.left;
  imageEditState.startY = e.clientY - rect.top;
}

function drawCropSelection(e) {
  if (!imageEditState.isDrawing) return;
  
  const canvas = imageEditState.canvas;
  const ctx = imageEditState.ctx;
  const rect = canvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  const x = Math.min(imageEditState.startX, currentX);
  const y = Math.min(imageEditState.startY, currentY);
  const w = Math.abs(currentX - imageEditState.startX);
  const h = Math.abs(currentY - imageEditState.startY);
  
  // Redraw image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imageEditState.originalImage, 0, 0, canvas.width, canvas.height);
  
  // Draw darkened overlay outside selection
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  // Clear the selection area to show original
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(imageEditState.originalImage, x, y, w, h, x, y, w, h);
  
  // Draw selection border
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  
  imageEditState.cropRect = { x, y, w, h };
  
  // Enable apply button if selection is valid
  const applyBtn = document.getElementById('btn-apply-crop');
  if (applyBtn) applyBtn.disabled = (w < 10 || h < 10);
}

function endCropSelection(e) {
  imageEditState.isDrawing = false;
}

function closeImageCropModal() {
  const modal = document.getElementById('image-crop-modal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  imageEditState.activeBlockId = null;
  imageEditState.cropRect = null;
}

function applyImageCrop() {
  if (!imageEditState.cropRect || !imageEditState.activeBlockId) return;
  
  const block = editorState.contentBlocks.find(b => b.id === imageEditState.activeBlockId);
  if (!block) return;
  
  const { x, y, w, h } = imageEditState.cropRect;
  const scaleX = imageEditState.scaleX;
  const scaleY = imageEditState.scaleY;
  
  // Create cropped image
  const tempCanvas = document.createElement('canvas');
  const srcX = x * scaleX;
  const srcY = y * scaleY;
  const srcW = w * scaleX;
  const srcH = h * scaleY;
  
  tempCanvas.width = srcW;
  tempCanvas.height = srcH;
  const tempCtx = tempCanvas.getContext('2d');
  tempCtx.drawImage(imageEditState.originalImage, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
  
  // Update block image
  block.image = tempCanvas.toDataURL('image/png');
  renderContentList();
  closeImageCropModal();
  
  if (typeof showToast === 'function') showToast('Image cropped successfully');
}

// Open annotation modal for image
function openImageAnnotateModal(block, tool) {
  let modal = document.getElementById('image-annotate-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'image-annotate-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-overlay" onclick="closeImageAnnotateModal()"></div>
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h3><i class="fas fa-pen"></i> Annotate Image</h3>
          <div class="annotate-tools">
            <button class="ann-tool-btn active" data-tool="draw" title="Draw"><i class="fas fa-pen"></i></button>
            <button class="ann-tool-btn" data-tool="highlight" title="Highlight"><i class="fas fa-highlighter"></i></button>
            <button class="ann-tool-btn" data-tool="arrow" title="Arrow"><i class="fas fa-arrow-right"></i></button>
            <button class="ann-tool-btn" data-tool="text" title="Text"><i class="fas fa-font"></i></button>
            <button class="ann-tool-btn" data-tool="rect" title="Rectangle"><i class="fas fa-square"></i></button>
            <span class="tool-divider"></span>
            <input type="color" id="ann-color" value="#ff0000" title="Color">
            <select id="ann-size" title="Size">
              <option value="2">Thin</option>
              <option value="4" selected>Medium</option>
              <option value="8">Thick</option>
            </select>
            <button class="ann-tool-btn" data-action="undo" title="Undo"><i class="fas fa-undo"></i></button>
            <button class="ann-tool-btn" data-action="clear" title="Clear All"><i class="fas fa-trash"></i></button>
          </div>
          <button class="btn-close" onclick="closeImageAnnotateModal()"><i class="fas fa-times"></i></button>
        </div>
        <div class="modal-body">
          <div class="image-annotate-container">
            <canvas id="image-annotate-canvas"></canvas>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeImageAnnotateModal()">Cancel</button>
          <button class="btn-primary" onclick="applyImageAnnotations()">
            <i class="fas fa-check"></i> Apply Annotations
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Add tool button listeners
    modal.querySelectorAll('.ann-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        modal.querySelectorAll('.ann-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        imageEditState.activeTool = e.currentTarget.dataset.tool;
      });
    });
    
    modal.querySelector('.ann-tool-btn[data-action="undo"]').addEventListener('click', undoImageAnnotation);
    modal.querySelector('.ann-tool-btn[data-action="clear"]').addEventListener('click', clearImageAnnotations);
  }

  // Set active tool
  imageEditState.activeTool = tool;
  modal.querySelectorAll('.ann-tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  // Load image into canvas
  const canvas = document.getElementById('image-annotate-canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  
  img.onload = () => {
    const maxW = 800;
    const maxH = 500;
    let w = img.width;
    let h = img.height;
    
    if (w > maxW) {
      h = h * (maxW / w);
      w = maxW;
    }
    if (h > maxH) {
      w = w * (maxH / h);
      h = maxH;
    }
    
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    
    imageEditState.activeBlockId = block.id;
    imageEditState.canvas = canvas;
    imageEditState.ctx = ctx;
    imageEditState.originalImage = img;
    imageEditState.scaleX = img.width / w;
    imageEditState.scaleY = img.height / h;
    imageEditState.annotations = [];
    imageEditState.currentPath = [];
    
    canvas.onmousedown = startImageAnnotation;
    canvas.onmousemove = drawImageAnnotation;
    canvas.onmouseup = endImageAnnotation;
    canvas.onmouseleave = endImageAnnotation;
  };
  
  img.src = block.image;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function startImageAnnotation(e) {
  const canvas = imageEditState.canvas;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  imageEditState.isDrawing = true;
  imageEditState.startX = x;
  imageEditState.startY = y;
  imageEditState.currentPath = [{ x, y }];
  
  if (imageEditState.activeTool === 'text') {
    imageEditState.isDrawing = false;
    const text = prompt('Enter text:');
    if (text) {
      const color = document.getElementById('ann-color')?.value || '#ff0000';
      const size = parseInt(document.getElementById('ann-size')?.value || '4') * 4;
      imageEditState.annotations.push({
        type: 'text',
        x, y,
        text,
        color,
        size
      });
      redrawImageAnnotations();
    }
  }
}

function drawImageAnnotation(e) {
  if (!imageEditState.isDrawing) return;
  
  const canvas = imageEditState.canvas;
  const ctx = imageEditState.ctx;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  imageEditState.currentPath.push({ x, y });
  
  // Redraw everything
  redrawImageAnnotations();
  
  // Draw current path
  const color = document.getElementById('ann-color')?.value || '#ff0000';
  const size = parseInt(document.getElementById('ann-size')?.value || '4');
  const tool = imageEditState.activeTool;
  
  drawAnnotationPath(ctx, imageEditState.currentPath, tool, color, size, imageEditState.startX, imageEditState.startY);
}

function endImageAnnotation(e) {
  if (!imageEditState.isDrawing) return;
  imageEditState.isDrawing = false;
  
  if (imageEditState.currentPath.length < 2) return;
  
  const color = document.getElementById('ann-color')?.value || '#ff0000';
  const size = parseInt(document.getElementById('ann-size')?.value || '4');
  
  imageEditState.annotations.push({
    type: imageEditState.activeTool,
    path: [...imageEditState.currentPath],
    color,
    size,
    startX: imageEditState.startX,
    startY: imageEditState.startY
  });
  
  imageEditState.currentPath = [];
  redrawImageAnnotations();
}

function drawAnnotationPath(ctx, path, tool, color, size, startX, startY) {
  if (path.length < 2) return;
  
  ctx.save();
  
  switch (tool) {
    case 'draw':
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
      break;
      
    case 'highlight':
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
      break;
      
    case 'arrow':
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      
      const start = path[0];
      const end = path[path.length - 1];
      
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      
      // Arrowhead
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = size * 4;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
      
    case 'rect':
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      const rx = Math.min(startX, path[path.length - 1].x);
      const ry = Math.min(startY, path[path.length - 1].y);
      const rw = Math.abs(path[path.length - 1].x - startX);
      const rh = Math.abs(path[path.length - 1].y - startY);
      ctx.strokeRect(rx, ry, rw, rh);
      break;
  }
  
  ctx.restore();
}

function redrawImageAnnotations() {
  const canvas = imageEditState.canvas;
  const ctx = imageEditState.ctx;
  
  // Redraw original image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(imageEditState.originalImage, 0, 0, canvas.width, canvas.height);
  
  // Redraw all annotations
  for (const ann of imageEditState.annotations) {
    if (ann.type === 'text') {
      ctx.save();
      ctx.font = `${ann.size}px Arial`;
      ctx.fillStyle = ann.color;
      ctx.fillText(ann.text, ann.x, ann.y);
      ctx.restore();
    } else {
      drawAnnotationPath(ctx, ann.path, ann.type, ann.color, ann.size, ann.startX, ann.startY);
    }
  }
}

function undoImageAnnotation() {
  if (imageEditState.annotations.length > 0) {
    imageEditState.annotations.pop();
    redrawImageAnnotations();
  }
}

function clearImageAnnotations() {
  imageEditState.annotations = [];
  redrawImageAnnotations();
}

function closeImageAnnotateModal() {
  const modal = document.getElementById('image-annotate-modal');
  if (modal) modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  imageEditState.activeBlockId = null;
  imageEditState.annotations = [];
}

function applyImageAnnotations() {
  if (!imageEditState.activeBlockId) return;
  
  const block = editorState.contentBlocks.find(b => b.id === imageEditState.activeBlockId);
  if (!block) return;
  
  // Get the annotated image from canvas
  block.image = imageEditState.canvas.toDataURL('image/png');
  renderContentList();
  closeImageAnnotateModal();
  
  if (typeof showToast === 'function') showToast('Annotations applied');
}

// Expose functions globally
window.closeImageCropModal = closeImageCropModal;
window.applyImageCrop = applyImageCrop;
window.closeImageAnnotateModal = closeImageAnnotateModal;
window.applyImageAnnotations = applyImageAnnotations;

// Escape HTML for safe rendering
function escapeHtmlEditor(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Get all content blocks for preview/export
function getEditorContent() {
  return editorState.contentBlocks;
}

// ==================== ANNOTATION TOOLS ====================

// Initialize annotation tool buttons
function initAnnotationTools() {
  const tools = ['select', 'draw', 'highlight', 'strikethrough', 'text', 'arrow', 'eraser'];
  
  // Main toolbar tools
  tools.forEach(tool => {
    const btn = document.getElementById(`btn-tool-${tool}`);
    if (btn) {
      btn.addEventListener('click', () => setAnnotationTool(tool));
    }
  });
  
  // Extracted content toolbar tools
  document.querySelectorAll('.extracted-annotation-toolbar .annotation-tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tool = e.currentTarget.dataset.tool;
      setAnnotationTool(tool);
      // Update active state in extracted toolbar
      document.querySelectorAll('.extracted-annotation-toolbar .annotation-tool-btn').forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
    });
  });
  
  // Color picker (main)
  const colorPicker = document.getElementById('annotation-color');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
      editorState.annotationColor = e.target.value;
      if (editorState.fabricCanvas) {
        editorState.fabricCanvas.freeDrawingBrush.color = e.target.value;
      }
    });
  }
  
  // Color picker (extracted toolbar)
  const extractedColorPicker = document.getElementById('extracted-annotation-color');
  if (extractedColorPicker) {
    extractedColorPicker.addEventListener('input', (e) => {
      editorState.annotationColor = e.target.value;
      if (editorState.fabricCanvas) {
        editorState.fabricCanvas.freeDrawingBrush.color = e.target.value;
      }
    });
  }
  
  // Size selector (main)
  const sizeSelector = document.getElementById('annotation-size');
  if (sizeSelector) {
    sizeSelector.addEventListener('change', (e) => {
      editorState.annotationSize = parseInt(e.target.value);
      if (editorState.fabricCanvas) {
        editorState.fabricCanvas.freeDrawingBrush.width = editorState.annotationSize;
      }
    });
  }
  
  // Size selector (extracted toolbar)
  const extractedSizeSelector = document.getElementById('extracted-annotation-size');
  if (extractedSizeSelector) {
    extractedSizeSelector.addEventListener('change', (e) => {
      editorState.annotationSize = parseInt(e.target.value);
      if (editorState.fabricCanvas) {
        editorState.fabricCanvas.freeDrawingBrush.width = editorState.annotationSize;
      }
    });
  }
  
  // Undo button (main)
  const btnUndo = document.getElementById('btn-undo-annotation');
  if (btnUndo) {
    btnUndo.addEventListener('click', undoAnnotation);
  }
  
  // Undo button (extracted toolbar)
  const btnUndoExtracted = document.getElementById('btn-undo-extracted');
  if (btnUndoExtracted) {
    btnUndoExtracted.addEventListener('click', undoAnnotation);
  }
  
  // Clear all button (main)
  const btnClear = document.getElementById('btn-clear-annotations');
  if (btnClear) {
    btnClear.addEventListener('click', clearAllAnnotations);
  }
  
  // Clear all button (extracted toolbar)
  const btnClearExtracted = document.getElementById('btn-clear-extracted');
  if (btnClearExtracted) {
    btnClearExtracted.addEventListener('click', clearAllAnnotations);
  }
}

// Set the current annotation tool
function setAnnotationTool(tool) {
  editorState.currentTool = tool;
  
  // Update button states in main toolbar
  document.querySelectorAll('.btn-annotation').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`btn-tool-${tool}`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // Configure Fabric.js canvas based on tool
  if (editorState.fabricCanvas) {
    const fc = editorState.fabricCanvas;
    
    // Disable drawing mode by default
    fc.isDrawingMode = false;
    fc.selection = true;
    
    switch (tool) {
      case 'draw':
        fc.isDrawingMode = true;
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = editorState.annotationColor;
        fc.freeDrawingBrush.width = editorState.annotationSize;
        break;
      case 'highlight':
        fc.isDrawingMode = true;
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        // Highlight uses semi-transparent color
        fc.freeDrawingBrush.color = editorState.annotationColor + '60';
        fc.freeDrawingBrush.width = editorState.annotationSize * 4;
        break;
      case 'strikethrough':
        fc.isDrawingMode = true;
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = editorState.annotationColor;
        fc.freeDrawingBrush.width = editorState.annotationSize;
        break;
      case 'text':
        fc.isDrawingMode = false;
        fc.selection = false;
        break;
      case 'eraser':
        fc.isDrawingMode = false;
        fc.selection = true;
        break;
      case 'select':
      default:
        fc.isDrawingMode = false;
        fc.selection = false;
        break;
    }
  }
  
  // Update cursor based on tool
  const overlay = editorState.overlayCanvas;
  if (overlay) {
    switch (tool) {
      case 'select':
        overlay.style.cursor = 'crosshair';
        break;
      case 'draw':
      case 'highlight':
      case 'strikethrough':
        overlay.style.cursor = 'crosshair';
        break;
      case 'text':
        overlay.style.cursor = 'text';
        break;
      case 'eraser':
        overlay.style.cursor = 'pointer';
        break;
      case 'arrow':
        overlay.style.cursor = 'crosshair';
        break;
      default:
        overlay.style.cursor = 'default';
    }
  }
  
  // Update hint text
  const hint = document.querySelector('.editor-hint');
  if (hint) {
    const hints = {
      select: '<i class="fas fa-info-circle"></i> Draw a rectangle to select a region for OCR',
      draw: '<i class="fas fa-pencil-alt"></i> Click and drag to draw',
      highlight: '<i class="fas fa-highlighter"></i> Click and drag to highlight',
      strikethrough: '<i class="fas fa-strikethrough"></i> Click and drag to strikethrough',
      text: '<i class="fas fa-font"></i> Click to add text annotation',
      arrow: '<i class="fas fa-long-arrow-alt-right"></i> Click and drag to draw an arrow',
      eraser: '<i class="fas fa-eraser"></i> Click on an annotation to erase it'
    };
    hint.innerHTML = hints[tool] || '';
  }
}

// Unified mouse handlers
function handleCanvasMouseDown(e) {
  if (editorState.extractionMode === 'auto') return;
  const tool = editorState.currentTool;
  
  if (tool === 'select') {
    editorStartSelection(e);
  } else if (tool === 'text') {
    handleTextAnnotation(e);
  } else if (tool === 'eraser') {
    handleEraser(e);
  } else {
    startAnnotation(e);
  }
}

function handleCanvasMouseMove(e) {
  if (editorState.extractionMode === 'auto') return;
  const tool = editorState.currentTool;
  
  if (tool === 'select') {
    editorDrawSelection(e);
  } else if (tool !== 'text' && tool !== 'eraser') {
    drawAnnotation(e);
  }
}

function handleCanvasMouseUp(e) {
  if (editorState.extractionMode === 'auto') return;
  const tool = editorState.currentTool;
  
  if (tool === 'select') {
    editorEndSelection(e);
  } else if (tool !== 'text' && tool !== 'eraser') {
    endAnnotation(e);
  }
}

// Start drawing an annotation
function startAnnotation(e) {
  editorState.isAnnotating = true;
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  editorState.startX = x;
  editorState.startY = y;
  editorState.currentPath = [{ x, y }];
  
  // Save current state for undo
  saveAnnotationState();
}

// Draw annotation while moving
function drawAnnotation(e) {
  if (!editorState.isAnnotating) return;
  
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  editorState.currentPath.push({ x, y });
  
  // Draw on overlay canvas (temporary)
  const ctx = editorState.overlayCtx;
  ctx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
  
  drawPathOnContext(ctx, editorState.currentPath, editorState.currentTool, editorState.annotationColor, editorState.annotationSize);
}

// End annotation
function endAnnotation(e) {
  if (!editorState.isAnnotating) return;
  editorState.isAnnotating = false;
  
  if (editorState.currentPath.length < 2) {
    editorState.overlayCtx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
    return;
  }
  
  // Save annotation to state
  const pageNum = editorState.currentPage;
  if (!editorState.annotations[pageNum]) {
    editorState.annotations[pageNum] = [];
  }
  
  const newAnnotation = {
    type: editorState.currentTool,
    path: [...editorState.currentPath],
    color: editorState.annotationColor,
    size: editorState.annotationSize,
    startX: editorState.startX,
    startY: editorState.startY
  };
  
  editorState.annotations[pageNum].push(newAnnotation);
  console.log('Annotation saved:', newAnnotation);
  console.log('Total annotations on page', pageNum, ':', editorState.annotations[pageNum].length);
  
  // Clear overlay and redraw all annotations on annotation canvas
  editorState.overlayCtx.clearRect(0, 0, editorState.overlayCanvas.width, editorState.overlayCanvas.height);
  redrawAnnotations();
  
  editorState.currentPath = [];
}

// Draw a path on a given context
function drawPathOnContext(ctx, path, tool, color, size) {
  if (path.length < 2) return;
  
  ctx.save();
  
  switch (tool) {
    case 'draw':
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
      break;
      
    case 'highlight':
      ctx.strokeStyle = color;
      ctx.lineWidth = size * 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
      }
      ctx.stroke();
      break;
      
    case 'strikethrough':
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      // Draw a straight line from start to end
      const startPt = path[0];
      const endPt = path[path.length - 1];
      ctx.beginPath();
      ctx.moveTo(startPt.x, startPt.y);
      ctx.lineTo(endPt.x, endPt.y);
      ctx.stroke();
      break;
      
    case 'arrow':
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      
      const start = path[0];
      const end = path[path.length - 1];
      
      // Draw line
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      
      // Draw arrowhead
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLen = size * 4;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      break;
  }
  
  ctx.restore();
}

// Redraw all annotations for current page
function redrawAnnotations() {
  const ctx = editorState.annotationCtx;
  if (!ctx) return;
  
  ctx.clearRect(0, 0, editorState.annotationCanvas.width, editorState.annotationCanvas.height);
  
  const pageAnnotations = editorState.annotations[editorState.currentPage] || [];
  
  for (const ann of pageAnnotations) {
    if (ann.type === 'text') {
      ctx.save();
      ctx.font = `${ann.size * 4}px Arial`;
      ctx.fillStyle = ann.color;
      ctx.fillText(ann.text, ann.x, ann.y);
      ctx.restore();
    } else {
      drawPathOnContext(ctx, ann.path, ann.type, ann.color, ann.size);
    }
  }
}

// Handle text annotation
function handleTextAnnotation(e) {
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const text = prompt('Enter text annotation:');
  if (!text) return;
  
  // Use Fabric.js if available
  if (editorState.fabricCanvas) {
    const textObj = new fabric.IText(text, {
      left: x,
      top: y,
      fontSize: editorState.annotationSize * 6,
      fill: editorState.annotationColor,
      fontFamily: 'Arial',
      editable: true
    });
    editorState.fabricCanvas.add(textObj);
    editorState.fabricCanvas.setActiveObject(textObj);
    editorState.fabricCanvas.renderAll();
    return;
  }
  
  // Fallback to old method
  saveAnnotationState();
  
  const pageNum = editorState.currentPage;
  if (!editorState.annotations[pageNum]) {
    editorState.annotations[pageNum] = [];
  }
  
  editorState.annotations[pageNum].push({
    type: 'text',
    x: x,
    y: y,
    text: text,
    color: editorState.annotationColor,
    size: editorState.annotationSize
  });
  
  redrawAnnotations();
}

// Handle eraser
function handleEraser(e) {
  // Use Fabric.js eraser if available
  if (editorState.fabricCanvas) {
    const fc = editorState.fabricCanvas;
    const activeObj = fc.getActiveObject();
    if (activeObj) {
      fc.remove(activeObj);
      fc.renderAll();
      if (typeof showToast === 'function') showToast('Annotation removed');
    } else {
      if (typeof showToast === 'function') showToast('Click on an annotation to select it first');
    }
    return;
  }
  
  // Fallback to old method
  const rect = editorState.overlayCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const pageNum = editorState.currentPage;
  const annotations = editorState.annotations[pageNum] || [];
  
  // Find and remove annotation near click point
  for (let i = annotations.length - 1; i >= 0; i--) {
    const ann = annotations[i];
    if (isPointNearAnnotation(x, y, ann)) {
      saveAnnotationState();
      annotations.splice(i, 1);
      redrawAnnotations();
      if (typeof showToast === 'function') showToast('Annotation removed');
      return;
    }
  }
}

// Check if a point is near an annotation
function isPointNearAnnotation(x, y, ann) {
  const threshold = 15;
  
  if (ann.type === 'text') {
    return Math.abs(x - ann.x) < 50 && Math.abs(y - ann.y) < 20;
  }
  
  if (ann.path) {
    for (const pt of ann.path) {
      if (Math.abs(x - pt.x) < threshold && Math.abs(y - pt.y) < threshold) {
        return true;
      }
    }
  }
  
  return false;
}

// Save annotation state for undo
function saveAnnotationState() {
  const pageNum = editorState.currentPage;
  if (!editorState.annotationHistory[pageNum]) {
    editorState.annotationHistory[pageNum] = [];
  }
  
  // Deep copy current annotations
  const currentState = JSON.parse(JSON.stringify(editorState.annotations[pageNum] || []));
  editorState.annotationHistory[pageNum].push(currentState);
  
  // Limit history to 20 states
  if (editorState.annotationHistory[pageNum].length > 20) {
    editorState.annotationHistory[pageNum].shift();
  }
}

// Undo last annotation
function undoAnnotation() {
  // Use Fabric.js undo if available
  if (editorState.fabricCanvas) {
    const fc = editorState.fabricCanvas;
    const objects = fc.getObjects();
    if (objects.length === 0) {
      if (typeof showToast === 'function') showToast('Nothing to undo');
      return;
    }
    // Remove the last object
    fc.remove(objects[objects.length - 1]);
    fc.renderAll();
    if (typeof showToast === 'function') showToast('Undo successful');
    return;
  }
  
  // Fallback to old method
  const pageNum = editorState.currentPage;
  const history = editorState.annotationHistory[pageNum];
  
  if (!history || history.length === 0) {
    if (typeof showToast === 'function') showToast('Nothing to undo');
    return;
  }
  
  editorState.annotations[pageNum] = history.pop();
  redrawAnnotations();
  if (typeof showToast === 'function') showToast('Undo successful');
}

// Clear all annotations on current page
function clearAllAnnotations() {
  // Use Fabric.js clear if available
  if (editorState.fabricCanvas) {
    const fc = editorState.fabricCanvas;
    if (fc.getObjects().length === 0) {
      if (typeof showToast === 'function') showToast('No annotations to clear');
      return;
    }
    fc.clear();
    fc.renderAll();
    if (typeof showToast === 'function') showToast('All annotations cleared');
    return;
  }
  
  // Fallback to old method
  const pageNum = editorState.currentPage;
  
  if (!editorState.annotations[pageNum] || editorState.annotations[pageNum].length === 0) {
    if (typeof showToast === 'function') showToast('No annotations to clear');
    return;
  }
  
  saveAnnotationState();
  editorState.annotations[pageNum] = [];
  redrawAnnotations();
  if (typeof showToast === 'function') showToast('All annotations cleared');
}

// ==================== SAVE & EXPORT ====================

// Save changes and show in Final Preview
async function saveAndPreview() {
  if (!editorState.pdfDoc || !editorState.fileUrl) {
    if (typeof showToast === 'function') showToast('No document loaded');
    return;
  }
  
  if (typeof showToast === 'function') showToast('Generating preview...');
  
  try {
    // Generate modified PDF
    const modifiedPdfBytes = await generateModifiedPdf();
    
    // Create blob URL for preview
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);
    
    // Store for later use
    editorState.modifiedPdfUrl = blobUrl;
    editorState.modifiedPdfBytes = modifiedPdfBytes;
    
    // Switch to Final Preview tab and show the PDF
    showFinalPreview(blobUrl);
    
    if (typeof showToast === 'function') showToast('Preview generated');
    
  } catch (error) {
    console.error('Error generating preview:', error);
    if (typeof showToast === 'function') showToast('Error generating preview: ' + error.message);
  }
}

// Download the modified PDF
async function downloadModifiedPdf() {
  if (!editorState.pdfDoc || !editorState.fileUrl) {
    if (typeof showToast === 'function') showToast('No document loaded');
    return;
  }
  
  if (typeof showToast === 'function') showToast('Generating PDF...');
  
  try {
    // Generate modified PDF if not already done
    let pdfBytes = editorState.modifiedPdfBytes;
    if (!pdfBytes) {
      pdfBytes = await generateModifiedPdf();
    }
    
    // Download
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `modified_document_${Date.now()}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    if (typeof showToast === 'function') showToast('PDF downloaded!');
    
  } catch (error) {
    console.error('Error downloading PDF:', error);
    if (typeof showToast === 'function') showToast('Error downloading PDF: ' + error.message);
  }
}

// Generate modified PDF with annotations AND edited content blocks
async function generateModifiedPdf() {
  console.log('Generating modified PDF...');
  console.log('Annotations:', editorState.annotations);
  console.log('Content blocks:', editorState.contentBlocks);
  
  let originalPdfBytes;
  if (editorState.fileBytes && editorState.fileBytes.byteLength > 0) {
    originalPdfBytes = editorState.fileBytes;
  } else {
    const response = await fetch(editorState.fileUrl);
    originalPdfBytes = await response.arrayBuffer();
  }

  // If bytes are detached (ArrayBuffer or TypedArray), recover by refetching
  if (isDetachedBytes(originalPdfBytes)) {
    const response = await fetch(editorState.fileUrl);
    originalPdfBytes = await response.arrayBuffer();
  }

  // Load with pdf-lib (always pass a fresh Uint8Array copy)
  let originalPdfU8;
  try {
    originalPdfU8 = toUint8Copy(originalPdfBytes);
  } catch (e) {
    // If we still hit a detached buffer during copy, refetch and retry once.
    const response = await fetch(editorState.fileUrl);
    const fresh = await response.arrayBuffer();
    originalPdfU8 = toUint8Copy(fresh);
  }

  // Load with pdf-lib
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.load(originalPdfU8);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  console.log('PDF has', pages.length, 'pages');
  
  // First, apply edited content blocks (text replacements)
  for (const block of editorState.contentBlocks) {
    // Check if text was modified
    if (block.region && block.text !== block.originalText) {
      console.log('Applying text change for block', block.id, 'on page', block.page);
      
      const pageIndex = block.page - 1;
      if (pageIndex < 0 || pageIndex >= pages.length) continue;
      
      const page = pages[pageIndex];
      const { width, height } = page.getSize();
      
      // Get scale factor
      const pdfJsPage = await editorState.pdfDoc.getPage(block.page);
      const viewport = pdfJsPage.getViewport({ scale: block.region.scale });
      const scaleX = width / viewport.width;
      const scaleY = height / viewport.height;
      
      // Calculate position in PDF coordinates
      const pdfX = block.region.x * scaleX;
      const pdfY = height - (block.region.y * scaleY) - (block.region.height * scaleY);
      const pdfWidth = block.region.width * scaleX;
      const pdfHeight = block.region.height * scaleY;

      if (block.image) {
        const pngBytes = await renderEditedTextRegionPng(block.image, String(block.text || ''), block.format);
        const embedded = await pdfDoc.embedPng(pngBytes);
        page.drawImage(embedded, {
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
        });
        console.log('Text replacement applied as image at', { pdfX, pdfY, pdfWidth, pdfHeight });
      } else {
        page.drawRectangle({
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          color: rgb(1, 1, 1), // White
        });

        const padX = Math.max(2, pdfWidth * 0.02);
        const padY = Math.max(2, pdfHeight * 0.05);
        const maxW = Math.max(1, pdfWidth - padX * 2);
        const maxH = Math.max(1, pdfHeight - padY * 2);

        const originalNonEmptyLines = block.originalText
          .replace(/\r/g, '')
          .split('\n')
          .filter((l) => l.trim());

        const estimatedLineCount = Math.max(originalNonEmptyLines.length, 1);
        const baseFontSize = Math.min(Math.max((maxH / estimatedLineCount) * 0.78, 6), 14);

        const textToDraw = String(block.text || '').replace(/\r/g, '');
        const fitted = fitWrappedTextToBox(font, textToDraw, baseFontSize, maxW, maxH);

        const startX = pdfX + padX;
        let currentY = pdfY + pdfHeight - padY - fitted.fontSize;

        for (const line of fitted.lines) {
          if (currentY < pdfY + padY) break;

          page.drawText(line, {
            x: startX,
            y: currentY,
            size: fitted.fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });

          currentY -= fitted.lineHeight;
        }
      }
    }
  }

  // Apply table blocks (always render table if it has a region)
  for (const block of editorState.contentBlocks) {
    if (!block.region) continue;
    if (block.type !== 'table' || !block.table || !Array.isArray(block.table.rows)) continue;

    const pageIndex = block.page - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const { width, height } = page.getSize();

    const pdfJsPage = await editorState.pdfDoc.getPage(block.page);
    const viewport = pdfJsPage.getViewport({ scale: block.region.scale });
    const scaleX = width / viewport.width;
    const scaleY = height / viewport.height;

    const pdfX = block.region.x * scaleX;
    const pdfY = height - (block.region.y * scaleY) - (block.region.height * scaleY);
    const pdfWidth = block.region.width * scaleX;
    const pdfHeight = block.region.height * scaleY;

    const rows = block.table.rows || [];
    const rowCount = Math.max(rows.length, 1);
    const colCount = Math.max(1, ...rows.map((r) => (Array.isArray(r) ? r.length : 0)));

    if (block.image) {
      const pngBytes = await renderEditedTableRegionPng(block.image, rows);
      const embedded = await pdfDoc.embedPng(pngBytes);
      page.drawImage(embedded, {
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
      });
      console.log('Table rendered as image for block', block.id, 'at', { pdfX, pdfY, pdfWidth, pdfHeight, rowCount, colCount });
      continue;
    }

    const cellW = pdfWidth / colCount;
    const cellH = pdfHeight / rowCount;

    page.drawRectangle({
      x: pdfX,
      y: pdfY,
      width: pdfWidth,
      height: pdfHeight,
      color: rgb(1, 1, 1),
    });

    const gridColor = rgb(0.75, 0.75, 0.75);
    const gridThickness = Math.max(0.5, 0.8 * Math.min(scaleX, scaleY));

    for (let c = 0; c <= colCount; c++) {
      const x = pdfX + c * cellW;
      page.drawLine({ start: { x, y: pdfY }, end: { x, y: pdfY + pdfHeight }, thickness: gridThickness, color: gridColor });
    }

    for (let r = 0; r <= rowCount; r++) {
      const y = pdfY + r * cellH;
      page.drawLine({ start: { x: pdfX, y }, end: { x: pdfX + pdfWidth, y }, thickness: gridThickness, color: gridColor });
    }

    const baseFontSize = Math.min(Math.max(cellH * 0.45, 6), 12);
    const pad = Math.max(2, cellW * 0.03);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const raw = (rows[r] && rows[r][c]) != null ? String(rows[r][c]) : '';
        const text = raw.trim();
        if (!text) continue;

        const cellX = pdfX + c * cellW;
        const cellTopY = pdfY + pdfHeight - r * cellH;
        const textY = cellTopY - baseFontSize - pad;
        let fontSize = baseFontSize;

        const availableW = Math.max(1, cellW - pad * 2);
        const measuredW = font.widthOfTextAtSize(text, fontSize);
        if (measuredW > availableW) fontSize = Math.max(5, fontSize * (availableW / measuredW));

        page.drawText(text, { x: cellX + pad, y: textY, size: fontSize, font, color: rgb(0, 0, 0) });
      }
    }

    console.log('Table rendered for block', block.id, 'at', { pdfX, pdfY, pdfWidth, pdfHeight, rowCount, colCount });
  }
  
  // Apply annotations to each page
  for (let pageNum = 1; pageNum <= pages.length; pageNum++) {
    const pageAnnotations = editorState.annotations[pageNum] || [];
    console.log(`Page ${pageNum}: ${pageAnnotations.length} annotations`);
    if (pageAnnotations.length === 0) continue;
    
    const page = pages[pageNum - 1];
    const { width, height } = page.getSize();
    
    // Get the scale factor (pdf-lib uses PDF coordinates, our annotations use canvas coordinates)
    // We need to get the original page viewport to calculate the scale
    const pdfJsPage = await editorState.pdfDoc.getPage(pageNum);
    const viewport = pdfJsPage.getViewport({ scale: editorState.scale });
    const scaleX = width / viewport.width;
    const scaleY = height / viewport.height;
    
    for (const ann of pageAnnotations) {
      const color = hexToRgb(ann.color);
      
      if (ann.type === 'text') {
        // Add text annotation
        const x = ann.x * scaleX;
        const y = height - (ann.y * scaleY); // PDF coordinates are bottom-up
        page.drawText(ann.text, {
          x: x,
          y: y,
          size: ann.size * 3,
          font: font,
          color: rgb(color.r / 255, color.g / 255, color.b / 255),
        });
      } else if (ann.path && ann.path.length >= 2) {
        // Draw path-based annotations
        const lineWidth = ann.size * scaleX;
        const opacity = ann.type === 'highlight' ? 0.3 : 1;
        const strokeWidth = ann.type === 'highlight' ? ann.size * 4 * scaleX : lineWidth;
        
        if (ann.type === 'draw' || ann.type === 'highlight') {
          // Draw freehand path
          for (let i = 1; i < ann.path.length; i++) {
            const x1 = ann.path[i - 1].x * scaleX;
            const y1 = height - (ann.path[i - 1].y * scaleY);
            const x2 = ann.path[i].x * scaleX;
            const y2 = height - (ann.path[i].y * scaleY);
            
            page.drawLine({
              start: { x: x1, y: y1 },
              end: { x: x2, y: y2 },
              thickness: strokeWidth,
              color: rgb(color.r / 255, color.g / 255, color.b / 255),
              opacity: opacity,
            });
          }
        } else if (ann.type === 'strikethrough' || ann.type === 'arrow') {
          // Draw straight line from start to end
          const start = ann.path[0];
          const end = ann.path[ann.path.length - 1];
          const x1 = start.x * scaleX;
          const y1 = height - (start.y * scaleY);
          const x2 = end.x * scaleX;
          const y2 = height - (end.y * scaleY);
          
          page.drawLine({
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            thickness: lineWidth,
            color: rgb(color.r / 255, color.g / 255, color.b / 255),
          });
          
          // Draw arrowhead for arrow type
          if (ann.type === 'arrow') {
            const angle = Math.atan2(y1 - y2, x2 - x1); // Note: y is inverted
            const headLen = ann.size * 4 * scaleX;
            
            // Arrowhead lines
            page.drawLine({
              start: { x: x2, y: y2 },
              end: { 
                x: x2 - headLen * Math.cos(angle - Math.PI / 6), 
                y: y2 + headLen * Math.sin(angle - Math.PI / 6) 
              },
              thickness: lineWidth,
              color: rgb(color.r / 255, color.g / 255, color.b / 255),
            });
            page.drawLine({
              start: { x: x2, y: y2 },
              end: { 
                x: x2 - headLen * Math.cos(angle + Math.PI / 6), 
                y: y2 + headLen * Math.sin(angle + Math.PI / 6) 
              },
              thickness: lineWidth,
              color: rgb(color.r / 255, color.g / 255, color.b / 255),
            });
          }
        }
      }
    }
  }
  
  // Save the modified PDF
  return await pdfDoc.save();
}

// Convert hex color to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 0, b: 0 };
}

function wrapTextToLines(font, text, fontSize, maxWidth) {
  const paragraphs = String(text || '').split('\n');
  const lines = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let line = '';

    const pushLine = () => {
      if (line.length > 0) lines.push(line);
      line = '';
    };

    const breakLongWord = (word) => {
      let chunk = '';
      for (const ch of word) {
        const candidate = chunk + ch;
        if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = candidate;
        }
      }
      if (chunk) lines.push(chunk);
    };

    for (const word of words) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;

      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
        continue;
      }

      if (line) {
        pushLine();
      }

      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        line = word;
      } else {
        breakLongWord(word);
      }
    }

    if (line) lines.push(line);
  }

  // Trim leading/trailing empty lines
  while (lines.length && !String(lines[0]).trim()) lines.shift();
  while (lines.length && !String(lines[lines.length - 1]).trim()) lines.pop();

  return lines.length ? lines : [''];
}

function fitWrappedTextToBox(font, text, startFontSize, maxWidth, maxHeight) {
  const minSize = 5;
  const maxSize = Math.max(minSize, Math.min(18, startFontSize || 12));

  const fits = (size) => {
    const lineHeight = size * 1.25;
    const lines = wrapTextToLines(font, text, size, maxWidth);
    const heightNeeded = lines.length * lineHeight;
    return { ok: heightNeeded <= maxHeight, lines, lineHeight };
  };

  // If it already fits, try to grow slightly up to maxSize (for better match)
  let best = fits(maxSize);
  if (best.ok) {
    return { fontSize: maxSize, lines: best.lines, lineHeight: best.lineHeight };
  }

  // Binary search downwards to find the largest size that fits
  let lo = minSize;
  let hi = maxSize;
  let bestOk = null;

  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const res = fits(mid);
    if (res.ok) {
      bestOk = { fontSize: mid, lines: res.lines, lineHeight: res.lineHeight };
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (bestOk) {
    // Round to 0.25 for stability
    bestOk.fontSize = Math.max(minSize, Math.round(bestOk.fontSize * 4) / 4);
    bestOk.lineHeight = bestOk.fontSize * 1.25;
    bestOk.lines = wrapTextToLines(font, text, bestOk.fontSize, maxWidth);
    return bestOk;
  }

  const fallbackSize = minSize;
  const fallbackLines = wrapTextToLines(font, text, fallbackSize, maxWidth);
  return { fontSize: fallbackSize, lines: fallbackLines, lineHeight: fallbackSize * 1.25 };
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = String(dataUrl || '').split(',')[1] || '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = dataUrl;
  });
}

function wrapCanvasText(ctx, text, maxWidth) {
  const paragraphs = String(text || '').replace(/\r/g, '').split('\n');
  const lines = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/\s+/);
    let line = '';

    const pushLine = () => {
      if (line) lines.push(line);
      line = '';
    };

    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
      } else {
        if (line) pushLine();

        // If a single word is too long, break it
        if (ctx.measureText(w).width > maxWidth) {
          let chunk = '';
          for (const ch of w) {
            const next = chunk + ch;
            if (ctx.measureText(next).width > maxWidth && chunk) {
              lines.push(chunk);
              chunk = ch;
            } else {
              chunk = next;
            }
          }
          if (chunk) lines.push(chunk);
          line = '';
        } else {
          line = w;
        }
      }
    }

    if (line) lines.push(line);
  }

  while (lines.length && !String(lines[0]).trim()) lines.shift();
  while (lines.length && !String(lines[lines.length - 1]).trim()) lines.pop();

  return lines.length ? lines : [''];
}

function fitCanvasTextToBox(ctx, text, startSize, maxW, maxH, format) {
  const minSize = 6;
  const maxSize = Math.max(minSize, Math.min(24, startSize || 14));

  const fits = (size) => {
    ctx.font = `${format && format.bold ? '700' : '400'} ${size}px Arial`;
    const lines = wrapCanvasText(ctx, text, maxW);
    const lineHeight = size * 1.25;
    return { ok: lines.length * lineHeight <= maxH, lines, lineHeight };
  };

  let best = fits(maxSize);
  if (best.ok) return { fontSize: maxSize, lines: best.lines, lineHeight: best.lineHeight };

  let lo = minSize;
  let hi = maxSize;
  let bestOk = null;

  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const res = fits(mid);
    if (res.ok) {
      bestOk = { fontSize: mid, lines: res.lines, lineHeight: res.lineHeight };
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (bestOk) {
    const rounded = Math.max(minSize, Math.round(bestOk.fontSize * 4) / 4);
    ctx.font = `${format && format.bold ? '700' : '400'} ${rounded}px Arial`;
    return {
      fontSize: rounded,
      lines: wrapCanvasText(ctx, text, maxW),
      lineHeight: rounded * 1.25,
    };
  }

  ctx.font = `${format && format.bold ? '700' : '400'} ${minSize}px Arial`;
  return { fontSize: minSize, lines: wrapCanvasText(ctx, text, maxW), lineHeight: minSize * 1.25 };
}

// Detect dominant text color from an image (non-white, non-light colors)
async function detectDominantTextColor(imageDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxSize = 100; // Sample at reduced size for performance
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.floor(img.width * scale));
        canvas.height = Math.max(1, Math.floor(img.height * scale));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Count colors, excluding near-white and near-black
        const colorCounts = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          
          if (a < 128) continue; // Skip transparent pixels
          
          // Calculate luminance
          const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
          
          // Skip very light colors (background) and very dark (likely black text)
          if (luminance > 240) continue; // Skip white/near-white
          
          // Quantize to reduce color variations
          const qr = Math.round(r / 32) * 32;
          const qg = Math.round(g / 32) * 32;
          const qb = Math.round(b / 32) * 32;
          
          // Check if this is a "colored" pixel (not grayscale)
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const saturation = maxC > 0 ? (maxC - minC) / maxC : 0;
          
          // Only count if it has some saturation (is colored) or is dark
          if (saturation > 0.15 || luminance < 50) {
            const key = `${qr},${qg},${qb}`;
            colorCounts[key] = (colorCounts[key] || 0) + 1;
          }
        }
        
        // Find the most common non-background color
        let maxCount = 0;
        let dominantColor = null;
        for (const [key, count] of Object.entries(colorCounts)) {
          if (count > maxCount) {
            maxCount = count;
            dominantColor = key;
          }
        }
        
        if (dominantColor && maxCount > 10) {
          const [r, g, b] = dominantColor.split(',').map(Number);
          const hex = '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
          resolve(hex);
        } else {
          resolve('#000000'); // Default to black
        }
      } catch (e) {
        console.warn('Color detection failed:', e);
        resolve('#000000');
      }
    };
    img.onerror = () => resolve('#000000');
    img.src = imageDataUrl;
  });
}

function openEditorDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pdfia_editor', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('editedPdfs')) {
        db.createObjectStore('editedPdfs', { keyPath: 'jobId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistPdfBytes(jobId, pdfBytes) {
  const db = await openEditorDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('editedPdfs', 'readwrite');
    const store = tx.objectStore('editedPdfs');
    const req = store.put({ jobId, pdfBytes, updatedAt: Date.now() });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function loadPersistedPdfBytes(jobId) {
  try {
    const db = await openEditorDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('editedPdfs', 'readonly');
      const store = tx.objectStore('editedPdfs');
      const req = store.get(jobId);
      req.onsuccess = () => resolve(req.result ? req.result.pdfBytes : null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to load persisted PDF:', e);
    return null;
  }
}

async function renderEditedTextRegionPng(backgroundDataUrl, newText) {
  const format = arguments.length >= 3 ? arguments[2] : null;
  const img = await loadImageFromDataUrl(backgroundDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  const pad = Math.max(4, Math.round(Math.min(w, h) * 0.06));

  ctx.fillStyle = 'white';
  ctx.fillRect(pad, pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2));

  const maxW = Math.max(1, w - pad * 2);
  const maxH = Math.max(1, h - pad * 2);

  const startSize = (format && typeof format.fontSize === 'number') ? format.fontSize : 16;
  const fitted = fitCanvasTextToBox(ctx, String(newText || ''), startSize, maxW, maxH, format);
  // Use the color from format, default to black
  const textColor = (format && format.color) || '#000000';
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'top';
  ctx.font = `${format && format.bold ? '700' : '400'} ${fitted.fontSize}px Arial`;

  let y = pad;
  for (const line of fitted.lines) {
    if (y + fitted.fontSize > h - pad) break;
    ctx.fillText(line, pad, y);
    y += fitted.lineHeight;
  }

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

async function renderEditedTableRegionPng(backgroundDataUrl, rows) {
  const img = await loadImageFromDataUrl(backgroundDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  const pad = Math.max(4, Math.round(Math.min(w, h) * 0.03));

  const safeRows = Array.isArray(rows) ? rows : [];
  const rowCount = Math.max(safeRows.length, 1);
  const colCount = Math.max(1, ...safeRows.map((r) => (Array.isArray(r) ? r.length : 0)));

  const areaX = pad;
  const areaY = pad;
  const areaW = Math.max(1, w - pad * 2);
  const areaH = Math.max(1, h - pad * 2);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(areaX, areaY, areaW, areaH);

  const cellW = areaW / colCount;
  const cellH = areaH / rowCount;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.85)';
  ctx.lineWidth = Math.max(1, Math.round(Math.min(w, h) * 0.0025));

  for (let c = 0; c <= colCount; c++) {
    const x = areaX + c * cellW;
    ctx.beginPath();
    ctx.moveTo(x, areaY);
    ctx.lineTo(x, areaY + areaH);
    ctx.stroke();
  }

  for (let r = 0; r <= rowCount; r++) {
    const y = areaY + r * cellH;
    ctx.beginPath();
    ctx.moveTo(areaX, y);
    ctx.lineTo(areaX + areaW, y);
    ctx.stroke();
  }

  const cellPad = Math.max(3, Math.round(Math.min(cellW, cellH) * 0.08));
  ctx.fillStyle = '#0f172a';
  ctx.textBaseline = 'top';

  for (let r = 0; r < rowCount; r++) {
    for (let c = 0; c < colCount; c++) {
      const raw = (safeRows[r] && safeRows[r][c]) != null ? String(safeRows[r][c]) : '';
      const text = raw.trim();
      if (!text) continue;

      const x = areaX + c * cellW + cellPad;
      const y = areaY + r * cellH + cellPad;
      const maxW = Math.max(1, cellW - cellPad * 2);
      const maxH = Math.max(1, cellH - cellPad * 2);

      const fitted = fitCanvasTextToBox(ctx, text, 14, maxW, maxH);
      ctx.font = `${fitted.fontSize}px Arial`;

      let yy = y;
      for (const line of fitted.lines) {
        if (yy + fitted.fontSize > y + maxH) break;
        ctx.fillText(line, x, yy);
        yy += fitted.lineHeight;
      }
    }
  }

  return dataUrlToUint8Array(canvas.toDataURL('image/png'));
}

// Show the modified PDF in a modal
function showFinalPreview(pdfUrl) {
  const modal = document.getElementById('pdf-preview-modal');
  const iframe = document.getElementById('pdf-preview-iframe');
  
  if (modal && iframe) {
    iframe.src = pdfUrl;
    modal.classList.remove('hidden');
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
  }
}

// Close the PDF preview modal
function closePdfPreviewModal() {
  const modal = document.getElementById('pdf-preview-modal');
  const iframe = document.getElementById('pdf-preview-iframe');
  
  if (modal) {
    modal.classList.add('hidden');
  }
  if (iframe) {
    iframe.src = '';
  }
  document.documentElement.classList.remove('modal-open');
  document.body.classList.remove('modal-open');
}

// Expose functions globally for onclick handlers in HTML
window.saveChangesPersistently = saveChangesPersistently;
window.downloadModifiedPdf = downloadModifiedPdf;
window.openPdfPreviewInNewTab = openPdfPreviewInNewTab;
window.closePdfPreviewModal = closePdfPreviewModal;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocumentEditor);
} else {
  initDocumentEditor();
}
