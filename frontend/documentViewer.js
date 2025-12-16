/**
 * Document Viewer - PDF viewer with region selection and OCR extraction
 * This module handles the "Document" tab functionality
 */

// Document viewer state
const docViewerState = {
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
  rendering: false
};

// Initialize document viewer when DOM is ready
function initDocumentViewer() {
  docViewerState.pdfCanvas = document.getElementById('doc-pdf-canvas');
  docViewerState.overlayCanvas = document.getElementById('doc-overlay-canvas');
  
  if (!docViewerState.pdfCanvas || !docViewerState.overlayCanvas) return;
  
  docViewerState.pdfCtx = docViewerState.pdfCanvas.getContext('2d');
  docViewerState.overlayCtx = docViewerState.overlayCanvas.getContext('2d');
  
  // Zoom controls
  const btnZoomIn = document.getElementById('btn-doc-zoom-in');
  const btnZoomOut = document.getElementById('btn-doc-zoom-out');
  const btnFitWidth = document.getElementById('btn-doc-fit-width');
  
  if (btnZoomIn) btnZoomIn.addEventListener('click', () => docZoom(0.25));
  if (btnZoomOut) btnZoomOut.addEventListener('click', () => docZoom(-0.25));
  if (btnFitWidth) btnFitWidth.addEventListener('click', docFitWidth);
  
  // Page navigation
  const btnPrevPage = document.getElementById('btn-doc-prev-page');
  const btnNextPage = document.getElementById('btn-doc-next-page');
  
  if (btnPrevPage) btnPrevPage.addEventListener('click', () => docGoToPage(docViewerState.currentPage - 1));
  if (btnNextPage) btnNextPage.addEventListener('click', () => docGoToPage(docViewerState.currentPage + 1));
  
  // Selection/extraction
  const btnExtract = document.getElementById('btn-doc-extract-region');
  if (btnExtract) btnExtract.addEventListener('click', docExtractSelection);
  
  // Close extraction panel
  const btnClosePanel = document.getElementById('btn-close-doc-extraction');
  if (btnClosePanel) btnClosePanel.addEventListener('click', () => {
    document.getElementById('doc-extraction-panel')?.classList.add('hidden');
  });
  
  // Copy extracted text
  const btnCopyText = document.getElementById('btn-copy-doc-text');
  if (btnCopyText) btnCopyText.addEventListener('click', () => {
    const text = document.getElementById('doc-extracted-text')?.textContent || '';
    navigator.clipboard.writeText(text).then(() => {
      if (typeof showToast === 'function') showToast('Text copied to clipboard');
    });
  });
  
  // Download extracted image
  const btnDownloadImage = document.getElementById('btn-download-doc-image');
  if (btnDownloadImage) btnDownloadImage.addEventListener('click', docDownloadImage);
  
  // Canvas mouse events for selection
  docViewerState.overlayCanvas.addEventListener('mousedown', docStartSelection);
  docViewerState.overlayCanvas.addEventListener('mousemove', docDrawSelection);
  docViewerState.overlayCanvas.addEventListener('mouseup', docEndSelection);
  docViewerState.overlayCanvas.addEventListener('mouseleave', docEndSelection);
}

// Load PDF document for the Document tab
async function loadDocumentForViewer(job) {
  if (!job || !job.id) return;
  
  docViewerState.jobId = job.id;
  docViewerState.currentPage = 1;
  docViewerState.currentSelection = null;
  docViewerState.baseScale = 0; // Reset to recalculate on new document
  docViewerState.scale = 1.5;
  
  const loading = document.getElementById('doc-loading');
  if (loading) loading.classList.remove('hidden');
  
  // Clear previous selection
  clearDocSelection();
  
  try {
    // Get the file URL from the API
    const API_BASE = window.API_BASE || 'http://localhost:7071/api';
    const fileUrl = `${API_BASE.replace(/\/api$/, '')}/api/jobs/${job.id}/file`;
    docViewerState.fileUrl = fileUrl;
    
    // Load PDF with pdf.js
    const loadingTask = pdfjsLib.getDocument(fileUrl);
    docViewerState.pdfDoc = await loadingTask.promise;
    docViewerState.totalPages = docViewerState.pdfDoc.numPages;
    
    // Update page indicator
    document.getElementById('doc-total-pages').textContent = docViewerState.totalPages;
    
    // Render first page
    await docRenderPage(1);
    
  } catch (error) {
    console.error('Error loading document:', error);
    if (typeof showToast === 'function') showToast('Failed to load document');
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

// Render a specific page
async function docRenderPage(pageNum) {
  if (!docViewerState.pdfDoc || docViewerState.rendering) return;
  
  docViewerState.rendering = true;
  docViewerState.currentPage = pageNum;
  
  try {
    const page = await docViewerState.pdfDoc.getPage(pageNum);
    
    // Calculate scale to fit container width on first load
    if (docViewerState.baseScale === 0) {
      const container = document.querySelector('.document-workspace');
      if (container && container.clientWidth > 0) {
        const containerWidth = container.clientWidth - 60; // padding
        const viewport = page.getViewport({ scale: 1.0 });
        docViewerState.baseScale = Math.min(containerWidth / viewport.width, 2.0);
        docViewerState.scale = docViewerState.baseScale;
      } else {
        // Fallback if container not ready
        docViewerState.baseScale = 1.5;
        docViewerState.scale = 1.5;
      }
    }
    
    const viewport = page.getViewport({ scale: docViewerState.scale });
    
    // Set canvas dimensions
    docViewerState.pdfCanvas.width = viewport.width;
    docViewerState.pdfCanvas.height = viewport.height;
    docViewerState.overlayCanvas.width = viewport.width;
    docViewerState.overlayCanvas.height = viewport.height;
    
    // Render PDF page
    const renderContext = {
      canvasContext: docViewerState.pdfCtx,
      viewport: viewport
    };
    
    await page.render(renderContext).promise;
    
    // Update page indicator
    document.getElementById('doc-current-page').textContent = pageNum;
    
    // Update zoom level display
    const zoomPercent = Math.round((docViewerState.scale / docViewerState.baseScale) * 100);
    document.getElementById('doc-zoom-level').textContent = `${zoomPercent}%`;
    
    // Clear overlay
    docViewerState.overlayCtx.clearRect(0, 0, docViewerState.overlayCanvas.width, docViewerState.overlayCanvas.height);
    docViewerState.currentSelection = null;
    document.getElementById('btn-doc-extract-region').disabled = true;
    
  } catch (error) {
    console.error('Error rendering page:', error);
  } finally {
    docViewerState.rendering = false;
  }
}

// Zoom in/out
function docZoom(delta) {
  const newScale = docViewerState.scale + (docViewerState.baseScale * delta);
  if (newScale < docViewerState.baseScale * 0.25 || newScale > docViewerState.baseScale * 4) return;
  
  docViewerState.scale = newScale;
  docRenderPage(docViewerState.currentPage);
}

// Fit to container width
function docFitWidth() {
  docViewerState.scale = docViewerState.baseScale;
  docRenderPage(docViewerState.currentPage);
}

// Go to specific page
function docGoToPage(pageNum) {
  if (pageNum < 1 || pageNum > docViewerState.totalPages) return;
  docRenderPage(pageNum);
}

// Start selection
function docStartSelection(e) {
  docViewerState.isDrawing = true;
  const rect = docViewerState.overlayCanvas.getBoundingClientRect();
  docViewerState.startX = e.clientX - rect.left;
  docViewerState.startY = e.clientY - rect.top;
  docViewerState.currentSelection = null;
}

// Draw selection rectangle
function docDrawSelection(e) {
  if (!docViewerState.isDrawing) return;
  
  const rect = docViewerState.overlayCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  const x = Math.min(docViewerState.startX, currentX);
  const y = Math.min(docViewerState.startY, currentY);
  const width = Math.abs(currentX - docViewerState.startX);
  const height = Math.abs(currentY - docViewerState.startY);
  
  // Clear and redraw
  docViewerState.overlayCtx.clearRect(0, 0, docViewerState.overlayCanvas.width, docViewerState.overlayCanvas.height);
  
  // Draw selection rectangle
  docViewerState.overlayCtx.strokeStyle = '#6366f1';
  docViewerState.overlayCtx.lineWidth = 2;
  docViewerState.overlayCtx.setLineDash([5, 3]);
  docViewerState.overlayCtx.strokeRect(x, y, width, height);
  
  // Fill with semi-transparent color
  docViewerState.overlayCtx.fillStyle = 'rgba(99, 102, 241, 0.1)';
  docViewerState.overlayCtx.fillRect(x, y, width, height);
  
  docViewerState.overlayCtx.setLineDash([]);
}

// End selection
function docEndSelection(e) {
  if (!docViewerState.isDrawing) return;
  docViewerState.isDrawing = false;
  
  const rect = docViewerState.overlayCanvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  const x = Math.min(docViewerState.startX, currentX);
  const y = Math.min(docViewerState.startY, currentY);
  const width = Math.abs(currentX - docViewerState.startX);
  const height = Math.abs(currentY - docViewerState.startY);
  
  // Only save selection if it's large enough
  if (width > 10 && height > 10) {
    docViewerState.currentSelection = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      scale: docViewerState.scale
    };
    document.getElementById('btn-doc-extract-region').disabled = false;
  } else {
    clearDocSelection();
  }
}

// Clear selection
function clearDocSelection() {
  docViewerState.currentSelection = null;
  if (docViewerState.overlayCtx) {
    docViewerState.overlayCtx.clearRect(0, 0, docViewerState.overlayCanvas.width, docViewerState.overlayCanvas.height);
  }
  const btn = document.getElementById('btn-doc-extract-region');
  if (btn) btn.disabled = true;
}

// Extract text and image from selection
async function docExtractSelection() {
  if (!docViewerState.currentSelection || !docViewerState.pdfDoc) return;
  
  const sel = docViewerState.currentSelection;
  const loading = document.getElementById('doc-loading');
  const extractPanel = document.getElementById('doc-extraction-panel');
  const extractedText = document.getElementById('doc-extracted-text');
  const extractedImage = document.getElementById('doc-extracted-image');
  
  if (loading) loading.classList.remove('hidden');
  
  try {
    // Get the current page as an image
    const page = await docViewerState.pdfDoc.getPage(docViewerState.currentPage);
    
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
    const scaleFactor = ocrScale / docViewerState.scale;
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
    
    // Show extraction panel with results (both image and text)
    if (extractedText) {
      extractedText.textContent = result.text || '(No text found)';
    }
    
    // Show cropped image
    if (extractedImage && result.cropped_image) {
      extractedImage.src = result.cropped_image;
      extractedImage.style.display = 'block';
      // Store for download
      docViewerState.lastCroppedImage = result.cropped_image;
    } else if (extractedImage) {
      extractedImage.style.display = 'none';
      docViewerState.lastCroppedImage = null;
    }
    
    // Show extracted tables if any
    const tablesSection = document.getElementById('doc-tables-section');
    const tablesContainer = document.getElementById('doc-extracted-tables');
    if (result.tables && result.tables.length > 0 && tablesContainer) {
      tablesContainer.innerHTML = renderExtractedTables(result.tables);
      if (tablesSection) tablesSection.classList.remove('hidden');
    } else {
      if (tablesContainer) tablesContainer.innerHTML = '';
      if (tablesSection) tablesSection.classList.add('hidden');
    }
    
    if (extractPanel) {
      extractPanel.classList.remove('hidden');
    }
    
    if (typeof showToast === 'function') {
      const tableInfo = result.tables && result.tables.length > 0 ? ` (${result.tables.length} table(s))` : '';
      showToast(`Extracted using ${result.method || 'OCR'}${tableInfo}`);
    }
    
  } catch (error) {
    console.error('Error extracting text:', error);
    if (typeof showToast === 'function') showToast('Failed to extract text: ' + error.message);
  } finally {
    if (loading) loading.classList.add('hidden');
  }
}

// Render extracted tables as HTML
function renderExtractedTables(tables) {
  if (!tables || tables.length === 0) return '';
  
  return tables.map((table, idx) => {
    const rows = table.rows || [];
    if (rows.length === 0) return '';
    
    let html = `<table class="extracted-table">`;
    
    rows.forEach((row, rowIdx) => {
      html += '<tr>';
      (row || []).forEach((cell, colIdx) => {
        const tag = rowIdx === 0 ? 'th' : 'td';
        html += `<${tag}>${escapeHtmlDoc(cell || '')}</${tag}>`;
      });
      html += '</tr>';
    });
    
    html += '</table>';
    return html;
  }).join('');
}

// Escape HTML for safe rendering
function escapeHtmlDoc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Download the extracted/cropped image
function docDownloadImage() {
  if (!docViewerState.lastCroppedImage) {
    if (typeof showToast === 'function') showToast('No image to download');
    return;
  }
  
  const link = document.createElement('a');
  link.href = docViewerState.lastCroppedImage;
  link.download = `extracted_region_page${docViewerState.currentPage}_${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  if (typeof showToast === 'function') showToast('Image downloaded');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocumentViewer);
} else {
  initDocumentViewer();
}
