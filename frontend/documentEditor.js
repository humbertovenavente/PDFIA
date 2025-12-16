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
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentSelection: null,
  jobId: null,
  fileUrl: null,
  rendering: false,
  contentBlocks: [], // Array of extracted content blocks
  blockIdCounter: 0,
  // Annotation state
  currentTool: 'select', // 'select', 'draw', 'highlight', 'strikethrough', 'text', 'arrow', 'eraser'
  annotationColor: '#ff0000',
  annotationSize: 4,
  annotations: {}, // Per-page annotations: { pageNum: [annotation objects] }
  annotationHistory: {}, // For undo: { pageNum: [[state1], [state2], ...] }
  isAnnotating: false,
  currentPath: [] // Current drawing path
};

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
  if (editorState.annotationCanvas) {
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
  
  // Canvas mouse events for selection and annotation
  editorState.overlayCanvas.addEventListener('mousedown', handleCanvasMouseDown);
  editorState.overlayCanvas.addEventListener('mousemove', handleCanvasMouseMove);
  editorState.overlayCanvas.addEventListener('mouseup', handleCanvasMouseUp);
  editorState.overlayCanvas.addEventListener('mouseleave', handleCanvasMouseUp);
  // Important: capture mouseup even if the user releases outside the canvas
  window.addEventListener('mouseup', handleCanvasMouseUp);
  
  // Annotation tool buttons
  initAnnotationTools();
  
  // Save & Preview button
  const btnSave = document.getElementById('btn-save-changes');
  if (btnSave) btnSave.addEventListener('click', saveAndPreview);
  
  // Download PDF button
  const btnDownload = document.getElementById('btn-download-pdf');
  if (btnDownload) btnDownload.addEventListener('click', downloadModifiedPdf);
  
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
  
  const loading = document.getElementById('editor-loading');
  if (loading) loading.classList.remove('hidden');
  
  // Clear content list
  renderContentList();
  clearEditorSelection();
  
  try {
    // Get the file URL from the API
    const API_BASE = window.API_BASE || 'http://localhost:7071/api';
    const fileUrl = `${API_BASE.replace(/\/api$/, '')}/api/jobs/${job.id}/file`;
    editorState.fileUrl = fileUrl;
    
    // Load PDF with pdf.js
    const loadingTask = pdfjsLib.getDocument(fileUrl);
    editorState.pdfDoc = await loadingTask.promise;
    editorState.totalPages = editorState.pdfDoc.numPages;
    
    // Update page indicator
    document.getElementById('editor-total-pages').textContent = editorState.totalPages;
    
    // Render first page
    await editorRenderPage(1);
    
  } catch (error) {
    console.error('Error loading document:', error);
    if (typeof showToast === 'function') showToast('Failed to load document');
  } finally {
    if (loading) loading.classList.add('hidden');
  }
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
    if (editorState.annotationCanvas) {
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
  }
}

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
    
    // Determine content type and add block
    if (result.tables && result.tables.length > 0) {
      // Add table blocks
      result.tables.forEach(table => {
        addContentBlock('table', result.text, result.cropped_image, table, regionInfo);
      });
    } else {
      // Add text block
      addContentBlock('text', result.text || '', result.cropped_image, null, regionInfo);
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
function addContentBlock(type, text, imageBase64, tableData = null, regionInfo = null) {
  const blockId = ++editorState.blockIdCounter;
  
  const block = {
    id: blockId,
    type: type, // 'text', 'table', 'image'
    text: text || '',
    originalText: text || '', // Keep original for comparison
    image: imageBase64 || null,
    table: tableData || null,
    page: regionInfo ? regionInfo.page : editorState.currentPage,
    region: regionInfo // Store position for PDF modification
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
  
  if (block.image) {
    bodyContent += `<img src="${block.image}" alt="Extracted region" class="block-preview-image" />`;
  }
  
  if (block.type === 'table' && block.table) {
    bodyContent += renderEditableTable(block.table, block.id);
  } else {
    bodyContent += `<textarea class="block-text-editor" data-block-id="${block.id}" placeholder="Enter text...">${escapeHtmlEditor(block.text)}</textarea>`;
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
  
  tools.forEach(tool => {
    const btn = document.getElementById(`btn-tool-${tool}`);
    if (btn) {
      btn.addEventListener('click', () => setAnnotationTool(tool));
    }
  });
  
  // Color picker
  const colorPicker = document.getElementById('annotation-color');
  if (colorPicker) {
    colorPicker.addEventListener('input', (e) => {
      editorState.annotationColor = e.target.value;
    });
  }
  
  // Size selector
  const sizeSelector = document.getElementById('annotation-size');
  if (sizeSelector) {
    sizeSelector.addEventListener('change', (e) => {
      editorState.annotationSize = parseInt(e.target.value);
    });
  }
  
  // Undo button
  const btnUndo = document.getElementById('btn-undo-annotation');
  if (btnUndo) {
    btnUndo.addEventListener('click', undoAnnotation);
  }
  
  // Clear all button
  const btnClear = document.getElementById('btn-clear-annotations');
  if (btnClear) {
    btnClear.addEventListener('click', clearAllAnnotations);
  }
}

// Set the current annotation tool
function setAnnotationTool(tool) {
  editorState.currentTool = tool;
  
  // Update button states
  document.querySelectorAll('.btn-annotation').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`btn-tool-${tool}`);
  if (activeBtn) activeBtn.classList.add('active');
  
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
  const tool = editorState.currentTool;
  
  if (tool === 'select') {
    editorDrawSelection(e);
  } else if (tool !== 'text' && tool !== 'eraser') {
    drawAnnotation(e);
  }
}

function handleCanvasMouseUp(e) {
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
    
    if (typeof showToast === 'function') showToast('Preview generated! Check Final Preview tab');
    
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
  
  // Fetch original PDF
  const response = await fetch(editorState.fileUrl);
  const originalPdfBytes = await response.arrayBuffer();
  
  // Load with pdf-lib
  const { PDFDocument, rgb, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
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
      
      // Draw white rectangle to cover original text
      page.drawRectangle({
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
        color: rgb(1, 1, 1), // White
      });
      
      // Calculate font size to match original text density
      // Estimate based on original text length and region size
      const originalLines = block.originalText.split('\n').filter(l => l.trim());
      const newLines = block.text.split('\n').filter(l => l.trim());
      const lineCount = Math.max(originalLines.length, newLines.length, 1);
      
      // Calculate font size based on region height and number of lines
      const lineHeight = pdfHeight / lineCount;
      const fontSize = Math.min(Math.max(lineHeight * 0.75, 6), 14); // Between 6 and 14pt
      
      // Draw the new text with proper formatting
      let currentY = pdfY + pdfHeight - fontSize - 2; // Start from top with small padding
      
      for (const line of newLines) {
        if (currentY < pdfY) break; // Don't draw outside the region
        
        // Center text horizontally if it's short, otherwise left-align
        const textWidth = font.widthOfTextAtSize(line, fontSize);
        let textX = pdfX + 2;
        if (textWidth < pdfWidth * 0.7) {
          // Center short text
          textX = pdfX + (pdfWidth - textWidth) / 2;
        }
        
        page.drawText(line, {
          x: textX,
          y: currentY,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
        currentY -= fontSize * 1.3; // Line spacing
      }
      
      console.log('Text replacement applied at', { pdfX, pdfY, pdfWidth, pdfHeight, fontSize, lineCount });
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
    const colCount = Math.max(
      1,
      ...rows.map((r) => (Array.isArray(r) ? r.length : 0))
    );

    const cellW = pdfWidth / colCount;
    const cellH = pdfHeight / rowCount;

    // White background to cover the original table region
    page.drawRectangle({
      x: pdfX,
      y: pdfY,
      width: pdfWidth,
      height: pdfHeight,
      color: rgb(1, 1, 1),
    });

    // Draw grid lines
    const gridColor = rgb(0.75, 0.75, 0.75);
    const gridThickness = Math.max(0.5, 0.8 * Math.min(scaleX, scaleY));

    // Vertical lines
    for (let c = 0; c <= colCount; c++) {
      const x = pdfX + c * cellW;
      page.drawLine({
        start: { x, y: pdfY },
        end: { x, y: pdfY + pdfHeight },
        thickness: gridThickness,
        color: gridColor,
      });
    }

    // Horizontal lines
    for (let r = 0; r <= rowCount; r++) {
      const y = pdfY + r * cellH;
      page.drawLine({
        start: { x: pdfX, y },
        end: { x: pdfX + pdfWidth, y },
        thickness: gridThickness,
        color: gridColor,
      });
    }

    // Cell text
    const baseFontSize = Math.min(Math.max(cellH * 0.45, 6), 12);
    const pad = Math.max(2, cellW * 0.03);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const raw = (rows[r] && rows[r][c]) != null ? String(rows[r][c]) : '';
        const text = raw.trim();
        if (!text) continue;

        const cellX = pdfX + c * cellW;
        // PDF y origin bottom; row 0 should be top row
        const cellTopY = pdfY + pdfHeight - r * cellH;
        const textY = cellTopY - baseFontSize - pad;
        let fontSize = baseFontSize;

        const availableW = Math.max(1, cellW - pad * 2);
        const measuredW = font.widthOfTextAtSize(text, fontSize);
        if (measuredW > availableW) {
          fontSize = Math.max(5, fontSize * (availableW / measuredW));
        }

        page.drawText(text, {
          x: cellX + pad,
          y: textY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
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

// Show the modified PDF in a modal
function showFinalPreview(pdfUrl) {
  const modal = document.getElementById('pdf-preview-modal');
  const iframe = document.getElementById('pdf-preview-iframe');
  
  if (modal && iframe) {
    iframe.src = pdfUrl;
    modal.classList.remove('hidden');
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
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocumentEditor);
} else {
  initDocumentEditor();
}
