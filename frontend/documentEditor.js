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
  pdfCtx: null,
  overlayCtx: null,
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentSelection: null,
  jobId: null,
  fileUrl: null,
  rendering: false,
  contentBlocks: [], // Array of extracted content blocks
  blockIdCounter: 0
};

// Track if editor has been initialized
let editorInitialized = false;

// Initialize editor when DOM is ready
function initDocumentEditor() {
  if (editorInitialized) return;
  
  editorState.pdfCanvas = document.getElementById('editor-pdf-canvas');
  editorState.overlayCanvas = document.getElementById('editor-overlay-canvas');
  
  if (!editorState.pdfCanvas || !editorState.overlayCanvas) {
    console.log('Editor canvases not found, will retry on tab switch');
    return;
  }
  
  editorState.pdfCtx = editorState.pdfCanvas.getContext('2d');
  editorState.overlayCtx = editorState.overlayCanvas.getContext('2d');
  
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
  
  // Canvas mouse events for selection
  editorState.overlayCanvas.addEventListener('mousedown', editorStartSelection);
  editorState.overlayCanvas.addEventListener('mousemove', editorDrawSelection);
  editorState.overlayCanvas.addEventListener('mouseup', editorEndSelection);
  editorState.overlayCanvas.addEventListener('mouseleave', editorEndSelection);
  
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
    
    // Determine content type and add block
    if (result.tables && result.tables.length > 0) {
      // Add table blocks
      result.tables.forEach(table => {
        addContentBlock('table', result.text, result.cropped_image, table);
      });
    } else {
      // Add text block
      addContentBlock('text', result.text || '', result.cropped_image);
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
function addContentBlock(type, text, imageBase64, tableData = null) {
  const blockId = ++editorState.blockIdCounter;
  
  const block = {
    id: blockId,
    type: type, // 'text', 'table', 'image'
    text: text || '',
    image: imageBase64 || null,
    table: tableData || null,
    page: editorState.currentPage
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
      if (block) block.text = e.target.value;
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

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocumentEditor);
} else {
  initDocumentEditor();
}
