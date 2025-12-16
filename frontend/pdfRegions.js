// ===== PDF REGIONS MODULE =====
// Handles PDF preview with region detection and extraction

const pdfRegionsState = {
  pdfDoc: null,
  currentPage: 1,
  totalPages: 0,
  scale: 1.5,
  canvas: null,
  ctx: null,
  regions: [],
  selectedRegions: new Set(),
  isManualMode: false,
  isDrawing: false,
  drawStart: { x: 0, y: 0 },
  currentRect: null,
  imageDataUrl: null,
  jobFilePath: null
};

// Initialize PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Initialize the PDF regions tab
function initPdfRegions() {
  const canvas = document.getElementById('pdf-regions-canvas');
  if (!canvas) return;
  
  pdfRegionsState.canvas = canvas;
  pdfRegionsState.ctx = canvas.getContext('2d');
  
  // Bind toolbar buttons
  document.getElementById('btn-auto-detect')?.addEventListener('click', () => {
    setDetectionMode('auto');
    detectRegions();
  });
  
  document.getElementById('btn-manual-select')?.addEventListener('click', () => {
    setDetectionMode('manual');
  });
  
  document.getElementById('btn-extract-all')?.addEventListener('click', extractAllRegions);
  document.getElementById('btn-extract-selected')?.addEventListener('click', extractSelectedRegions);
  document.getElementById('btn-close-results')?.addEventListener('click', closeExtractionResults);
  
  // Page navigation
  document.getElementById('btn-prev-page')?.addEventListener('click', () => changePage(-1));
  document.getElementById('btn-next-page')?.addEventListener('click', () => changePage(1));
  
  // Canvas events for manual selection
  canvas.addEventListener('mousedown', handleCanvasMouseDown);
  canvas.addEventListener('mousemove', handleCanvasMouseMove);
  canvas.addEventListener('mouseup', handleCanvasMouseUp);
  canvas.addEventListener('mouseleave', handleCanvasMouseUp);
  
  // Click on regions
  canvas.addEventListener('click', handleCanvasClick);
}

// Load PDF or image for the current job
async function loadDocumentForRegions(job) {
  if (!job) return;
  
  const loading = document.getElementById('pdf-loading');
  if (loading) loading.style.display = 'flex';
  
  pdfRegionsState.regions = [];
  pdfRegionsState.selectedRegions.clear();
  pdfRegionsState.jobFilePath = job.file_path;
  
  try {
    // Check if we have extracted images in results
    if (job.results?._extracted_images?.length > 0) {
      // Use first extracted image
      const firstImage = job.results._extracted_images[0];
      if (firstImage.data_url) {
        await loadImageToCanvas(firstImage.data_url);
        pdfRegionsState.totalPages = job.results._extracted_images.length;
        updatePageNav();
        if (loading) loading.style.display = 'none';
        return;
      }
    }
    
    // Try to load from file path (would need backend endpoint)
    // For now, show message
    const canvas = pdfRegionsState.canvas;
    const ctx = pdfRegionsState.ctx;
    canvas.width = 600;
    canvas.height = 400;
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#6b7280';
    ctx.font = '16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Upload a document to preview it', canvas.width / 2, canvas.height / 2 - 20);
    ctx.fillText('and detect regions', canvas.width / 2, canvas.height / 2 + 10);
    
  } catch (error) {
    console.error('Error loading document:', error);
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

// Load image to canvas
async function loadImageToCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = pdfRegionsState.canvas;
      const ctx = pdfRegionsState.ctx;
      
      // Calculate scale to fit
      const maxWidth = 700;
      const maxHeight = 600;
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth) {
        const ratio = maxWidth / width;
        width = maxWidth;
        height = height * ratio;
      }
      if (height > maxHeight) {
        const ratio = maxHeight / height;
        height = height * ratio;
        width = width * ratio;
      }
      
      pdfRegionsState.scale = width / img.width;
      canvas.width = width;
      canvas.height = height;
      
      ctx.drawImage(img, 0, 0, width, height);
      pdfRegionsState.imageDataUrl = dataUrl;
      
      resolve();
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Set detection mode
function setDetectionMode(mode) {
  pdfRegionsState.isManualMode = mode === 'manual';
  
  document.getElementById('btn-auto-detect')?.classList.toggle('active', mode === 'auto');
  document.getElementById('btn-manual-select')?.classList.toggle('active', mode === 'manual');
  
  const canvas = pdfRegionsState.canvas;
  if (canvas) {
    canvas.style.cursor = mode === 'manual' ? 'crosshair' : 'pointer';
  }
}

// Detect regions using backend API
async function detectRegions() {
  if (!pdfRegionsState.imageDataUrl) {
    showToast('No image loaded to detect regions');
    return;
  }
  
  const regionsList = document.getElementById('regions-list');
  if (regionsList) {
    regionsList.innerHTML = `
      <div class="empty-state small">
        <div class="spinner"></div>
        <p>Detecting regions...</p>
      </div>
    `;
  }
  
  try {
    let base64 = pdfRegionsState.imageDataUrl;
    if (base64.includes(',')) {
      base64 = base64.split(',')[1];
    }
    
    const response = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/detect-regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        image_base64: base64,
        detect_visual: true
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    pdfRegionsState.regions = result.regions || [];
    renderRegionsList();
    redrawCanvas();
    
    showToast(`${pdfRegionsState.regions.length} regions detected`);
    
  } catch (error) {
    console.error('Error detecting regions:', error);
    if (regionsList) {
      regionsList.innerHTML = `
        <div class="empty-state small">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Failed to detect regions</p>
        </div>
      `;
    }
    showToast('Failed to detect regions');
  }
}

// Render regions list in sidebar
function renderRegionsList() {
  const regionsList = document.getElementById('regions-list');
  const regionsCount = document.getElementById('regions-count');
  
  if (!regionsList) return;
  
  const regions = pdfRegionsState.regions;
  
  if (regionsCount) {
    regionsCount.textContent = regions.length;
  }
  
  if (regions.length === 0) {
    regionsList.innerHTML = `
      <div class="empty-state small">
        <i class="fas fa-search"></i>
        <p>No regions found</p>
      </div>
    `;
    return;
  }
  
  const getTypeLabel = (region) => {
    if (region.type === 'text') return { label: 'Text', class: 'text' };
    if (region.type === 'mixed') return { label: 'Mixed', class: 'mixed' };
    if (region.is_visual) return { label: 'Visual', class: 'visual' };
    return { label: 'Region', class: 'text' };
  };
  
  regionsList.innerHTML = regions.map((region, idx) => {
    const typeInfo = getTypeLabel(region);
    const isSelected = pdfRegionsState.selectedRegions.has(idx);
    const preview = region.text ? region.text.substring(0, 50) + (region.text.length > 50 ? '...' : '') : 'No text detected';
    
    return `
      <div class="region-item ${isSelected ? 'selected' : ''}" data-idx="${idx}" onclick="toggleRegionSelection(${idx})">
        <div class="region-checkbox">
          ${isSelected ? '<i class="fas fa-check"></i>' : ''}
        </div>
        <div class="region-info">
          <div class="region-label">
            Region ${idx + 1}
            <span class="region-type ${typeInfo.class}">${typeInfo.label}</span>
          </div>
          <div class="region-preview">${escapeHtml(preview)}</div>
          <div class="region-size">${region.width}×${region.height}px</div>
        </div>
      </div>
    `;
  }).join('');
  
  updateExtractButton();
}

// Toggle region selection
function toggleRegionSelection(idx) {
  if (pdfRegionsState.selectedRegions.has(idx)) {
    pdfRegionsState.selectedRegions.delete(idx);
  } else {
    pdfRegionsState.selectedRegions.add(idx);
  }
  
  // Update UI
  const item = document.querySelector(`.region-item[data-idx="${idx}"]`);
  if (item) {
    item.classList.toggle('selected', pdfRegionsState.selectedRegions.has(idx));
    const checkbox = item.querySelector('.region-checkbox');
    if (checkbox) {
      checkbox.innerHTML = pdfRegionsState.selectedRegions.has(idx) ? '<i class="fas fa-check"></i>' : '';
    }
  }
  
  updateExtractButton();
  redrawCanvas();
}

// Update extract button state
function updateExtractButton() {
  const btn = document.getElementById('btn-extract-selected');
  if (btn) {
    btn.disabled = pdfRegionsState.selectedRegions.size === 0;
    const count = pdfRegionsState.selectedRegions.size;
    btn.innerHTML = `
      <i class="fas fa-file-export"></i>
      <span>Extract ${count > 0 ? `(${count})` : 'Selected'}</span>
    `;
  }
}

// Redraw canvas with regions
function redrawCanvas() {
  const { canvas, ctx, regions, selectedRegions, scale, currentRect } = pdfRegionsState;
  if (!canvas || !pdfRegionsState.imageDataUrl) return;
  
  // Reload image
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    // Draw detected regions
    regions.forEach((region, idx) => {
      const isSelected = selectedRegions.has(idx);
      const x = region.x * scale;
      const y = region.y * scale;
      const w = region.width * scale;
      const h = region.height * scale;
      
      // Region color based on type
      let color = '#10b981'; // green for text
      if (region.type === 'mixed') color = '#3b82f6'; // blue for mixed
      else if (region.is_visual) color = '#f59e0b'; // orange for visual
      
      // Draw rectangle
      ctx.strokeStyle = isSelected ? '#ef4444' : color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.setLineDash(isSelected ? [] : [5, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      
      // Draw label
      if (!isSelected) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 24, 18);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText(`${idx + 1}`, x + 6, y + 13);
      } else {
        // Selected indicator
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(x, y, 24, 18);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.fillText('✓', x + 6, y + 13);
      }
    });
    
    // Draw current manual selection
    if (currentRect) {
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height);
      ctx.setLineDash([]);
      
      // Semi-transparent fill
      ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
      ctx.fillRect(currentRect.x, currentRect.y, currentRect.width, currentRect.height);
    }
  };
  img.src = pdfRegionsState.imageDataUrl;
}

// Canvas event handlers
function handleCanvasMouseDown(e) {
  if (!pdfRegionsState.isManualMode) return;
  
  const rect = pdfRegionsState.canvas.getBoundingClientRect();
  pdfRegionsState.isDrawing = true;
  pdfRegionsState.drawStart = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
  pdfRegionsState.currentRect = null;
}

function handleCanvasMouseMove(e) {
  if (!pdfRegionsState.isDrawing || !pdfRegionsState.isManualMode) return;
  
  const rect = pdfRegionsState.canvas.getBoundingClientRect();
  const currentX = e.clientX - rect.left;
  const currentY = e.clientY - rect.top;
  
  const x = Math.min(pdfRegionsState.drawStart.x, currentX);
  const y = Math.min(pdfRegionsState.drawStart.y, currentY);
  const width = Math.abs(currentX - pdfRegionsState.drawStart.x);
  const height = Math.abs(currentY - pdfRegionsState.drawStart.y);
  
  pdfRegionsState.currentRect = { x, y, width, height };
  redrawCanvas();
}

function handleCanvasMouseUp(e) {
  if (!pdfRegionsState.isDrawing || !pdfRegionsState.isManualMode) return;
  
  pdfRegionsState.isDrawing = false;
  
  if (pdfRegionsState.currentRect && 
      pdfRegionsState.currentRect.width > 10 && 
      pdfRegionsState.currentRect.height > 10) {
    
    // Add manual region
    const scale = pdfRegionsState.scale;
    const newRegion = {
      id: `manual_${Date.now()}`,
      x: Math.round(pdfRegionsState.currentRect.x / scale),
      y: Math.round(pdfRegionsState.currentRect.y / scale),
      width: Math.round(pdfRegionsState.currentRect.width / scale),
      height: Math.round(pdfRegionsState.currentRect.height / scale),
      type: 'manual',
      text: '',
      confidence: 100,
      is_visual: false
    };
    
    pdfRegionsState.regions.push(newRegion);
    pdfRegionsState.selectedRegions.add(pdfRegionsState.regions.length - 1);
    
    renderRegionsList();
    showToast('Manual region added');
  }
  
  pdfRegionsState.currentRect = null;
  redrawCanvas();
}

function handleCanvasClick(e) {
  if (pdfRegionsState.isManualMode) return;
  
  const rect = pdfRegionsState.canvas.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) / pdfRegionsState.scale;
  const clickY = (e.clientY - rect.top) / pdfRegionsState.scale;
  
  // Find clicked region
  for (let i = 0; i < pdfRegionsState.regions.length; i++) {
    const region = pdfRegionsState.regions[i];
    if (clickX >= region.x && clickX <= region.x + region.width &&
        clickY >= region.y && clickY <= region.y + region.height) {
      toggleRegionSelection(i);
      return;
    }
  }
}

// Page navigation
function changePage(delta) {
  const newPage = pdfRegionsState.currentPage + delta;
  if (newPage < 1 || newPage > pdfRegionsState.totalPages) return;
  
  pdfRegionsState.currentPage = newPage;
  updatePageNav();
  
  // Load the new page image if available
  if (state.currentResults?._extracted_images) {
    const pageImage = state.currentResults._extracted_images[newPage - 1];
    if (pageImage?.data_url) {
      loadImageToCanvas(pageImage.data_url).then(() => {
        pdfRegionsState.regions = [];
        pdfRegionsState.selectedRegions.clear();
        renderRegionsList();
        redrawCanvas();
      });
    }
  }
}

function updatePageNav() {
  document.getElementById('current-page').textContent = pdfRegionsState.currentPage;
  document.getElementById('total-pages').textContent = pdfRegionsState.totalPages || 1;
  
  document.getElementById('btn-prev-page').disabled = pdfRegionsState.currentPage <= 1;
  document.getElementById('btn-next-page').disabled = pdfRegionsState.currentPage >= pdfRegionsState.totalPages;
}

// Extract all regions
async function extractAllRegions() {
  // Select all regions
  pdfRegionsState.regions.forEach((_, idx) => {
    pdfRegionsState.selectedRegions.add(idx);
  });
  renderRegionsList();
  redrawCanvas();
  
  await extractSelectedRegions();
}

// Extract selected regions
async function extractSelectedRegions() {
  const selectedIndices = Array.from(pdfRegionsState.selectedRegions);
  if (selectedIndices.length === 0) {
    showToast('Select at least one region');
    return;
  }
  
  const resultsContainer = document.getElementById('extraction-results');
  const resultsContent = document.getElementById('extraction-results-content');
  
  if (resultsContainer) resultsContainer.style.display = 'block';
  if (resultsContent) {
    resultsContent.innerHTML = `
      <div class="empty-state small">
        <div class="spinner"></div>
        <p>Extracting ${selectedIndices.length} region(s)...</p>
      </div>
    `;
  }
  
  try {
    let base64 = pdfRegionsState.imageDataUrl;
    if (base64.includes(',')) {
      base64 = base64.split(',')[1];
    }
    
    const results = [];
    
    for (const idx of selectedIndices) {
      const region = pdfRegionsState.regions[idx];
      
      const response = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/roi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64,
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          prefer_method: 'auto'
        })
      });
      
      const result = await response.json();
      results.push({
        idx,
        region,
        text: result.text || '',
        cropped_image: result.cropped_image || null,
        error: result.error
      });
    }
    
    renderExtractionResults(results);
    showToast(`Extracted ${results.length} region(s)`);
    
  } catch (error) {
    console.error('Error extracting regions:', error);
    if (resultsContent) {
      resultsContent.innerHTML = `
        <div class="empty-state small">
          <i class="fas fa-exclamation-triangle"></i>
          <p>Failed to extract regions</p>
        </div>
      `;
    }
    showToast('Failed to extract regions');
  }
}

// Render extraction results
function renderExtractionResults(results) {
  const resultsContent = document.getElementById('extraction-results-content');
  if (!resultsContent) return;
  
  resultsContent.innerHTML = results.map((result, i) => `
    <div class="result-item">
      <div class="result-item-header">
        <span class="result-item-title">
          <i class="fas fa-vector-square"></i>
          Region ${result.idx + 1}
          <span class="region-type ${result.region.type === 'text' ? 'text' : 'visual'}">${result.region.type || 'manual'}</span>
        </span>
        <div class="result-item-actions">
          <button class="btn-tool" onclick="copyResultText(${i})" title="Copy text">
            <i class="fas fa-copy"></i>
          </button>
          ${result.cropped_image ? `
            <button class="btn-tool" onclick="downloadResultImage(${i})" title="Download image">
              <i class="fas fa-download"></i>
            </button>
          ` : ''}
        </div>
      </div>
      <div class="result-text" id="result-text-${i}">${escapeHtml(result.text || '(No text detected)')}</div>
      ${result.cropped_image ? `
        <div class="result-image">
          <img src="${result.cropped_image}" alt="Region ${result.idx + 1}" id="result-img-${i}" />
        </div>
      ` : ''}
    </div>
  `).join('');
  
  // Store results for copy/download
  window._extractionResults = results;
}

// Copy result text
function copyResultText(idx) {
  const results = window._extractionResults;
  if (!results || !results[idx]) return;
  
  navigator.clipboard.writeText(results[idx].text || '').then(() => {
    showToast('Text copied to clipboard');
  });
}

// Download result image
function downloadResultImage(idx) {
  const results = window._extractionResults;
  if (!results || !results[idx] || !results[idx].cropped_image) return;
  
  const link = document.createElement('a');
  link.href = results[idx].cropped_image;
  link.download = `region_${results[idx].idx + 1}_${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Image downloaded');
}

// Close extraction results
function closeExtractionResults() {
  const resultsContainer = document.getElementById('extraction-results');
  if (resultsContainer) resultsContainer.style.display = 'none';
}

// Escape HTML helper
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions globally available
window.toggleRegionSelection = toggleRegionSelection;
window.copyResultText = copyResultText;
window.downloadResultImage = downloadResultImage;
window.initPdfRegions = initPdfRegions;
window.loadDocumentForRegions = loadDocumentForRegions;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initPdfRegions();
});
