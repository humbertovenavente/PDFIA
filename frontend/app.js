function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get('apiBase') || '').trim();
  const fromStorage = (localStorage.getItem('apiBase') || '').trim();
  let base = (fromQuery || fromStorage || 'http://localhost:7071/api').replace(/\/+$/, '');
  if (!/\/api$/i.test(base)) {
    base = `${base}/api`.replace(/\/+$/, '');
  }
  if (fromQuery) {
    localStorage.setItem('apiBase', base);
  }
  return base;
}

function getPrimaryTemplateType(results) {
  if (!results) return null;
  if (results.template_type) return results.template_type;
  if (Array.isArray(results.pages) && results.pages.length > 0) {
    const p0 = results.pages[0];
    const root = p0 && (p0.data || p0);
    return root && root.template_type ? root.template_type : null;
  }
  return null;
}

function shouldUseTemplateView(mode, results) {
  if (mode !== 'DOCUMENT') return false;
  const t = getPrimaryTemplateType(results);
  if (t === 'product_spec') return true;
  if (t === 'target_brands_inc') return true;
  if (t === 'unknown' && (results?.product_overview || results?.bom_product_materials || results?.additional_tables || results?.items)) {
    return true;
  }
  if (Array.isArray(results?.pages) && results.pages.length > 0) {
    const root = results.pages[0]?.data;
    if (root?.template_type === 'unknown' && (root?.product_overview || root?.bom_product_materials || root?.additional_tables || root?.items)) {
      return true;
    }
  }
  return false;
}

function parseTargetBrandsIncMeta(rawText) {
  const text = String(rawText || '');
  const out = { generated_on: null, generated_by: null, company: null };
  const m = /Generated\s+on\s+([^\n]+?)\s+by\s+([^\n]+?)\s+©/i.exec(text);
  if (m) {
    out.generated_on = (m[1] || '').trim() || null;
    out.generated_by = (m[2] || '').trim() || null;
  }
  const c = /\b([A-Z][A-Z0-9 .,&\-]+S\.A\.)\b/.exec(text.slice(0, 800));
  if (c) out.company = (c[1] || '').trim() || null;
  return out;
}

function parseTargetBrandsIncWorkspace(rawText) {
  const text = String(rawText || '');
  const out = { workspace_name: null, workspace_id: null, design_cycle: null, set_dates: null };

  const wn = /Workspace\s+Name\s*(?:\n|\s)+([^\n]+?)(?:\n|Workspace\s+ID|Design\s+Cycle|Set\s+Dates|$)/i.exec(text);
  if (wn) out.workspace_name = (wn[1] || '').trim() || null;

  const wid = /\bWRK-[A-Z0-9]+\b/i.exec(text);
  if (wid) out.workspace_id = (wid[0] || '').trim() || null;

  const dc = /Design\s+Cycle\s*(?:\n|\s)+([^\n]+?)(?:\n|Workspace\s+Name|Workspace\s+ID|Set\s+Dates|$)/i.exec(text);
  if (dc) out.design_cycle = (dc[1] || '').trim() || null;

  // Keep set dates empty unless explicitly extracted into structured JSON
  out.set_dates = null;

  return out;
}

function hydrateTargetBrandsIncDefaults(results) {
  if (!results) return;
  const { root, prefix } = getTemplateRootInfo(results);
  if (!root) return;

  const rawText = root?.raw_text || results?.raw_text || '';
  const meta = parseTargetBrandsIncWorkspace(rawText);

  const setIfMissing = (path, value) => {
    if (!value) return;
    const fullPath = joinPath(prefix, path);
    const parts = fullPath.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = results;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined) return;
      current = current[part];
    }
    const last = parts[parts.length - 1];
    const existing = current[last];
    if (existing == null || String(existing).trim() === '') {
      current[last] = value;
    }
  };

  setIfMissing('product_overview.workspace_name', meta.workspace_name);
  setIfMissing('product_overview.workspace_id', meta.workspace_id);
  setIfMissing('product_overview.design_cycle', meta.design_cycle);
}

const extractedImageEditorState = {
  activeIdx: null,
  originalDataUrl: null,
  workingDataUrl: null,
  img: null,
  canvas: null,
  ctx: null,
  draw: { scale: 1, offsetX: 0, offsetY: 0, width: 0, height: 0 },
  selecting: false,
  sel: { x: 0, y: 0, w: 0, h: 0 },
  selStart: { x: 0, y: 0 },
  mouseUpBound: false
};

function getExtractedImagePage(img) {
  const p = img?.page ?? img?.page_number ?? null;
  if (p == null) return null;
  const n = Number(p);
  return Number.isFinite(n) ? n : null;
}

function renderExtractedImagesThumbsFromPage(results, pageNum) {
  const images = Array.isArray(results?._extracted_images) ? results._extracted_images : [];
  window._extractedImages = images;

  const pageImages = images
    .map((img, idx) => ({ img, idx }))
    .filter(({ img }) => getExtractedImagePage(img) === pageNum);

  const thumbs = pageImages.length
    ? pageImages
        .map(({ img, idx }) => {
          const url = img?.data_url;
          if (!url) return '';
          return `
            <div class="img-tile" draggable="true"
                 onclick="loadExtractedImageIntoEditor(${idx})"
                 ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({type:'extracted_image', idx:${idx}}));">
              <img src="${url}" alt="Extracted image ${idx + 1}" onclick="event.stopPropagation();openImagePreviewModal(${idx})" />
              <div class="img-tile-meta">#${idx + 1}</div>
            </div>
          `;
        })
        .join('')
    : `<div class="img-empty">No extracted images for page ${escapeHtml(pageNum)}</div>`;

  const toggleLabel = state.imageEditorCollapsed ? 'Show editor' : 'Hide editor';
  return `
    <div class="images-editor-left">
      <div class="images-editor-title"><span>Extracted Images from Page ${escapeHtml(pageNum)}</span><button class="btn-secondary btn-sm" id="btn-toggle-image-editor" type="button">${escapeHtml(toggleLabel)}</button></div>
      <div class="images-editor-grid">${thumbs}</div>
    </div>
  `;
}

function renderTargetBrandsIncPage2(root, prefix, results) {
  const tablePath = joinPath(prefix, 'table_of_contents');
  const toggleLabel = state.tocEditorCollapsed ? 'Show editor' : 'Hide editor';
  const currentResults = results || state.currentResults;
  const defaultTocColumns = [
    { key: 'section', label: 'Section', numeric: false },
    { key: 'page_title', label: 'Page Title', numeric: false },
  ];
  const columnsPath = joinPath(prefix, '_toc_columns');
  let columns = defaultTocColumns;
  try {
    const existingColumns = currentResults ? getValueAtPath(currentResults, columnsPath) : null;
    if (Array.isArray(existingColumns) && existingColumns.length > 0) {
      const cleaned = existingColumns
        .filter(c => c && typeof c === 'object' && String(c.key || '').trim() && String(c.label || '').trim())
        .map(c => ({
          key: String(c.key).trim(),
          label: String(c.label).trim(),
          numeric: !!c.numeric,
        }));
      if (cleaned.length > 0) {
        columns = cleaned;
      }
    } else if (currentResults) {
      setNestedValue(currentResults, columnsPath, defaultTocColumns);
    }
  } catch {}

  const sanitizeTocRows = (rows) => {
    const arr = Array.isArray(rows) ? rows : [];
    return arr
      .map(r => (r && typeof r === 'object') ? ({ ...r }) : null)
      .filter(Boolean)
      .map(r => {
        r.section = (r.section == null) ? null : String(r.section).trim();
        r.page_title = (r.page_title == null) ? null : String(r.page_title).trim();
        return r;
      })
      .filter(r => {
        const s = (r.section || '').toLowerCase();
        const pt = (r.page_title || '').toLowerCase();
        if (!s && !pt) return false;
        if (s === 'section' || s === 'page title' || s === 'title' || s === 'page') return false;
        if (s.includes('table of contents') || s.includes('tables of contents')) return false;
        if (pt.includes('table of contents') || pt.includes('tables of contents')) return false;
        return true;
      });
  };

  const parseTocFromRawText = (rawText) => {
    const lines = String(rawText || '').split(/\r?\n/).map(l => String(l || '').trim()).filter(Boolean);
    if (!lines.length) return [];
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (low.includes('table of contents') || low.includes('tables of contents')) {
        startIdx = i;
        break;
      }
    }
    if (startIdx === -1) return [];

    // Consume a small window after the header.
    const windowLines = lines.slice(startIdx, startIdx + 60);
    const cleaned = windowLines.filter((ln) => {
      const low = ln.toLowerCase();
      if (low.includes('table of contents') || low.includes('tables of contents')) return false;
      if (low === 'section' || low === 'page title' || (low.includes('section') && low.includes('title'))) return false;
      return true;
    });

    const out = [];
    let i = 0;
    while (i < cleaned.length) {
      const section = cleaned[i];
      const next = cleaned[i + 1] || '';
      const m = next.match(/^(\d{1,3})\s+(.+?)\s*$/);

      if (m) {
        // Preserve original raw line exactly as it appears (e.g. "1 bill of materials").
        out.push({ section, page_title: next });
        i += 2;
        continue;
      }

      // OVERVIEW is special in these PDFs: it often has just the title line without a leading page number.
      if (section && next && section.toLowerCase() !== 'page' && section.toLowerCase() !== 'title') {
        out.push({ section, page_title: next });
        i += 2;
        continue;
      }
      i += 1;
    }

    // Keep only rows that look like a real TOC (at least 3 rows and some page numbers)
    const numberedCount = out.filter(r => /^\d{1,3}\s+\S/.test(String(r.page_title || ''))).length;
    if (out.length < 3 || numberedCount === 0) return [];
    return sanitizeTocRows(out);
  };

  const pages = typeof getDocumentPages === 'function' ? getDocumentPages(currentResults || {}) : [];
  const page2 = Array.isArray(pages) ? pages.find((p) => Number(p?.page_number) === 2) : null;
  const page2Raw = page2?.raw_text || root?.raw_text || currentResults?.raw_text || '';

  // If backend TOC is empty, auto-fill it from raw_text (once per render) so the table is usable.
  let toc = Array.isArray(root?.table_of_contents) ? root.table_of_contents : [];

  // Migrate old format rows ({page,title}) into the desired display format ({page_title}).
  if (!state.tocUserEdited && Array.isArray(toc) && toc.length) {
    let changed = false;
    const migrated = toc.map((r) => {
      const row = r && typeof r === 'object' ? { ...r } : {};
      if (row.page_title == null || String(row.page_title).trim() === '') {
        const p = row.page;
        const t = row.title;
        if (p != null && String(p).trim() !== '' && t != null && String(t).trim() !== '') {
          row.page_title = `${String(p).trim()} ${String(t).trim()}`.trim();
          changed = true;
        } else if (t != null && String(t).trim() !== '') {
          row.page_title = String(t).trim();
          changed = true;
        }
      }
      delete row.page;
      delete row.title;
      return row;
    });
    const sanitizedMigrated = sanitizeTocRows(migrated);
    if (currentResults && (changed || sanitizedMigrated.length !== migrated.length)) {
      setNestedValue(currentResults, tablePath, sanitizedMigrated);
      toc = sanitizedMigrated;
      syncResultsToEditor();
    } else {
      toc = sanitizedMigrated;
    }
  }

  const parsedFromRaw = (currentResults && page2Raw) ? parseTocFromRawText(page2Raw) : [];

  const extractLeadingNum = (s) => {
    const m = String(s || '').trim().match(/^(\d{1,3})\b/);
    return m ? Number(m[1]) : null;
  };

  const maxLeadingNum = (rows) => {
    let m = 0;
    for (const r of rows || []) {
      const n = extractLeadingNum(r?.page_title);
      if (typeof n === 'number' && !Number.isNaN(n) && n > m) m = n;
    }
    return m;
  };

  // Prefer the raw-text TOC when existing TOC looks like PDF page numbers (large) instead of TOC column numbers (small).
  if (!state.tocUserEdited && currentResults && Array.isArray(parsedFromRaw) && parsedFromRaw.length) {
    const parsedMax = maxLeadingNum(parsedFromRaw);
    const existingMax = maxLeadingNum(toc);
    const shouldReplace =
      (toc.length === 0) ||
      (!state.tocUserEdited && parsedMax > 0 && (existingMax === 0 || existingMax > 10 || existingMax > parsedMax));

    if (shouldReplace) {
      const sanitizedParsed = sanitizeTocRows(parsedFromRaw);
      setNestedValue(currentResults, tablePath, sanitizedParsed);
      toc = sanitizedParsed;
      syncResultsToEditor();
    }
  }

  const previewTableHtml = renderEditableTableApp(
    toc,
    columns,
    tablePath,
    {
      showRowNumbers: false,
      forceReadOnly: true,
    }
  );

  const editorTableHtml = renderEditableTableApp(
    toc,
    columns,
    tablePath,
    {
      showRowNumbers: false,
      enableRowDrag: true,
      forceEditable: true,
    }
  );

  const basicTableHtml = (() => {
    const thead = columns.map(c => `<th class="${c.numeric ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
    const rowsHtml = (Array.isArray(toc) && toc.length)
      ? toc.map((row, idx) => {
          const cells = columns.map(c => {
            const val = row?.[c.key];
            return `<td class="${c.numeric ? 'num' : ''}">${escapeHtml(fmt(val ?? '') || '—')}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
        }).join('')
      : `<tr><td colspan="${columns.length}"><div class="empty">No data</div></td></tr>`;
    return `
      <div class="table-wrap" data-toc-fallback="1">
        <table class="table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    `;
  })();

  const safePreviewTableHtml = (previewTableHtml && String(previewTableHtml).includes('<table')) ? previewTableHtml : basicTableHtml;
  const safeEditorTableHtml = (editorTableHtml && String(editorTableHtml).includes('<table')) ? editorTableHtml : basicTableHtml;

  const draggablePreview = `
    <div draggable="true" ondragstart="handleTocDockDragStart(event)" style="height: 100%;">
      ${safePreviewTableHtml}
    </div>
  `;

  const rightHtml = state.tocEditorDocked
    ? `${safeEditorTableHtml}`
    : `
        <div class="img-editor-drop" id="toc-editor-drop" ondragover="handleTocDockDragOver(event)" ondragleave="handleTocDockDragLeave(event)" ondrop="handleTocDockDrop(event)">
          <div class="img-editor-drop-hint">Drag the table from Preview and drop it here to edit</div>
        </div>
      `;

  const splitHtml = state.tocEditorCollapsed
    ? `
        <div class="images-editor">
          <div class="images-editor-left">
            <div class="images-editor-title"><span>Table of Contents</span><span></span></div>
            ${toc.length ? '' : `<div class="img-empty">No table of contents extracted yet.</div>`}
            ${safePreviewTableHtml}
          </div>
        </div>
      `
    : `
        <div class="images-editor">
          <div class="images-editor-left">
            <div class="images-editor-title"><span>Preview</span><span></span></div>
            ${toc.length ? '' : `<div class="img-empty">No table of contents extracted yet.</div>`}
            ${draggablePreview}
          </div>
          <div class="images-editor-right">
            <div class="images-editor-title"><span>Editor</span><span></span></div>
            ${rightHtml}
          </div>
        </div>
      `;

  return `
    <div class="page-card">
      <div class="images-editor-title">
        <span>Page 2 — Table of Contents</span>
        ${(state.tocEditorCollapsed || !state.tocEditorDocked) ? '' : `<button class="btn-secondary btn-sm" onclick="saveResults()" type="button">Save</button>`}
        <button class="btn-secondary btn-sm" id="btn-toggle-toc-editor" type="button">${escapeHtml(toggleLabel)}</button>
      </div>
      ${splitHtml}
    </div>
  `;
}

function renderImageEditorPanel(pageNum) {
  const toggleLabel = state.imageEditorCollapsed ? 'Show editor' : 'Hide editor';
  return `
    <div class="images-editor-right">
      <div class="images-editor-title"><span>Image Editor</span><button class="btn-secondary btn-sm" id="btn-toggle-image-editor-right" type="button">${escapeHtml(toggleLabel)}</button></div>
      <div class="img-editor-drop" id="img-editor-drop" data-page="${escapeHtml(pageNum)}">
        <div class="img-editor-drop-hint">Drag an image here to edit</div>
        <canvas id="img-editor-canvas" class="img-editor-canvas"></canvas>
      </div>
      <div class="img-editor-actions">
        <button class="btn-secondary" id="btn-img-copy" type="button">Copy</button>
        <button class="btn-secondary" id="btn-img-download" type="button">Download</button>
        <button class="btn-secondary" id="btn-img-reset" type="button">Reset</button>
        <button class="btn-secondary" id="btn-img-crop" type="button">Crop</button>
        <button class="btn-primary" id="btn-img-save" type="button">Save as New</button>
      </div>
      <div class="img-editor-help">Tip: drag to select an area, then click Crop. Click the thumbnail to open ROI.</div>
    </div>
  `;
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = String(dataUrl).split(',');
  const mime = (meta.match(/data:([^;]+)/i) || [])[1] || 'image/png';
  const bin = atob(b64 || '');
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function copyEditedImageToClipboard() {
  const st = extractedImageEditorState;
  if (!st.workingDataUrl) return;
  try {
    const blob = dataUrlToBlob(st.workingDataUrl);
    if (!navigator.clipboard || !window.ClipboardItem) {
      showToast('Clipboard not supported in this browser');
      return;
    }
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    showToast('Copied image to clipboard');
  } catch (err) {
    console.error('Copy failed', err);
    showToast('Failed to copy image');
  }
}

function downloadEditedImage() {
  const st = extractedImageEditorState;
  if (!st.workingDataUrl) return;
  const a = document.createElement('a');
  a.href = st.workingDataUrl;
  a.download = `edited-image-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Downloaded image');
}

function loadExtractedImageIntoEditor(idx) {
  if (!state.currentResults) return;
  const images = Array.isArray(state.currentResults._extracted_images) ? state.currentResults._extracted_images : [];
  const img = images[idx];
  if (!img?.data_url) return;
  extractedImageEditorState.activeIdx = idx;
  extractedImageEditorState.originalDataUrl = img.data_url;
  extractedImageEditorState.workingDataUrl = img.data_url;
  drawImageEditor();
}

function drawImageEditor() {
  const canvas = extractedImageEditorState.canvas || document.getElementById('img-editor-canvas');
  if (!canvas) return;
  extractedImageEditorState.canvas = canvas;
  extractedImageEditorState.ctx = canvas.getContext('2d');

  const wrap = document.getElementById('img-editor-drop');
  const w = Math.max(360, (wrap?.clientWidth || 820) - 2);
  const h = 520;
  canvas.width = w;
  canvas.height = h;

  const ctx = extractedImageEditorState.ctx;
  ctx.clearRect(0, 0, w, h);

  const dataUrl = extractedImageEditorState.workingDataUrl;
  if (!dataUrl) {
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const imgEl = new Image();
  imgEl.onload = () => {
    extractedImageEditorState.img = imgEl;
    const scale = Math.min(w / imgEl.width, h / imgEl.height);
    const dw = imgEl.width * scale;
    const dh = imgEl.height * scale;
    const ox = (w - dw) / 2;
    const oy = (h - dh) / 2;
    extractedImageEditorState.draw = { scale, offsetX: ox, offsetY: oy, width: dw, height: dh };

    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(imgEl, ox, oy, dw, dh);
    drawSelectionOverlay();
  };
  imgEl.src = dataUrl;
}

function drawSelectionOverlay() {
  const { canvas, ctx, sel } = extractedImageEditorState;
  if (!canvas || !ctx) return;
  if (!sel || sel.w === 0 || sel.h === 0) return;
  ctx.save();
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
  ctx.restore();
}

function cropImageEditorSelection() {
  const st = extractedImageEditorState;
  if (!st.img || !st.canvas) return;
  const { sel } = st;
  if (!sel || sel.w === 0 || sel.h === 0) return;

  const { scale, offsetX, offsetY, width, height } = st.draw;
  const x1 = Math.max(offsetX, Math.min(offsetX + width, sel.x));
  const y1 = Math.max(offsetY, Math.min(offsetY + height, sel.y));
  const x2 = Math.max(offsetX, Math.min(offsetX + width, sel.x + sel.w));
  const y2 = Math.max(offsetY, Math.min(offsetY + height, sel.y + sel.h));

  const sx = Math.max(0, (x1 - offsetX) / scale);
  const sy = Math.max(0, (y1 - offsetY) / scale);
  const sw = Math.max(1, (x2 - x1) / scale);
  const sh = Math.max(1, (y2 - y1) / scale);

  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = Math.round(sw);
  cropCanvas.height = Math.round(sh);
  const cctx = cropCanvas.getContext('2d');
  cctx.drawImage(st.img, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);
  st.workingDataUrl = cropCanvas.toDataURL('image/png');
  st.sel = { x: 0, y: 0, w: 0, h: 0 };
  drawImageEditor();
}

function resetImageEditor() {
  const st = extractedImageEditorState;
  st.workingDataUrl = st.originalDataUrl;
  st.sel = { x: 0, y: 0, w: 0, h: 0 };
  drawImageEditor();
}

function saveImageEditorChanges() {
  const st = extractedImageEditorState;
  if (!state.currentResults) return;
  if (!st.workingDataUrl) return;

  if (!Array.isArray(state.currentResults._extracted_images)) {
    state.currentResults._extracted_images = [];
  }
  const images = state.currentResults._extracted_images;
  const src = (typeof st.activeIdx === 'number') ? images[st.activeIdx] : null;
  const pageAttr = document.getElementById('img-editor-drop')?.getAttribute('data-page');
  const pageFromDom = Number(pageAttr ?? '1');
  const pageFallback = Number.isFinite(pageFromDom) ? pageFromDom : 1;
  const page = getExtractedImagePage(src) ?? pageFallback;

  const temp = new Image();
  temp.onload = () => {
    const newImg = {
      data_url: st.workingDataUrl,
      page,
      page_number: page,
      width: temp.width,
      height: temp.height,
      source: 'editor',
      derived_from_idx: (typeof st.activeIdx === 'number') ? st.activeIdx : null,
      created_at: new Date().toISOString(),
    };
    images.push(newImg);
    syncResultsToEditor();
    resetExtractedImageEditorState();
    const renderRoot = document.getElementById('template-render-root');
    if (renderRoot) {
      renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
      setTimeout(() => {
        attachEditableListeners();
        attachExtractedImageEditorHandlers();
      }, 0);
    }
  };
  temp.src = st.workingDataUrl;
}

function attachExtractedImageEditorHandlers() {
  const toggleBtn = document.getElementById('btn-toggle-image-editor');
  const toggleBtnRight = document.getElementById('btn-toggle-image-editor-right');
  const toggleTocBtn = document.getElementById('btn-toggle-toc-editor');

  const doToggle = () => {
    state.imageEditorCollapsed = !state.imageEditorCollapsed;
    try {
      localStorage.setItem('imageEditorCollapsed', state.imageEditorCollapsed ? '1' : '0');
    } catch {}
    const renderRoot = document.getElementById('template-render-root');
    if (renderRoot && state.currentResults) {
      renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
      setTimeout(() => {
        attachEditableListeners();
        attachExtractedImageEditorHandlers();
      }, 0);
    }
  };

  if (toggleBtn) {
    toggleBtn.onclick = doToggle;
  }
  if (toggleBtnRight) {
    toggleBtnRight.onclick = doToggle;
  }

  if (toggleTocBtn) {
    toggleTocBtn.onclick = () => {
      state.tocEditorCollapsed = !state.tocEditorCollapsed;
      state.tocEditorDocked = false;
      try {
        localStorage.setItem('tocEditorCollapsed', state.tocEditorCollapsed ? '1' : '0');
      } catch {}
      const renderRoot = document.getElementById('template-render-root');
      if (renderRoot && state.currentResults) {
        renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
        setTimeout(() => {
          attachEditableListeners();
          attachExtractedImageEditorHandlers();
        }, 0);
      }
    };
  }

  const drop = document.getElementById('img-editor-drop');
  const canvas = document.getElementById('img-editor-canvas');
  const btnCopy = document.getElementById('btn-img-copy');
  const btnDownload = document.getElementById('btn-img-download');
  const btnCrop = document.getElementById('btn-img-crop');
  const btnReset = document.getElementById('btn-img-reset');
  const btnSave = document.getElementById('btn-img-save');
  if (!drop || !canvas) return;

  extractedImageEditorState.canvas = canvas;
  extractedImageEditorState.ctx = canvas.getContext('2d');

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('dragover');
    let payload;
    try {
      payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
    } catch {
      payload = null;
    }
    if (!payload || payload.type !== 'extracted_image') return;
    loadExtractedImageIntoEditor(payload.idx);
  });

  const getPos = (evt) => {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  };

  canvas.onmousedown = (e) => {
    if (!extractedImageEditorState.workingDataUrl) return;
    extractedImageEditorState.selecting = true;
    const p = getPos(e);
    extractedImageEditorState.selStart = p;
    extractedImageEditorState.sel = { x: p.x, y: p.y, w: 0, h: 0 };
  };
  canvas.onmousemove = (e) => {
    if (!extractedImageEditorState.selecting) return;
    const p = getPos(e);
    const s = extractedImageEditorState.selStart;
    const x = Math.min(s.x, p.x);
    const y = Math.min(s.y, p.y);
    const w = Math.abs(p.x - s.x);
    const h = Math.abs(p.y - s.y);
    extractedImageEditorState.sel = { x, y, w, h };
    drawImageEditor();
  };
  if (!extractedImageEditorState.mouseUpBound) {
    window.addEventListener('mouseup', () => {
      if (!extractedImageEditorState.selecting) return;
      extractedImageEditorState.selecting = false;
    });
    extractedImageEditorState.mouseUpBound = true;
  }

  if (btnCrop) btnCrop.onclick = cropImageEditorSelection;
  if (btnReset) btnReset.onclick = resetImageEditor;
  if (btnSave) btnSave.onclick = saveImageEditorChanges;
  if (btnCopy) btnCopy.onclick = () => copyEditedImageToClipboard();
  if (btnDownload) btnDownload.onclick = downloadEditedImage;

  // Initial draw
  drawImageEditor();
}

function renderTargetBrandsIncPage1(page, prefix, results) {
  const root = page?.data || {};
  const ov = root?.product_overview || {};
  const wsMeta = parseTargetBrandsIncWorkspace(page?.raw_text || root?.raw_text);

  const productTitle = ov.product_name || 'Product';

  const pageNum = page?.page_number ?? 1;
  const thumbsHtml = renderExtractedImagesThumbsFromPage(results, pageNum);
  const editorHtml = state.imageEditorCollapsed ? '' : renderImageEditorPanel(pageNum);

  return `
    <div class="page-card">
      <div class="page-title">${escapeHtml(productTitle)}</div>
      <div class="page1-split ${state.imageEditorCollapsed ? 'editor-collapsed' : ''}">
        <div class="page1-left">
          <div class="grid-2">
            <div class="kv">
              <div class="kv-title">Product Attributes</div>
              ${kvRow('Product Name', ov.product_name, joinPath(prefix, 'product_overview.product_name'))}
              ${kvRow('Product ID', ov.product_id, joinPath(prefix, 'product_overview.product_id'))}
              ${kvRow('Status', ov.status, joinPath(prefix, 'product_overview.status'))}
              ${kvRow('Brand', ov.brand, joinPath(prefix, 'product_overview.brand'))}
              ${kvRow('Department', ov.department, joinPath(prefix, 'product_overview.department'))}
              ${kvRow('Division', ov.division, joinPath(prefix, 'product_overview.division'))}
              ${kvRow('Class', ov.class, joinPath(prefix, 'product_overview.class'))}
              ${kvRow('Primary Material', ov.primary_material, joinPath(prefix, 'product_overview.primary_material'))}
              ${kvRow('Secondary Material', ov.secondary_material, joinPath(prefix, 'product_overview.secondary_material'))}
              ${kvRow('Vendor Style #', ov.vendor_style_number, joinPath(prefix, 'product_overview.vendor_style_number'))}
              ${kvRow('Additional Product Details', ov.additional_product_details, joinPath(prefix, 'product_overview.additional_product_details'))}
              ${kvRow('System Tags', ov.system_tags, joinPath(prefix, 'product_overview.system_tags'))}
              ${kvRow('Tags', ov.tags, joinPath(prefix, 'product_overview.tags'))}
            </div>
            <div class="kv">
              <div class="kv-title">Workspace Details</div>
              ${kvRow('Workspace Name', ov.workspace_name || wsMeta.workspace_name, joinPath(prefix, 'product_overview.workspace_name'))}
              ${kvRow('Workspace ID', ov.workspace_id || wsMeta.workspace_id, joinPath(prefix, 'product_overview.workspace_id'))}
              ${kvRow('Design Cycle', ov.design_cycle || wsMeta.design_cycle, joinPath(prefix, 'product_overview.design_cycle'))}
              ${kvRow('Set Dates', ov.set_dates, joinPath(prefix, 'product_overview.set_dates'))}
            </div>
          </div>
          ${thumbsHtml}
        </div>
        <div class="page1-right">
          ${editorHtml}
        </div>
      </div>
    </div>
  `;
}

function resetExtractedImageEditorState() {
  extractedImageEditorState.activeIdx = null;
  extractedImageEditorState.originalDataUrl = null;
  extractedImageEditorState.workingDataUrl = null;
  extractedImageEditorState.img = null;
  extractedImageEditorState.selecting = false;
  extractedImageEditorState.sel = { x: 0, y: 0, w: 0, h: 0 };
  extractedImageEditorState.selStart = { x: 0, y: 0 };
}

function ensureImagePreviewModal() {
  let modal = document.getElementById('img-preview-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'img-preview-modal';
  modal.className = 'img-preview-modal hidden';
  modal.innerHTML = `
    <div class="img-preview-overlay" id="img-preview-overlay"></div>
    <div class="img-preview-content">
      <div class="img-preview-header">
        <div class="img-preview-title" id="img-preview-title">Preview</div>
        <div class="img-preview-actions">
          <button class="btn-secondary btn-sm" id="btn-img-preview-roi" type="button">Open ROI</button>
          <button class="btn-secondary btn-sm" id="btn-img-preview-close" type="button">Close</button>
        </div>
      </div>
      <div class="img-preview-body">
        <img id="img-preview-img" alt="Preview" />
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const overlay = document.getElementById('img-preview-overlay');
  const closeBtn = document.getElementById('btn-img-preview-close');
  if (overlay) overlay.onclick = closeImagePreviewModal;
  if (closeBtn) closeBtn.onclick = closeImagePreviewModal;
  return modal;
}

function openImagePreviewModal(idx) {
  const images = window._extractedImages;
  if (!images || !images[idx] || !images[idx].data_url) return;
  const modal = ensureImagePreviewModal();
  const imgEl = document.getElementById('img-preview-img');
  const titleEl = document.getElementById('img-preview-title');
  const btnRoi = document.getElementById('btn-img-preview-roi');
  if (imgEl) imgEl.src = images[idx].data_url;
  const p = images[idx]?.page ?? images[idx]?.page_number ?? '—';
  if (titleEl) titleEl.textContent = `Extracted Image #${idx + 1} (Page ${p})`;
  if (btnRoi) btnRoi.onclick = () => {
    closeImagePreviewModal();
    openImageRoiModal(idx);
  };
  modal.classList.remove('hidden');
}

function closeImagePreviewModal() {
  const modal = document.getElementById('img-preview-modal');
  if (modal) modal.classList.add('hidden');
}

window.openImagePreviewModal = openImagePreviewModal;
window.closeImagePreviewModal = closeImagePreviewModal;

function renderTemplateView(mode, results) {
  const pages = getDocumentPages(results);
  const firstPage = pages[0] || { page_number: 1, data: results, raw_text: results?.raw_text };
  const { prefix, templateType } = getTemplateRootInfo(results);
  const { root } = getTemplateRootInfo(results);
  const t = getPrimaryTemplateType(results) || firstPage?.data?.template_type || templateType || null;
  if (t === 'product_spec' || t === 'target_brands_inc' || (t === 'unknown' && (firstPage?.data?.product_overview || results?.product_overview))) {
    const p1 = renderTargetBrandsIncPage1(firstPage, prefix, results);
    const p2 = renderTargetBrandsIncPage2(root || firstPage?.data || {}, prefix, results);
    return `<div class="preview-root">${p1}${p2}</div>`;
  }
  const pagesHtml = pages.map(renderDocumentPage).join('');
  return `<div class="preview-root">${pagesHtml}</div>`;
}

const API_BASE = getApiBase();
window.API_BASE = API_BASE;

const __originalFetch = window.fetch ? window.fetch.bind(window) : null;
if (__originalFetch) {
  window.fetch = (input, init) => {
    let url = '';
    try {
      url = typeof input === 'string' ? input : (input && input.url) ? input.url : '';
    } catch (e) {
      url = '';
    }

    if (/\.ngrok-free\.app\b/i.test(url)) {
      const nextInit = init ? { ...init } : {};
      const hdrs = new Headers(nextInit.headers || {});
      if (!hdrs.has('ngrok-skip-browser-warning')) {
        hdrs.set('ngrok-skip-browser-warning', 'true');
      }
      nextInit.headers = hdrs;
      return __originalFetch(input, nextInit);
    }

    return __originalFetch(input, init);
  };
}

function ensureTemplateViewEl() {
  let el = document.getElementById('template-view');
  if (el) return el;
  const tab = document.getElementById('tab-editor');
  if (!tab) return null;
  el = document.createElement('div');
  el.id = 'template-view';
  el.className = 'hidden';
  tab.insertBefore(el, tab.firstChild);
  return el;
}

const state = {
  mode: 'DOCUMENT',
  jobs: [],
  selectedJobId: null,
  saving: false,
  currentResults: null, // Store current results for editing
  editMode: true, // Enable edit mode by default
  jobPollTimer: null,
  templateEditorTimer: null,
  imageEditorCollapsed: false,
  tocEditorCollapsed: true,
  tocEditorDocked: false,
  tocUserEdited: false, // Track user edits to table_of_contents
  uploadTemplate: 'auto',
};

function renderTemplateProcessingCard(job) {
  return `
    <div class="preview-root">
      <div class="page-card">
        <div class="page-title">Processing</div>
        <div class="empty-state">
          <i class="fas fa-hourglass-half"></i>
          <p>${escapeHtml(job?.status === 'PROCESSING' ? 'Processing document...' : 'Waiting for results')}</p>
        </div>
      </div>
    </div>
  `;
}

function inputVal(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(x => String(x ?? '')).join(', ');
  return String(v);
}

function joinPath(prefix, path) {
  if (!prefix) return path;
  if (!path) return prefix;
  return `${prefix}.${path}`;
}

function getTemplateRootInfo(results) {
  if (!results) return { root: null, prefix: '', templateType: null };

  // If backend wrapped content in pages, edit the first page's data
  if (Array.isArray(results.pages) && results.pages.length) {
    let firstIdx = 0;
    let minPage = Infinity;
    for (let i = 0; i < results.pages.length; i++) {
      const n = results.pages[i]?.page_number ?? 1;
      if (n < minPage) {
        minPage = n;
        firstIdx = i;
      }
    }
    const root = results.pages[firstIdx]?.data ?? {};
    const templateType = root?.template_type ?? results?.template_type ?? null;
    return { root, prefix: `pages[${firstIdx}].data`, templateType };
  }

  const templateType = results?.template_type ?? null;
  return { root: results, prefix: '', templateType };
}

function ensureResultsObject(maybeResults) {
  if (!maybeResults) return null;
  if (typeof maybeResults === 'string') {
    try {
      return JSON.parse(maybeResults);
    } catch {
      return null;
    }
  }
  return maybeResults;
}

function renderEditorField(label, path, value, multiline = false) {
  const v = inputVal(value);
  if (multiline) {
    return `
      <div class="template-form-row">
        <div class="template-form-label">${escapeHtml(label)}</div>
        <textarea class="template-form-input template-form-textarea" data-path="${escapeHtml(path)}" spellcheck="false">${escapeHtml(v)}</textarea>
      </div>
    `;
  }
  return `
    <div class="template-form-row">
      <div class="template-form-label">${escapeHtml(label)}</div>
      <input class="template-form-input" data-path="${escapeHtml(path)}" value="${escapeHtml(v)}" />
    </div>
  `;
}

function renderTargetBrandsIncPage1Editor(prefix, root) {
  const ov = root?.product_overview || {};
  return `
    <div class="template-form">
      <div class="template-form-section">
        <div class="template-form-section-title">Product Attributes</div>
        ${renderEditorField('Product Name', joinPath(prefix, 'product_overview.product_name'), ov.product_name)}
        ${renderEditorField('Product ID', joinPath(prefix, 'product_overview.product_id'), ov.product_id)}
        ${renderEditorField('Status', joinPath(prefix, 'product_overview.status'), ov.status)}
        ${renderEditorField('Brand', joinPath(prefix, 'product_overview.brand'), ov.brand)}
        ${renderEditorField('Department', joinPath(prefix, 'product_overview.department'), ov.department)}
        ${renderEditorField('Division', joinPath(prefix, 'product_overview.division'), ov.division)}
        ${renderEditorField('Class', joinPath(prefix, 'product_overview.class'), ov.class)}
        ${renderEditorField('Primary Material', joinPath(prefix, 'product_overview.primary_material'), ov.primary_material)}
        ${renderEditorField('Secondary Material', joinPath(prefix, 'product_overview.secondary_material'), ov.secondary_material)}
        ${renderEditorField('Vendor Style #', joinPath(prefix, 'product_overview.vendor_style_number'), ov.vendor_style_number)}
        ${renderEditorField('System Tags', joinPath(prefix, 'product_overview.system_tags'), ov.system_tags, true)}
        ${renderEditorField('Tags', joinPath(prefix, 'product_overview.tags'), ov.tags, true)}
      </div>

      <div class="template-form-divider"></div>

      <div class="template-form-section">
        <div class="template-form-section-title">Workspace Details</div>
        ${renderEditorField('Workspace Name', joinPath(prefix, 'product_overview.workspace_name'), ov.workspace_name)}
        ${renderEditorField('Workspace ID', joinPath(prefix, 'product_overview.workspace_id'), ov.workspace_id)}
        ${renderEditorField('Design Cycle', joinPath(prefix, 'product_overview.design_cycle'), ov.design_cycle)}
        ${renderEditorField('Set Dates', joinPath(prefix, 'product_overview.set_dates'), ov.set_dates)}
      </div>

      <div class="template-form-hint">Changes update the preview instantly.</div>
    </div>
  `;
}

function renderTemplateEditorPanel(mode, results) {
  if (!results) {
    return `
      <div class="template-form">
        <div class="template-form-empty">
          Processing... editor will be available when results are ready.
        </div>
      </div>
    `;
  }
  const { root, prefix, templateType } = getTemplateRootInfo(results);
  const t = getPrimaryTemplateType(results) || templateType || null;
  const hasOverview = !!(root?.product_overview || results?.product_overview);
  if (t === 'product_spec' || t === 'target_brands_inc' || t === 'unknown' || hasOverview) {
    return renderTargetBrandsIncPage1Editor(prefix, root);
  }
  return `
    <div class="template-form">
      <div class="template-form-empty">Editor panel is not available for this template yet.</div>
    </div>
  `;
}

function renderTemplateSplitView(mode, results, job) {
  const normalized = ensureResultsObject(results);
  const leftHtml = normalized ? renderTemplateView(mode, normalized) : renderTemplateProcessingCard(job);
  return `
    <div id="template-render-root">${leftHtml}</div>
  `;
}

function attachTemplateSplitEditor(mode) {
  const root = document.getElementById('template-editor-root');
  const renderRoot = document.getElementById('template-render-root');
  if (!root || !renderRoot) return;

  root.querySelectorAll('.template-form-input[data-path]').forEach((el) => {
    const handler = () => {
      if (!state.currentResults) return;
      const path = el.getAttribute('data-path');
      if (!path) return;
      const value = (el.value ?? '').toString();

      if (state.templateEditorTimer) {
        clearTimeout(state.templateEditorTimer);
        state.templateEditorTimer = null;
      }
      state.templateEditorTimer = setTimeout(() => {
        setNestedValue(state.currentResults, path, value);
        syncResultsToEditor();
        renderRoot.innerHTML = renderTemplateView(mode, state.currentResults);
        setTimeout(() => attachEditableListeners(), 0);
      }, 150);
    };
    el.addEventListener('input', handler);
    el.addEventListener('change', handler);
  });
}

function renderMatrixTable(matrix) {
  if (!matrix) return `<div class="empty">No table</div>`;
  const headers = Array.isArray(matrix.headers) ? matrix.headers : [];
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];

  if (!headers.length || !rows.length) {
    return `<div class="empty">Could not extract table</div>`;
  }

  const thead = headers.map(h => `<th>${escapeHtml(fmt(h) || '—')}</th>`).join('');
  const tbody = rows
    .map(r => {
      const cells = (Array.isArray(r) ? r : []).map(c => `<td>${escapeHtml(fmt(c) || '—')}</td>`).join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function renderLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return `<div class="empty">—</div>`;
  const items = lines
    .filter(x => x !== null && x !== undefined && String(x).trim().length > 0)
    .map(x => `<li>${escapeHtml(fmt(x))}</li>`)
    .join('');
  return `<ol class="lines">${items}</ol>`;
}

function sheetField(label, value, dataPath = '') {
  const editableClass = state.editMode ? 'editable-field' : '';
  const contentEditable = state.editMode ? 'contenteditable="true"' : '';
  return `
    <div class="sheet-field">
      <div class="sheet-label">${escapeHtml(label)}</div>
      <div class="sheet-value ${editableClass}" ${contentEditable} data-path="${escapeHtml(dataPath)}">${escapeHtml(fmt(value) || '')}</div>
    </div>
  `;
}

function hasMeaningfulValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function firstNonEmpty(values) {
  for (const v of values) {
    if (hasMeaningfulValue(v)) return v;
  }
  return null;
}

function normalizeSewingWorksheetPages(pages) {
  const swPages = pages.filter(p => p?.data?.template_type === 'sewing_worksheet' && p?.data?.sewing_worksheet);
  if (swPages.length === 0) return pages;

  const pick = (path) => {
    const vals = swPages.map(p => {
      let cur = p.data.sewing_worksheet;
      for (const key of path) {
        cur = cur ? cur[key] : undefined;
      }
      return cur;
    });
    return firstNonEmpty(vals);
  };

  const header = pick(['header']);
  const orderInfo = pick(['order_info']);
  const fabricInfo = pick(['fabric_info']);
  const quantityLines = pick(['quantity_lines']);
  const orderProcedure = pick(['order_procedure']);
  const orderProcedureNotes = pick(['order_procedure_notes']);
  const cuttingDetailNotes = pick(['cutting_detail_notes']);
  const sewingDetailNotes = pick(['sewing_detail_notes']);
  const trimPackingNotes = pick(['trim_packing_notes']);
  const labelsInfo = pick(['labels_info']);
  const measurementRows = pick(['measurement_rows']);

  for (const p of swPages) {
    const sw = p.data.sewing_worksheet;
    if (!hasMeaningfulValue(sw.header) && hasMeaningfulValue(header)) sw.header = header;
    if (!hasMeaningfulValue(sw.order_info) && hasMeaningfulValue(orderInfo)) sw.order_info = orderInfo;
    if (!hasMeaningfulValue(sw.fabric_info) && hasMeaningfulValue(fabricInfo)) sw.fabric_info = fabricInfo;
    if (!hasMeaningfulValue(sw.quantity_lines) && hasMeaningfulValue(quantityLines)) sw.quantity_lines = quantityLines;
    if (!hasMeaningfulValue(sw.order_procedure) && hasMeaningfulValue(orderProcedure)) sw.order_procedure = orderProcedure;
    if (!hasMeaningfulValue(sw.order_procedure_notes) && hasMeaningfulValue(orderProcedureNotes)) sw.order_procedure_notes = orderProcedureNotes;
    if (!hasMeaningfulValue(sw.cutting_detail_notes) && hasMeaningfulValue(cuttingDetailNotes)) sw.cutting_detail_notes = cuttingDetailNotes;
    if (!hasMeaningfulValue(sw.sewing_detail_notes) && hasMeaningfulValue(sewingDetailNotes)) sw.sewing_detail_notes = sewingDetailNotes;
    if (!hasMeaningfulValue(sw.trim_packing_notes) && hasMeaningfulValue(trimPackingNotes)) sw.trim_packing_notes = trimPackingNotes;
    if (!hasMeaningfulValue(sw.labels_info) && hasMeaningfulValue(labelsInfo)) sw.labels_info = labelsInfo;
    if (!hasMeaningfulValue(sw.measurement_rows) && hasMeaningfulValue(measurementRows)) sw.measurement_rows = measurementRows;
  }

  return pages;
}

function renderQuantityLinesTable(lines) {
  if (!Array.isArray(lines) || lines.length === 0) return `<div class="empty">No table</div>`;

  const sizeCols = [
    { key: 'xxs_2_3', label: 'XXS (2/3)' },
    { key: 'xs_4_5', label: 'XS (4/5)' },
    { key: 's_6_7', label: 'S (6/7)' },
    { key: 'm_8_9', label: 'M (8/9)' },
    { key: 'l_10_11', label: 'L (10/11)' },
    { key: 'xl_12_13', label: 'XL (12/13)' },
    { key: 'xxl_14_15', label: 'XXL (14/15)' },
    { key: 'xxxl_16', label: 'XXXL (16)' },
  ];

  const thead = `
    <tr>
      <th>S#</th>
      <th>PO#</th>
      <th>XFTY</th>
      <th>COLOR</th>
      <th>COLOR CODE</th>
      ${sizeCols.map(s => `<th class="num">${escapeHtml(s.label)}</th>`).join('')}
      <th class="num">TOTAL</th>
    </tr>
  `;

  const tbody = lines.map((l) => {
    const sizes = l?.sizes || {};
    const type = (l?.type || '').toLowerCase();
    const rowClass = type === 'subtotal' ? 'row-subtotal' : (type === 'grandtotal' ? 'row-grandtotal' : '');
    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(fmt(l?.style) || (type === 'subtotal' ? 'SUB TOTAL' : (type === 'grandtotal' ? 'GRAND TOTAL' : '—')))}</td>
        <td>${escapeHtml(fmt(l?.po) || '')}</td>
        <td>${escapeHtml(fmt(l?.xfty) || '')}</td>
        <td>${escapeHtml(fmt(l?.color_name) || '')}</td>
        <td>${escapeHtml(fmt(l?.color_code) || '')}</td>
        ${sizeCols.map(s => `<td class="num">${escapeHtml(fmt(sizes?.[s.key]) || '')}</td>`).join('')}
        <td class="num">${escapeHtml(fmt(l?.total) || '')}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function renderMeasurementRowsTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return `<div class="empty">No table</div>`;

  // Support multiple key formats for sizes
  const sizeCols = [
    { key: 'xxs', altKeys: ['xxs_2_3', '2_3'], label: 'XXS (2/3)' },
    { key: 'xs', altKeys: ['xs_4_5', '4_5'], label: 'XS (4/5)' },
    { key: 's', altKeys: ['s_6_7', '6_7'], label: 'S (6/7)' },
    { key: 'm', altKeys: ['m_8_9', '8_9'], label: 'M (8/9)' },
    { key: 'l', altKeys: ['l_10_11', '10_11'], label: 'L (10/11)' },
    { key: 'xl', altKeys: ['xl_12_13', '12_13'], label: 'XL (12/13)' },
    { key: 'xxl', altKeys: ['xxl_14_15', '14_15'], label: 'XXL (14/15)' },
    { key: 'xxxl', altKeys: ['xxxl_16', '16'], label: 'XXXL (16)' },
  ];

  // Helper to get value with fallbacks
  const getValue = (row, col) => {
    let val = row?.[col.key];
    if (val !== undefined && val !== null && val !== '') return val;
    if (Array.isArray(col.altKeys)) {
      for (const alt of col.altKeys) {
        val = row?.[alt];
        if (val !== undefined && val !== null && val !== '') return val;
      }
    }
    return '';
  };

  const thead = `
    <tr>
      <th>Measurement points</th>
      <th class="num">Tolerance (-/+)</th>
      ${sizeCols.map(s => `<th class="num">${escapeHtml(s.label)}</th>`).join('')}
    </tr>
  `;

  const tbody = rows.map((r) => {
    return `
      <tr>
        <td>${escapeHtml(fmt(r?.name) || '')}</td>
        <td class="num">${escapeHtml(fmt(r?.tolerance) || '')}</td>
        ${sizeCols.map(s => `<td class="num">${escapeHtml(fmt(getValue(r, s)) || '')}</td>`).join('')}
      </tr>
    `;
  }).join('');

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>${thead}</thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function renderLabelsInfo(labelsInfo, extraNotes) {
  const lines = [];
  if (labelsInfo?.folding_size) lines.push(`FOLDING SIZE - ${labelsInfo.folding_size}`);
  if (labelsInfo?.hangtag) lines.push(`HANGTAG - ${labelsInfo.hangtag}`);
  if (labelsInfo?.pieces_per_box) lines.push(labelsInfo.pieces_per_box);
  if (Array.isArray(labelsInfo?.additional_notes)) lines.push(...labelsInfo.additional_notes);
  if (Array.isArray(extraNotes)) lines.push(...extraNotes);
  return renderLines(lines);
}

function renderSewingWorksheetPage(page) {
  const d = page.data || {};
  const sw = d.sewing_worksheet || {};
  const header = sw.header || {};
  const orderInfo = sw.order_info || {};
  const fabricInfo = sw.fabric_info || {};
  const labelsInfo = sw.labels_info || {};
  const rawText = page.raw_text || '';
  const pageIdx = (page.page_number || 1) - 1;
  const basePath = `pages[${pageIdx}].data.sewing_worksheet`;

  const title = 'SEWING WORKSHEET';

  const processText = sw.order_procedure;
  const cutNotes = sw.order_procedure_notes || sw.cutting_detail_notes;
  const sewNotes = sw.sewing_detail_notes;
  const qtyLines = sw.quantity_lines;
  const measRows = sw.measurement_rows;

  // Editable quantity lines table - support multiple key formats
  const qtyColumns = [
    { key: 'style', label: 'S#' },
    { key: 'po', label: 'PO#' },
    { key: 'xfty', label: 'XFTY' },
    { key: 'color_name', label: 'COLOR' },
    { key: 'color_code', label: 'COLOR CODE' },
    { key: 'sizes.xxs', altKeys: ['sizes.xxs_2_3', 'sizes.2_3'], label: 'XXS (2/3)', numeric: true },
    { key: 'sizes.xs', altKeys: ['sizes.xs_4_5', 'sizes.4_5'], label: 'XS (4/5)', numeric: true },
    { key: 'sizes.s', altKeys: ['sizes.s_6_7', 'sizes.6_7'], label: 'S (6/7)', numeric: true },
    { key: 'sizes.m', altKeys: ['sizes.m_8_9', 'sizes.8_9'], label: 'M (8/9)', numeric: true },
    { key: 'sizes.l', altKeys: ['sizes.l_10_11', 'sizes.10_11'], label: 'L (10/11)', numeric: true },
    { key: 'sizes.xl', altKeys: ['sizes.xl_12_13', 'sizes.12_13'], label: 'XL (12/13)', numeric: true },
    { key: 'sizes.xxl', altKeys: ['sizes.xxl_14_15', 'sizes.14_15'], label: 'XXL (14/15)', numeric: true },
    { key: 'sizes.xxxl', altKeys: ['sizes.xxxl_16', 'sizes.16'], label: 'XXXL (16)', numeric: true },
    { key: 'sizes.1x', label: '1X', numeric: true },
    { key: 'sizes.2x', label: '2X', numeric: true },
    { key: 'sizes.3x', label: '3X', numeric: true },
    { key: 'sizes.4x', label: '4X', numeric: true },
    { key: 'delivery_date', label: 'DELIVERY' },
    { key: 'total', label: 'TOTAL', numeric: true }
  ];

  // Editable measurement rows table - support multiple key formats
  const measColumns = [
    { key: 'name', label: 'Measurement points' },
    { key: 'tolerance', label: 'Tolerance (-/+)', numeric: true },
    { key: 'xxs', altKeys: ['xxs_2_3', '2_3'], label: 'XXS (2/3)', numeric: true },
    { key: 'xs', altKeys: ['xs_4_5', '4_5'], label: 'XS (4/5)', numeric: true },
    { key: 's', altKeys: ['s_6_7', '6_7'], label: 'S (6/7)', numeric: true },
    { key: 'm', altKeys: ['m_8_9', '8_9'], label: 'M (8/9)', numeric: true },
    { key: 'l', altKeys: ['l_10_11', '10_11'], label: 'L (10/11)', numeric: true },
    { key: 'xl', altKeys: ['xl_12_13', '12_13'], label: 'XL (12/13)', numeric: true },
    { key: 'xxl', altKeys: ['xxl_14_15', '14_15'], label: 'XXL (14/15)', numeric: true },
    { key: 'xxxl', altKeys: ['xxxl_16', '16'], label: 'XXXL (16)', numeric: true }
  ];

  const editBadge = state.editMode ? '<span class="edit-mode-badge"><i class="fas fa-edit"></i> Editable</span>' : '';

  return `
    <div class="page-card">
      <div class="page-title">Page ${escapeHtml(page.page_number)} ${editBadge}</div>
      <div class="sheet">
        <div class="sheet-title">${escapeHtml(title)}</div>

        <div class="sheet-grid">
          ${sheetField('CONTACT', header.contact, `${basePath}.header.contact`)}
          ${sheetField('DATE', header.document_date, `${basePath}.header.document_date`)}
          ${sheetField('REQUESTED BY', header.requested_by, `${basePath}.header.requested_by`)}
          ${sheetField('WORK PLANT', header.work_plant, `${basePath}.header.work_plant`)}
        </div>

        <div class="sheet-section">1. ORDER INFO</div>
        <div class="sheet-grid sheet-grid-2col">
          <div class="sheet-col">
            ${sheetField('#FILE', orderInfo.file, `${basePath}.order_info.file`)}
            ${sheetField('BUYER', orderInfo.buyer, `${basePath}.order_info.buyer`)}
            ${sheetField('STYLE #', orderInfo.style, `${basePath}.order_info.style`)}
            ${sheetField('PRODUCT', orderInfo.product, `${basePath}.order_info.product`)}
            ${sheetField('SEASON', orderInfo.season, `${basePath}.order_info.season`)}
            ${sheetField('QTY', orderInfo.qty, `${basePath}.order_info.qty`)}
            ${sheetField('SHIP DATE', orderInfo.ship_date, `${basePath}.order_info.ship_date`)}
            ${sheetField('CM COST', orderInfo.cm_cost, `${basePath}.order_info.cm_cost`)}
          </div>
          <div class="sheet-col">
            ${sheetField('YARN', fabricInfo.yarn, `${basePath}.fabric_info.yarn`)}
            ${sheetField('FABRIC 1', fabricInfo.fabric, `${basePath}.fabric_info.fabric`)}
            ${sheetField('WIDTH', fabricInfo.width, `${basePath}.fabric_info.width`)}
            ${sheetField('WEIGHT', fabricInfo.weight, `${basePath}.fabric_info.weight`)}
            ${sheetField('FABRIC 2', fabricInfo.fabric2, `${basePath}.fabric_info.fabric2`)}
            ${sheetField('WIDTH 2', fabricInfo.width2, `${basePath}.fabric_info.width2`)}
            ${sheetField('YIELD', fabricInfo.yield_total, `${basePath}.fabric_info.yield_total`)}
          </div>
        </div>

        <div class="sheet-section">3. ORDER PROCEDURE</div>
        ${processText ? `<div class="sheet-procedure ${state.editMode ? 'editable-field' : ''}" ${state.editMode ? 'contenteditable="true"' : ''} data-path="${basePath}.order_procedure">${escapeHtml(processText)}</div>` : `<div class="sheet-procedure">CUT - SEW - PACK</div>`}

        <div class="sheet-section">4. QTY PER STYLE, COLOR & PO</div>
        ${renderEditableTableApp(qtyLines, qtyColumns, `${basePath}.quantity_lines`)}

        <div class="sheet-section">5. CUTTING DETAIL</div>
        ${renderEditableLines(cutNotes, `${basePath}.cutting_detail_notes`)}

        <div class="sheet-section">6. SEWING DETAIL</div>
        ${renderEditableLines(sewNotes, `${basePath}.sewing_detail_notes`)}

        <div class="sheet-section">7. MEASUREMENT SPECIFICATION</div>
        ${renderEditableTableApp(measRows, measColumns, `${basePath}.measurement_rows`)}

        <div class="sheet-section">8. TRIM & PACKING DETAILS</div>
        ${renderLabelsInfo(labelsInfo, sw.trim_packing_notes)}

        ${renderYieldInfo(sw.yield_info)}
        ${renderImportantNotes(sw.important_notes)}
        ${renderProductOverview(d.product_overview)}
        ${renderBomMaterials(d.bom_product_materials)}
        ${renderAdditionalTables(sw.additional_tables || d.additional_tables)}
      </div>

      ${rawText ? `<details class="raw"><summary>Extracted text (page ${escapeHtml(page.page_number)})</summary><pre>${escapeHtml(rawText)}</pre></details>` : ''}
    </div>
  `;
}

// Render yield/consumption info
function renderYieldInfo(yieldInfo) {
  if (!yieldInfo || (!yieldInfo.body && !yieldInfo.rib)) return '';
  const unit = yieldInfo.unit || 'YD/DZ';
  return `
    <div class="sheet-section">9. YIELD</div>
    <div class="sheet-grid">
      ${yieldInfo.body ? sheetField('BODY', `${yieldInfo.body} ${unit}`) : ''}
      ${yieldInfo.rib ? sheetField('RIB', `${yieldInfo.rib} ${unit}`) : ''}
    </div>
  `;
}

// Render important notes
function renderImportantNotes(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  const items = notes.map(n => `<li>${escapeHtml(fmt(n))}</li>`).join('');
  return `
    <div class="sheet-section">IMPORTANT NOTES</div>
    <ol class="lines">${items}</ol>
  `;
}

// Render product overview (for Tech Pack documents)
function renderProductOverview(overview) {
  if (!overview) return '';
  const fields = [
    ['Product Name', overview.product_name],
    ['Product ID', overview.product_id],
    ['Status', overview.status],
    ['Brand', overview.brand],
    ['Department', overview.department],
    ['Division', overview.division],
    ['Primary Material', overview.primary_material],
    ['Vendor Style #', overview.vendor_style_number],
    ['Workspace ID', overview.workspace_id],
    ['Design Cycle', overview.design_cycle]
  ].filter(([_, v]) => v);
  
  if (fields.length === 0) return '';
  
  return `
    <div class="sheet-section">PRODUCT OVERVIEW / 제품 개요</div>
    <div class="sheet-grid">
      ${fields.map(([label, value]) => sheetField(label, value)).join('')}
    </div>
  `;
}

// Render BOM materials table
function renderBomMaterials(materials) {
  if (!Array.isArray(materials) || materials.length === 0) return '';
  
  const columns = [
    { key: 'section', label: 'Section' },
    { key: 'use', label: 'Use' },
    { key: 'material_type', label: 'Type' },
    { key: 'material_id', label: 'Material ID' },
    { key: 'material_details', label: 'Details' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'bom_code', label: 'BOM Code' },
    { key: 'bom_status', label: 'Status' }
  ];
  
  const thead = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
  const tbody = materials.map(row => {
    const cells = columns.map(c => `<td>${escapeHtml(fmt(row[c.key]) || '—')}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  
  return `
    <div class="sheet-section">BILL OF MATERIALS / 자재 명세서</div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

// Render additional tables
function renderAdditionalTables(tables) {
  if (!Array.isArray(tables) || tables.length === 0) return '';

  const isTableObject = (x) => x && typeof x === 'object' && Array.isArray(x.headers) && Array.isArray(x.rows);
  const isRowObject = (x) => x && typeof x === 'object' && !Array.isArray(x) && !isTableObject(x);

  const tableObjects = tables.filter(isTableObject);
  const rowObjects = tables.filter(isRowObject);

  const renderTableObject = (table) => {
    if (!table.headers || !table.rows || table.rows.length === 0) return '';
    const thead = table.headers.map(h => `<th>${escapeHtml(h)}</th>`).join('');
    const tbody = table.rows.map(row => {
      const rowData = Array.isArray(row) ? row : Object.values(row);
      const cells = rowData.map(v => `<td>${escapeHtml(fmt(v) || '—')}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `
      <div class="sheet-section">${escapeHtml(table.table_name || 'Additional Data')}</div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  };

  const renderRowObjectsAsTable = (rows, title = 'Additional Data') => {
    if (!Array.isArray(rows) || rows.length === 0) return '';

    const keySet = new Set();
    rows.forEach(r => {
      Object.keys(r || {}).forEach(k => keySet.add(k));
    });
    const allKeys = Array.from(keySet);

    const priority = ['name', 'tolerance', 'section', 'pom_name', 'pom_id', 'uom'];
    const prioritized = priority.filter(k => allKeys.includes(k));
    const remaining = allKeys.filter(k => !prioritized.includes(k));
    remaining.sort();
    const columns = [...prioritized, ...remaining];

    if (columns.length === 0) return '';

    const thead = columns.map(h => `<th>${escapeHtml(h)}</th>`).join('');
    const tbody = rows.map(r => {
      const cells = columns.map(k => `<td>${escapeHtml(fmt(r?.[k]) || '—')}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="sheet-section">${escapeHtml(title)}</div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  };

  const htmlTables = tableObjects.map(renderTableObject).join('');
  const htmlRows = renderRowObjectsAsTable(rowObjects, 'Additional Data');

  return `${htmlTables}${htmlRows}`;
}

function renderEditableLines(lines, dataPath) {
  if (!Array.isArray(lines) || lines.length === 0) {
    if (state.editMode) {
      return `
        <div class="table-actions">
          <button class="btn-action btn-add" onclick="addLineItem('${dataPath}')">
            <i class="fas fa-plus"></i> Add line
          </button>
        </div>
        <div class="empty">—</div>
      `;
    }
    return `<div class="empty">—</div>`;
  }
  
  if (!state.editMode) {
    const items = lines
      .filter(x => x !== null && x !== undefined && String(x).trim().length > 0)
      .map(x => `<li>${escapeHtml(fmt(x))}</li>`)
      .join('');
    return `<ol class="lines">${items}</ol>`;
  }
  
  const items = lines.map((line, idx) => `
    <li class="editable-line-item">
      <span class="editable-field" contenteditable="true" data-path="${dataPath}[${idx}]" 
            onblur="updateLineItem('${dataPath}', ${idx}, this.textContent)">${escapeHtml(fmt(line))}</span>
      <button class="btn-delete-row" onclick="deleteLineItem('${dataPath}', ${idx})" title="Delete">
        <i class="fas fa-times"></i>
      </button>
    </li>
  `).join('');
  
  return `
    <div class="table-actions">
      <button class="btn-action btn-add" onclick="addLineItem('${dataPath}')">
        <i class="fas fa-plus"></i> Add line
      </button>
    </div>
    <ol class="lines editable-lines">${items}</ol>
  `;
}

function addLineItem(dataPath) {
  if (!state.currentResults) return;
  const pathParts = dataPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (let i = 0; i < pathParts.length - 1; i++) {
    if (target[pathParts[i]] === undefined) target[pathParts[i]] = {};
    target = target[pathParts[i]];
  }
  const lastKey = pathParts[pathParts.length - 1];
  if (!Array.isArray(target[lastKey])) target[lastKey] = [];
  target[lastKey].push('');
  syncResultsToEditor();
  refreshPreview();
}

function updateLineItem(dataPath, idx, value) {
  if (!state.currentResults) return;
  const pathParts = dataPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  if (Array.isArray(target) && idx < target.length) {
    target[idx] = value.trim();
    syncResultsToEditor();
  }
}

function deleteLineItem(dataPath, idx) {
  if (!state.currentResults) return;
  const pathParts = dataPath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  if (Array.isArray(target) && idx < target.length) {
    target.splice(idx, 1);
    syncResultsToEditor();
    refreshPreview();
  }
}

window.addLineItem = addLineItem;
window.updateLineItem = updateLineItem;
window.deleteLineItem = deleteLineItem;

function escapeHtml(value) {
  const s = String(value ?? '');
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function qs(id) {
  return document.getElementById(id);
}

function qsa(selector, root = document) {
  return Array.from((root || document).querySelectorAll(selector));
}

function fmt(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function kvRow(label, value, dataPath = '') {
  const v = fmt(value);
  const editableClass = state.editMode ? 'editable-field' : '';
  const contentEditable = state.editMode ? 'contenteditable="true"' : '';
  return `<div class="kv-row"><div class="kv-label">${escapeHtml(label)}</div><div class="kv-value ${editableClass}" ${contentEditable} data-path="${escapeHtml(dataPath)}">${escapeHtml(v || '—')}</div></div>`;
}

// ===== EDITABLE TABLE FUNCTIONS =====
let tableIdCounter = 0;

function generateTableId() {
  return `editable-table-${++tableIdCounter}`;
}

// Helper to get nested value from object using dot notation
function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

// Helper to get value with fallback keys (for size columns that may have different formats)
function getValueWithFallbacks(obj, primaryKey, altKeys) {
  // Try primary key first
  let val = primaryKey.includes('.') ? getNestedValue(obj, primaryKey) : obj[primaryKey];
  if (val !== undefined && val !== null && val !== '') return val;
  
  // Try alternative keys
  if (Array.isArray(altKeys)) {
    for (const altKey of altKeys) {
      val = altKey.includes('.') ? getNestedValue(obj, altKey) : obj[altKey];
      if (val !== undefined && val !== null && val !== '') return val;
    }
  }
  
  return undefined;
}

// Helper to set nested value in object using dot notation
function setNestedValueInRow(obj, path, value) {
  if (!obj || !path) return;
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function renderEditableTableApp(data, columns, tablePath, options = {}) {
  const tableId = generateTableId();
  const rows = Array.isArray(data) ? data : [];
  const {
    showRowNumbers = false,
    title = '',
    enableRowDrag = false,
    forceEditable = false,
    forceReadOnly = false,
  } = options;

  const editable = forceReadOnly ? false : (forceEditable ? true : !!state.editMode);

  if (!editable) {
    // Non-editable mode - simple table
    const thead = columns.map(c => `<th class="${c.numeric ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
    const tbody = rows.length
      ? rows.map((row, i) => {
          const cells = columns.map(c => {
            // Support nested keys with fallbacks for different formats
            const val = getValueWithFallbacks(row, c.key, c.altKeys);
            return `<td class="${c.numeric ? 'num' : ''}">${escapeHtml(fmt(val) || '—')}</td>`;
          }).join('');
          return `<tr>${showRowNumbers ? `<td>${i + 1}</td>` : ''}${cells}</tr>`;
        }).join('')
      : `<tr><td colspan="${(showRowNumbers ? 1 : 0) + columns.length}"><div class="empty">No data</div></td></tr>`;
    return `
      <div class="table-wrap">
        <table class="table">
          <thead><tr>${showRowNumbers ? '<th>#</th>' : ''}${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
    `;
  }

  // Editable mode
  const actionsHtml = `
    <div class="table-actions">
      <button class="btn-action btn-add" onclick="addTableRow('${tableId}', '${tablePath}')">
        <i class="fas fa-plus"></i> Add row
      </button>
      <button class="btn-action btn-add" onclick="addTableColumn('${tableId}', '${tablePath}')">
        <i class="fas fa-columns"></i> Add column
      </button>
    </div>
  `;

  const theadCells = columns.map((c, colIdx) => `
    <th class="${c.numeric ? 'num' : ''}">
      <input type="text" class="header-input" value="${escapeHtml(c.label)}" 
             data-table="${tableId}" data-col="${colIdx}" data-key="${c.key}"
             onchange="updateColumnHeader('${tableId}', ${colIdx}, this.value)">
    </th>
  `).join('');

  const theadDeleteCells = columns.map((c, colIdx) => `
    <th class="col-actions">
      <button class="btn-delete-col" onclick="deleteTableColumn('${tableId}', '${tablePath}', ${colIdx})" title="Delete column">
        <i class="fas fa-times"></i>
      </button>
    </th>
  `).join('');

  const tbody = rows.map((row, rowIdx) => {
    const cells = columns.map((c, colIdx) => {
      // Support nested keys with fallbacks for different formats
      const val = getValueWithFallbacks(row, c.key, c.altKeys);
      return `
        <td class="editable-cell ${c.numeric ? 'num' : ''}" contenteditable="true" tabindex="0" spellcheck="false" draggable="false" onclick="this.focus()"
            data-table="${tableId}" data-row="${rowIdx}" data-col="${colIdx}" data-key="${c.key}"
            data-path="${tablePath}[${rowIdx}].${c.key}"
            onblur="updateTableCell('${tableId}', '${tablePath}', ${rowIdx}, '${c.key}', this.textContent)">
          ${escapeHtml(fmt(val ?? ''))}
        </td>
      `;
    }).join('');

    const dragAttrs = enableRowDrag
      ? ` ondragover="handleTableRowDragOver(event)" ondrop="handleTableRowDrop(event, '${tablePath}', ${rowIdx})" `
      : '';

    const rowNumCell = showRowNumbers
      ? `<td class="${enableRowDrag ? 'drag-handle' : ''}" ${enableRowDrag ? `draggable="true" ondragstart="handleTableRowDragStart(event, '${tablePath}', ${rowIdx})"` : ''}>${rowIdx + 1}</td>`
      : '';

    const dragBtn = (!showRowNumbers && enableRowDrag)
      ? `<button class="btn-delete-row drag-handle" draggable="true" ondragstart="handleTableRowDragStart(event, '${tablePath}', ${rowIdx})" title="Drag row" type="button"><i class="fas fa-grip-vertical"></i></button>`
      : '';

    return `
      <tr data-row="${rowIdx}" ${dragAttrs}>
        ${rowNumCell}
        ${cells}
        <td class="row-actions">
          ${dragBtn}
          <button class="btn-delete-row" onclick="deleteTableRow('${tableId}', '${tablePath}', ${rowIdx})" title="Delete row" type="button">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Store table metadata for later use
  window.editableTables = window.editableTables || {};
  window.editableTables[tableId] = { columns: [...columns], path: tablePath, data: rows };

  return `
    ${actionsHtml}
    <div class="table-wrap">
      <table class="table" id="${tableId}" data-path="${tablePath}">
        <thead>
          <tr>${showRowNumbers ? '<th>#</th>' : ''}${theadCells}<th class="col-actions"></th></tr>
          <tr class="delete-row">${showRowNumbers ? '<th></th>' : ''}${theadDeleteCells}<th></th></tr>
        </thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;
}

function updateTableCell(tableId, tablePath, rowIdx, key, value) {
  if (!state.currentResults) return;
  
  // Handle paths with array notation like "pages[0].data.sewing_worksheet.quantity_lines"
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  
  if (Array.isArray(target) && target[rowIdx]) {
    if (typeof tablePath === 'string' && tablePath.includes('table_of_contents')) {
      state.tocUserEdited = true;
    }
    // Support nested keys like "sizes.xxs_2_3"
    if (key.includes('.')) {
      setNestedValueInRow(target[rowIdx], key, value.trim());
    } else {
      target[rowIdx][key] = value.trim();
    }
    syncResultsToEditor();
    refreshPreview();
  }
}

function addTableRow(tableId, tablePath) {
  if (!state.currentResults) return;
  
  const tableInfo = window.editableTables?.[tableId];
  if (!tableInfo) return;
  
  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (i === pathParts.length - 1) {
      if (target[part] === undefined) target[part] = [];
      target = target[part];
      break;
    }
    const nextPart = pathParts[i + 1];
    if (target[part] === undefined) {
      target[part] = isNaN(nextPart) ? {} : [];
    }
    target = target[part];
  }
  
  if (Array.isArray(target)) {
    if (typeof tablePath === 'string' && tablePath.includes('table_of_contents')) {
      state.tocUserEdited = true;
    }
    const newRow = {};
    tableInfo.columns.forEach(c => {
      // Support nested keys like "sizes.xxs_2_3"
      if (c.key.includes('.')) {
        setNestedValueInRow(newRow, c.key, '');
      } else {
        newRow[c.key] = '';
      }
    });
    target.push(newRow);
    syncResultsToEditor();
    refreshPreview();
  }
}

function deleteTableRow(tableId, tablePath, rowIdx) {
  if (!state.currentResults) return;
  
  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  
  if (Array.isArray(target) && target.length > rowIdx) {
    if (typeof tablePath === 'string' && tablePath.includes('table_of_contents')) {
      state.tocUserEdited = true;
    }
    target.splice(rowIdx, 1);
    syncResultsToEditor();
    refreshPreview();
  }
}

function addTableColumn(tableId, tablePath) {
  const tableInfo = window.editableTables?.[tableId];
  if (!tableInfo || !state.currentResults) return;
  
  const newKey = `col_${Date.now()}`;
  const newLabel = prompt('New column name:', 'New column');
  if (!newLabel) return;
  
  tableInfo.columns.push({ key: newKey, label: newLabel, numeric: false });

  const columnsPath = (typeof tablePath === 'string' && /table_of_contents$/.test(tablePath))
    ? tablePath.replace(/table_of_contents$/, '_toc_columns')
    : null;

  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (let i = 0; i < pathParts.length; i++) {
    const part = pathParts[i];
    if (i === pathParts.length - 1) {
      if (target[part] === undefined) target[part] = [];
      target = target[part];
      break;
    }
    const nextPart = pathParts[i + 1];
    if (target[part] === undefined) {
      target[part] = isNaN(nextPart) ? {} : [];
    }
    target = target[part];
  }
  
  if (Array.isArray(target)) {
    if (typeof tablePath === 'string' && tablePath.includes('table_of_contents')) {
      state.tocUserEdited = true;
    }
    target.forEach(row => { row[newKey] = ''; });
    if (columnsPath) {
      setNestedValue(state.currentResults, columnsPath, tableInfo.columns.map(c => ({ ...c })));
    }
    syncResultsToEditor();
    refreshPreview();
  }
}

function deleteTableColumn(tableId, tablePath, colIdx) {
  const tableInfo = window.editableTables?.[tableId];
  if (!tableInfo || !state.currentResults) return;
  
  const col = tableInfo.columns[colIdx];
  if (!col) return;
  
  if (!confirm(`Delete the column "${col.label}"?`)) return;
  
  tableInfo.columns.splice(colIdx, 1);

  const columnsPath = (typeof tablePath === 'string' && /table_of_contents$/.test(tablePath))
    ? tablePath.replace(/table_of_contents$/, '_toc_columns')
    : null;
  
  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  
  if (Array.isArray(target)) {
    if (typeof tablePath === 'string' && tablePath.includes('table_of_contents')) {
      state.tocUserEdited = true;
    }
    target.forEach(row => { delete row[col.key]; });
    if (columnsPath) {
      setNestedValue(state.currentResults, columnsPath, tableInfo.columns.map(c => ({ ...c })));
    }
    syncResultsToEditor();
    refreshPreview();
  }
}

function updateColumnHeader(tableId, colIdx, newLabel) {
  const tableInfo = window.editableTables?.[tableId];
  if (!tableInfo) return;
  if (tableInfo.columns[colIdx]) {
    tableInfo.columns[colIdx].label = newLabel;
    try {
      const tablePath = tableInfo.path;
      const columnsPath = (typeof tablePath === 'string' && /table_of_contents$/.test(tablePath))
        ? tablePath.replace(/table_of_contents$/, '_toc_columns')
        : null;
      if (columnsPath && state.currentResults) {
        state.tocUserEdited = true;
        setNestedValue(state.currentResults, columnsPath, tableInfo.columns.map(c => ({ ...c })));
        syncResultsToEditor();
        refreshPreview();
      }
    } catch {}
  }
}

function syncResultsToEditor() {
  if (!state.currentResults) return;
  const editor = qs('results-editor');
  if (editor) {
    editor.value = JSON.stringify(state.currentResults, null, 2);
  }
}

function refreshPreview() {
  if (!state.currentResults) return;

  const templateView = document.getElementById('template-view');
  const renderRoot = document.getElementById('template-render-root');
  if (templateView && !templateView.classList.contains('hidden') && renderRoot) {
    renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
    setTimeout(() => {
      attachEditableListeners();
      attachExtractedImageEditorHandlers();
    }, 0);
    return;
  }

  const previewEl = qs('preview');
  const job = state.jobs.find(j => j.id === state.selectedJobId);
  if (previewEl && job) {
    previewEl.innerHTML = renderResultsPreview(job.mode, state.currentResults);
    attachEditableListeners();
  }
}

function attachEditableListeners() {
  // Attach blur listeners to editable fields
  document.querySelectorAll('.editable-field[data-path]').forEach(el => {
    el.addEventListener('blur', function() {
      const path = this.dataset.path;
      if (!path || !state.currentResults) return;
      
      const value = this.textContent.trim();
      setNestedValue(state.currentResults, path, value);
      syncResultsToEditor();

      const templateView = document.getElementById('template-view');
      const renderRoot = document.getElementById('template-render-root');
      if (templateView && !templateView.classList.contains('hidden') && renderRoot) {
        renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
        setTimeout(() => {
          attachEditableListeners();
          attachExtractedImageEditorHandlers();
        }, 0);
      }
    });
  });
}

function setNestedValue(obj, path, value) {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      current[part] = isNaN(parts[i + 1]) ? {} : [];
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function getValueAtPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function moveArrayItem(arr, fromIdx, toIdx) {
  if (!Array.isArray(arr)) return;
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= arr.length) return;
  if (toIdx < 0 || toIdx >= arr.length) return;
  const [item] = arr.splice(fromIdx, 1);
  const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
  arr.splice(insertAt, 0, item);
}

// ===== TABLE ROW DRAG & DROP =====
window._tableRowDrag = window._tableRowDrag || { tablePath: null, fromIdx: null };

// ===== TOC DOCK (Drag table into right editor panel) =====
window._tocDockDrag = window._tocDockDrag || { active: false };

function handleTocDockDragStart(evt) {
  try {
    window._tocDockDrag = { active: true };
    if (evt && evt.dataTransfer) {
      evt.dataTransfer.effectAllowed = 'move';
      evt.dataTransfer.setData('text/plain', 'toc-dock');
    }
  } catch {}
}

function handleTocDockDragOver(evt) {
  if (!evt) return;
  evt.preventDefault();
  try {
    const el = evt.currentTarget;
    if (el && el.classList) el.classList.add('dragover');
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
  } catch {}
}

function handleTocDockDragLeave(evt) {
  try {
    const el = evt.currentTarget;
    if (el && el.classList) el.classList.remove('dragover');
  } catch {}
}

function handleTocDockDrop(evt) {
  if (!evt) return;
  evt.preventDefault();
  try {
    const el = evt.currentTarget;
    if (el && el.classList) el.classList.remove('dragover');
  } catch {}

  let ok = false;
  try {
    const payload = evt.dataTransfer ? evt.dataTransfer.getData('text/plain') : '';
    ok = payload === 'toc-dock';
  } catch {
    ok = false;
  }
  if (!ok && window._tocDockDrag?.active) ok = true;
  if (!ok) return;

  state.tocEditorDocked = true;
  try { showToast('TOC editor ready'); } catch {}
  const renderRoot = document.getElementById('template-render-root');
  if (renderRoot && state.currentResults) {
    renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
    setTimeout(() => {
      attachEditableListeners();
      attachExtractedImageEditorHandlers();
    }, 0);
  }
}

function handleTableRowDragStart(evt, tablePath, fromIdx) {
  try {
    window._tableRowDrag = { tablePath, fromIdx };
    if (evt && evt.dataTransfer) {
      evt.dataTransfer.effectAllowed = 'move';
      evt.dataTransfer.setData('text/plain', `${tablePath}|${fromIdx}`);
    }
  } catch {}
}

function handleTableRowDragOver(evt) {
  if (!evt) return;
  evt.preventDefault();
  try {
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move';
  } catch {}
}

function handleTableRowDrop(evt, tablePath, toIdx) {
  if (!evt) return;
  evt.preventDefault();
  if (!state.currentResults) return;

  let fromIdx = null;
  let fromPath = null;
  try {
    const payload = evt.dataTransfer ? evt.dataTransfer.getData('text/plain') : '';
    if (payload && payload.includes('|')) {
      const [p, i] = payload.split('|');
      fromPath = p;
      fromIdx = Number(i);
    }
  } catch {}

  if (fromPath == null) {
    fromPath = window._tableRowDrag?.tablePath;
    fromIdx = window._tableRowDrag?.fromIdx;
  }

  if (fromPath !== tablePath) return;
  if (typeof fromIdx !== 'number' || Number.isNaN(fromIdx)) return;

  const targetArr = getValueAtPath(state.currentResults, tablePath);
  if (!Array.isArray(targetArr)) return;

  if (typeof tablePath === 'string' && tablePath.includes('table_of_contents')) {
    state.tocUserEdited = true;
  }

  moveArrayItem(targetArr, fromIdx, toIdx);
  syncResultsToEditor();
  refreshPreview();
}

// Make functions globally available
window.updateTableCell = updateTableCell;
window.addTableRow = addTableRow;
window.deleteTableRow = deleteTableRow;
window.addTableColumn = addTableColumn;
window.deleteTableColumn = deleteTableColumn;
window.updateColumnHeader = updateColumnHeader;
window.handleTableRowDragStart = handleTableRowDragStart;
window.handleTableRowDragOver = handleTableRowDragOver;
window.handleTableRowDrop = handleTableRowDrop;
window.handleTocDockDragStart = handleTocDockDragStart;
window.handleTocDockDragOver = handleTocDockDragOver;
window.handleTocDockDragLeave = handleTocDockDragLeave;
window.handleTocDockDrop = handleTocDockDrop;

function getDocumentPages(results) {
  if (!results) return [];
  if (Array.isArray(results.pages)) {
    const pages = results.pages
      .map(p => ({
        page_number: p.page_number ?? 1,
        raw_text: p.raw_text,
        data: p.data ?? {}
      }))
      .sort((a, b) => (a.page_number || 0) - (b.page_number || 0));

    return normalizeSewingWorksheetPages(pages);
  }
  return [{ page_number: 1, raw_text: results.raw_text, data: results }];
}

function renderItemsTable(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<div class="empty">No items</div>`;
  }

  const rows = items
    .map((it) => {
      const desc = it.descripcion ?? '';
      const qty = it.cantidad;
      const unit = it.unidad;
      const pu = it.precio_unitario;
      const imp = it.importe;
      return `
        <tr>
          <td>${escapeHtml(fmt(desc) || '—')}</td>
          <td class="num">${escapeHtml(fmt(qty) || '—')}</td>
          <td>${escapeHtml(fmt(unit) || '—')}</td>
          <td class="num">${escapeHtml(fmt(pu) || '—')}</td>
          <td class="num">${escapeHtml(fmt(imp) || '—')}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Qty</th>
            <th>Unit</th>
            <th class="num">Unit price</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderProductFactura(d) {
  const ov = d.product_overview || {};
  const toc = Array.isArray(d.table_of_contents) ? d.table_of_contents : [];
  const bomMaterials = Array.isArray(d.bom_product_materials) ? d.bom_product_materials : [];
  const bomImpressions = Array.isArray(d.bom_product_impressions_wide) ? d.bom_product_impressions_wide : [];
  const measPlus = Array.isArray(d.measurements_plus_wide) ? d.measurements_plus_wide : [];
  const measRegular = Array.isArray(d.measurements_regular_wide) ? d.measurements_regular_wide : [];
  const construction = Array.isArray(d.product_details_construction) ? d.product_details_construction : [];
  const extractedTables = Array.isArray(d.items) ? d.items : (Array.isArray(d.additional_tables) ? d.additional_tables : []);

  const overviewHtml = `
    <div class="section-title">Product Overview ${state.editMode ? '<span class="edit-mode-badge"><i class="fas fa-edit"></i> Edit mode</span>' : ''}</div>
    <div class="grid-2">
      <div class="kv">
        ${kvRow('Product Name', ov.product_name, 'product_overview.product_name')}
        ${kvRow('Product ID', ov.product_id, 'product_overview.product_id')}
        ${kvRow('Status', ov.status, 'product_overview.status')}
        ${kvRow('Brand', ov.brand, 'product_overview.brand')}
        ${kvRow('Department', ov.department, 'product_overview.department')}
        ${kvRow('Division', ov.division, 'product_overview.division')}
        ${kvRow('Class', ov.class, 'product_overview.class')}
      </div>
      <div class="kv">
        ${kvRow('Primary Material', ov.primary_material, 'product_overview.primary_material')}
        ${kvRow('Secondary Material', ov.secondary_material, 'product_overview.secondary_material')}
        ${kvRow('Vendor Style #', ov.vendor_style_number, 'product_overview.vendor_style_number')}
        ${kvRow('Workspace ID', ov.workspace_id, 'product_overview.workspace_id')}
        ${kvRow('Design Cycle', ov.design_cycle, 'product_overview.design_cycle')}
        ${kvRow('System Tags', ov.system_tags, 'product_overview.system_tags')}
        ${kvRow('Tags', ov.tags, 'product_overview.tags')}
      </div>
    </div>
  `;

  const tocColumns = [
    { key: 'section', label: 'Section' },
    { key: 'page_title', label: 'Page Title' }
  ];
  const tocHtml = `
    <div class="section-title">Table of Contents</div>
    ${renderEditableTableApp(toc, tocColumns, 'table_of_contents')}
  `;

  const bomMatColumns = [
    { key: 'row', label: '#', numeric: true },
    { key: 'section', label: 'Section' },
    { key: 'use', label: 'Use' },
    { key: 'material_type', label: 'Type' },
    { key: 'connected_material_asset', label: 'Material Asset' },
    { key: 'additional_material_details', label: 'Details' },
    { key: 'supplier', label: 'Supplier' },
    { key: 'bom_code', label: 'BOM Code' },
    { key: 'bom_status', label: 'Status' }
  ];
  const bomMatHtml = `
    <div class="section-title">Bill of Materials - Product Materials</div>
    ${renderEditableTableApp(bomMaterials, bomMatColumns, 'bom_product_materials')}
  `;

  const bomImpColumns = [
    { key: 'row', label: '#', numeric: true },
    { key: 'use', label: 'Use' },
    { key: 'connected_material_asset', label: 'Material Asset' },
    { key: 'additional_material_details', label: 'Details' },
    { key: 'heather_gray', label: 'Heather Gray' },
    { key: 'navy', label: 'Navy' }
  ];
  const bomImpHtml = `
    <div class="section-title">Bill of Materials - Product Impressions</div>
    ${renderEditableTableApp(bomImpressions, bomImpColumns, 'bom_product_impressions_wide')}
  `;

  const measPlusColumns = [
    { key: 'section', label: 'Section' },
    { key: 'pom_name', label: 'POM Name' },
    { key: 'pom_id', label: 'POM ID' },
    { key: 'uom', label: 'UOM' },
    { key: 'tolerance_plus', label: 'Tol+', numeric: true },
    { key: 'tolerance_minus', label: 'Tol-', numeric: true },
    { key: 'xx_large', label: 'XXL', numeric: true },
    { key: '1x', label: '1X', numeric: true },
    { key: '2x', label: '2X', numeric: true },
    { key: '3x', label: '3X', numeric: true },
    { key: '4x', label: '4X', numeric: true }
  ];
  const measPlusHtml = `
    <div class="section-title">Measurements - Plus Sizes</div>
    ${renderEditableTableApp(measPlus, measPlusColumns, 'measurements_plus_wide')}
  `;

  const measRegColumns = [
    { key: 'section', label: 'Section' },
    { key: 'pom_name', label: 'POM Name' },
    { key: 'pom_id', label: 'POM ID' },
    { key: 'uom', label: 'UOM' },
    { key: 'tolerance_plus', label: 'Tol+', numeric: true },
    { key: 'tolerance_minus', label: 'Tol-', numeric: true },
    { key: 'xx_small', label: 'XXS', numeric: true },
    { key: 'x_small', label: 'XS', numeric: true },
    { key: 'small', label: 'S', numeric: true },
    { key: 'medium', label: 'M', numeric: true },
    { key: 'large', label: 'L', numeric: true },
    { key: 'x_large', label: 'XL', numeric: true }
  ];
  const measRegHtml = `
    <div class="section-title">Measurements - Regular Sizes</div>
    ${renderEditableTableApp(measRegular, measRegColumns, 'measurements_regular_wide')}
  `;

  const constColumns = [
    { key: 'section', label: 'Section' },
    { key: 'category', label: 'Category' },
    { key: 'subcategory', label: 'Subcategory' },
    { key: 'detail', label: 'Detail' },
    { key: 'special_instructions', label: 'Instructions' },
    { key: 'product_details_id', label: 'ID' },
    { key: 'status', label: 'Status' }
  ];
  const constHtml = `
    <div class="section-title">Product Details - Construction</div>
    ${renderEditableTableApp(construction, constColumns, 'product_details_construction')}
  `;

  const extraTablesHtml = extractedTables.length
    ? `
      <div class="section-title">Extracted Tables</div>
      ${renderAdditionalTables(extractedTables)}
    `
    : '';

  return `
    <div class="page-card">
      <div class="page-title">Product Specification</div>
      ${overviewHtml}
      ${tocHtml}
      ${bomMatHtml}
      ${bomImpHtml}
      ${measPlusHtml}
      ${measRegHtml}
      ${constHtml}
      ${extraTablesHtml}
    </div>
  `;
}

function renderDocumentPage(page) {
  const root = page.data || {};
  const d = root?.template_type === 'generic_document' && root?.generic_document
    ? root.generic_document
    : (root?.template_type ? root : root);

  if (root?.template_type === 'sewing_worksheet') {
    return renderSewingWorksheetPage(page);
  }

  if (root?.template_type === 'product_spec') {
    return renderProductFactura(root);
  }

  if (root?.template_type === 'unknown' && (root?.product_overview || root?.bom_product_materials || root?.additional_tables || root?.items)) {
    return renderProductFactura(root);
  }

  if (root?.template_type === 'product_factura') {
    return renderProductFactura(root);
  }

  const em = d.emisor || {};
  const re = d.receptor || {};
  const items = d.items || [];
  const rawText = page.raw_text || d.raw_text || '';

  const general = `
    <div class="kv">
      <div class="kv-title">General information</div>
      ${kvRow('Document type', d.tipo_documento)}
      ${kvRow('Document number', d.numero_documento)}
      ${kvRow('Issue date', d.fecha_emision)}
      ${kvRow('Due date', d.fecha_vencimiento)}
      ${kvRow('Currency', d.moneda)}
      ${kvRow('Payment method', d.metodo_pago)}
      ${kvRow('Payment terms', d.condiciones_pago)}
      ${kvRow('Notes', d.notas)}
    </div>
  `;

  const totals = `
    <div class="kv">
      <div class="kv-title">Totals</div>
      ${kvRow('Subtotal', d.subtotal)}
      ${kvRow('Taxes', d.impuestos)}
      ${kvRow('Total', d.total)}
    </div>
  `;

  const parties = `
    <div class="grid-2">
      <div class="kv">
        <div class="kv-title">Issuer</div>
        ${kvRow('Name', em.nombre)}
        ${kvRow('Tax ID', em.rfc)}
        ${kvRow('Address', em.direccion)}
        ${kvRow('Phone', em.telefono)}
        ${kvRow('Email', em.email)}
      </div>
      <div class="kv">
        <div class="kv-title">Receiver</div>
        ${kvRow('Name', re.nombre)}
        ${kvRow('Tax ID', re.rfc)}
        ${kvRow('Address', re.direccion)}
        ${kvRow('Phone', re.telefono)}
        ${kvRow('Email', re.email)}
      </div>
    </div>
  `;

  const textBlock = rawText
    ? `<details class="raw"><summary>Extracted text (page ${escapeHtml(page.page_number)})</summary><pre>${escapeHtml(rawText)}</pre></details>`
    : '';

  return `
    <div class="page-card">
      <div class="page-title">Page ${escapeHtml(page.page_number)}</div>
      <div class="grid-2">
        ${general}
        ${totals}
      </div>
      ${parties}
      <div class="section-title">Items</div>
      ${renderItemsTable(items)}
      ${textBlock}
    </div>
  `;
}

function renderDesignResults(results) {
  // Backward compatible mapping (old Spanish keys -> new English keys)
  const suggestedChanges = Array.isArray(results?.suggested_changes)
    ? results.suggested_changes
    : (Array.isArray(results?.cambios_sugeridos) ? results.cambios_sugeridos.map(c => ({
      change: c?.descripcion ?? '',
      impact: c?.impacto ?? null,
      priority: c?.prioridad ?? null
    })) : []);
  const detectedText = Array.isArray(results?.detected_text)
    ? results.detected_text
    : (Array.isArray(results?.textos_detectados) ? results.textos_detectados.map(t => ({
      text: t?.texto ?? '',
      location: t?.ubicacion ?? null
    })) : []);

  const garmentType = results?.garment_type ?? results?.tipo_prenda;
  const style = results?.style ?? results?.estilo;
  const currentColor = results?.current_color ?? results?.color_actual;
  const apparentMaterial = results?.apparent_material ?? results?.material_aparente;
  const imageQuality = results?.image_quality ?? results?.calidad_imagen;
  const analysisConfidence = results?.analysis_confidence ?? results?.confianza_analisis;
  const overallSummary = results?.overall_summary ?? results?.descripcion_general;
  const notes = results?.notes ?? results?.observaciones_adicionales;

  const changesRows = suggestedChanges
    .map(c => `
      <tr>
        <td>${escapeHtml(fmt(c.change) || '—')}</td>
        <td>${escapeHtml(fmt(c.impact) || '—')}</td>
        <td>${escapeHtml(fmt(c.priority) || '—')}</td>
      </tr>
    `)
    .join('');

  const textRows = detectedText
    .map(t => `
      <tr>
        <td>${escapeHtml(fmt(t.text) || '—')}</td>
        <td>${escapeHtml(fmt(t.location) || '—')}</td>
      </tr>
    `)
    .join('');

  const changesTable = suggestedChanges.length
    ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Change</th>
              <th>Impact</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>${changesRows}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">No suggested changes</div>`;

  const detectedTextTable = detectedText.length
    ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Text</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>${textRows}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">No detected text</div>`;

  return `
    <div class="preview-root">
      <div class="page-card">
        <div class="page-title">Design analysis</div>
        <div class="grid-2">
          <div class="kv">
            <div class="kv-title">Summary</div>
            ${kvRow('Garment type', garmentType)}
            ${kvRow('Style', style)}
            ${kvRow('Current color', currentColor)}
            ${kvRow('Apparent material', apparentMaterial)}
            ${kvRow('Image quality', imageQuality)}
            ${kvRow('Analysis confidence', analysisConfidence)}
          </div>
          <div class="kv">
            <div class="kv-title">Details</div>
            ${kvRow('Overall summary', overallSummary)}
            ${kvRow('Notes', notes)}
          </div>
        </div>

        <div class="section-title">Suggested changes</div>
        ${changesTable}

        <div class="section-title">Detected text</div>
        ${detectedTextTable}
      </div>
    </div>
  `;
}

function renderResultsPreview(mode, results) {
  if (!results) {
    return `<p class="empty">No results</p>`;
  }

  // Export buttons
  const exportButtons = `
    <div class="export-buttons">
      <button class="btn-export" onclick="exportToPDF()">
        <i class="fas fa-file-pdf"></i> Export to PDF
      </button>
      <button class="btn-export" onclick="exportToExcel()">
        <i class="fas fa-file-excel"></i> Export to Excel
      </button>
    </div>
  `;

  if (mode === 'DESIGN') {
    return exportButtons + renderDesignResults(results);
  }

  if (shouldUseTemplateView(mode, results)) {
    return exportButtons + renderTemplateView(mode, results);
  }

  // Direct product_factura template (not wrapped in pages)
  if (results?.template_type === 'product_factura') {
    const imagesHtml = renderExtractedImages(results._extracted_images);
    return `<div class="preview-root">${exportButtons}${renderProductFactura(results)}${imagesHtml}</div>`;
  }

  const pages = getDocumentPages(results);
  const pagesHtml = pages.map(renderDocumentPage).join('');
  const imagesHtml = renderExtractedImages(results._extracted_images);
  return `<div class="preview-root">${exportButtons}${pagesHtml}${imagesHtml}</div>`;
}

function renderExtractedImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return '';
  }
  
  // Store images globally for ROI access
  window._extractedImages = images;
  
  const imagesHtml = images.map((img, idx) => `
    <div class="extracted-image-item" data-image-idx="${idx}" draggable="true" ondragstart="event.dataTransfer.setData('text/plain', JSON.stringify({type:'extracted_image', idx:${idx}}));">
      <div class="extracted-image-header">
        <span class="image-info">Page ${img.page}, Image #${img.index} (${img.width}x${img.height})</span>
        <button class="btn-ocr-roi" onclick="openImageRoiModal(${idx})" title="Select region for OCR">
          <i class="fas fa-crop-alt"></i> OCR ROI
        </button>
      </div>
      <img src="${img.data_url}" alt="Extracted image ${idx + 1}" class="extracted-image-preview" onclick="openImageRoiModal(${idx})" style="cursor:pointer" />
      ${img.ocr_text ? `<div class="extracted-image-ocr"><strong>OCR text:</strong><pre>${escapeHtml(img.ocr_text)}</pre></div>` : ''}
      <div class="extracted-image-roi-results" id="roi-results-${idx}" style="display:none"></div>
    </div>
  `).join('');
  
  return `
    <div class="extracted-images-section">
      <div class="section-title">
        <i class="fas fa-images"></i> Extracted images from PDF (${images.length})
      </div>
      <div class="extracted-images-grid">
        ${imagesHtml}
      </div>
    </div>
    
    <!-- ROI Selection Modal -->
    <div id="roi-modal" class="roi-modal" style="display:none">
      <div class="roi-modal-content">
        <div class="roi-modal-header">
          <h3><i class="fas fa-crop-alt"></i> Extract Image Region</h3>
          <button class="roi-modal-close" onclick="closeRoiModal()">&times;</button>
        </div>
        <div class="roi-modal-body">
          <div class="roi-tabs">
            <button class="roi-tab active" onclick="switchRoiTab('auto')" id="roi-tab-auto">
              <i class="fas fa-magic"></i> Auto Detect
            </button>
            <button class="roi-tab" onclick="switchRoiTab('manual')" id="roi-tab-manual">
              <i class="fas fa-draw-polygon"></i> Manual Select
            </button>
          </div>
          
          <div class="roi-auto-panel" id="roi-auto-panel">
            <div class="roi-instructions">
              <i class="fas fa-info-circle"></i> Click a detected region to extract text and image.
            </div>
            <div class="roi-detected-regions" id="roi-detected-regions">
              <div class="roi-detecting"><div class="spinner"></div> Detecting text regions...</div>
            </div>
          </div>
          
          <div class="roi-manual-panel" id="roi-manual-panel" style="display:none">
            <div class="roi-instructions">
              <i class="fas fa-info-circle"></i> Draw a rectangle over the area you want to extract.
            </div>
          </div>
          
          <div class="roi-canvas-container">
            <canvas id="roi-modal-canvas"></canvas>
          </div>
          <div class="roi-info" id="roi-modal-info" style="display:none">
            <strong>Region:</strong> <span id="roi-modal-coords"></span>
          </div>
          <div class="roi-selected-rois" id="roi-selected-rois" style="display:none"></div>
        </div>
        <div class="roi-modal-footer">
          <label class="roi-checkbox">
            <input type="checkbox" id="roi-use-claude">
            <span>Use Claude Vision (more accurate OCR)</span>
          </label>
          <div class="roi-modal-buttons">
            <button class="btn-secondary" onclick="closeRoiModal()">Cancel</button>
            <button class="btn-info" id="roi-extract-image-btn" onclick="extractRoiImageOnly()" disabled>
              <i class="fas fa-image"></i> Image Only
            </button>
            <button class="btn-success" id="roi-extract-btn" onclick="extractRoiText()" disabled>
              <i class="fas fa-file-alt"></i> Text + Image
            </button>
          </div>
        </div>
        <div class="roi-modal-results" id="roi-modal-results" style="display:none">
          <div class="roi-results-header">
            <strong><i class="fas fa-file-alt"></i> Extracted Text:</strong>
            <div class="roi-results-actions">
              <button class="btn-sm" onclick="copyRoiText()" title="Copy text"><i class="fas fa-copy"></i></button>
            </div>
          </div>
          <pre id="roi-modal-text"></pre>
          <div class="roi-cropped-section" id="roi-cropped-section" style="display:none">
            <strong><i class="fas fa-image"></i> Cropped Image:</strong>
            <div class="roi-cropped-preview">
              <img id="roi-cropped-img" src="" alt="Cropped region" />
              <div id="roi-cropped-gallery"></div>
            </div>
            <div class="roi-cropped-actions">
              <button class="btn-primary btn-sm" onclick="downloadCroppedImage()">
                <i class="fas fa-download"></i> Download Image
              </button>
              <button class="btn-secondary btn-sm" onclick="attachCroppedImage()">
                <i class="fas fa-paperclip"></i> Attach to Results
              </button>
            </div>
          </div>
        </div>
        <div class="roi-modal-loading" id="roi-modal-loading" style="display:none">
          <div class="spinner"></div>
          <span id="roi-loading-text">Processing...</span>
        </div>
      </div>
    </div>
  `;
}

// ROI Modal State
const roiModalState = {
  imageIdx: null,
  canvas: null,
  ctx: null,
  image: null,
  imageData: null,
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentRoi: null,
  selectedRois: [],
  selectedRegionIndices: [],
  scale: 1,
  detectedRegions: [],
  activeTab: 'auto',
  lastCroppedImage: null,
  lastCroppedImages: [],
  lastExtractedPerZone: [],
  selectedRegion: null
};

function openImageRoiModal(imageIdx) {
  const images = window._extractedImages;
  if (!images || !images[imageIdx]) return;
  
  const img = images[imageIdx];
  roiModalState.imageIdx = imageIdx;
  roiModalState.imageData = img.data_url;
  roiModalState.currentRoi = null;
  roiModalState.selectedRois = [];
  roiModalState.selectedRegionIndices = [];
  roiModalState.detectedRegions = [];
  roiModalState.activeTab = 'auto';
  roiModalState.lastCroppedImage = null;
  roiModalState.lastCroppedImages = [];
  roiModalState.lastExtractedPerZone = [];
  
  // Show modal
  const modal = document.getElementById('roi-modal');
  modal.style.display = 'flex';
  
  // Reset tabs
  switchRoiTab('auto');
  
  // Load image into canvas
  const canvas = document.getElementById('roi-modal-canvas');
  const ctx = canvas.getContext('2d');
  roiModalState.canvas = canvas;
  roiModalState.ctx = ctx;
  
  const imgEl = new Image();
  imgEl.onload = () => {
    roiModalState.image = imgEl;
    
    // Calculate scale to fit in modal
    const container = document.querySelector('.roi-canvas-container');
    const maxWidth = Math.min(container.clientWidth - 20, 800);
    const maxHeight = 500;
    
    let width = imgEl.width;
    let height = imgEl.height;
    roiModalState.scale = 1;
    
    if (width > maxWidth) {
      roiModalState.scale = maxWidth / width;
      width = maxWidth;
      height = imgEl.height * roiModalState.scale;
    }
    if (height > maxHeight) {
      roiModalState.scale = Math.min(roiModalState.scale, maxHeight / imgEl.height);
      width = imgEl.width * roiModalState.scale;
      height = imgEl.height * roiModalState.scale;
    }
    
    canvas.width = width;
    canvas.height = height;
    redrawRoiCanvas();
    
    // Bind canvas events for manual mode
    canvas.onmousedown = (e) => {
      if (roiModalState.activeTab === 'manual') startRoiDrawing(e);
    };
    canvas.onmousemove = (e) => {
      if (roiModalState.activeTab === 'manual') drawRoi(e);
      else highlightRegionOnHover(e);
    };
    canvas.onmouseup = stopRoiDrawing;
    canvas.onmouseleave = stopRoiDrawing;
    canvas.onclick = (e) => {
      if (roiModalState.activeTab !== 'auto') return;
      selectRegionOnClick(e);
    };
    
    // Touch support
    canvas.ontouchstart = (e) => {
      if (roiModalState.activeTab !== 'manual') return;
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      startRoiDrawing({ offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top });
    };
    canvas.ontouchmove = (e) => {
      if (roiModalState.activeTab !== 'manual') return;
      e.preventDefault();
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      drawRoi({ offsetX: touch.clientX - rect.left, offsetY: touch.clientY - rect.top });
    };
    canvas.ontouchend = stopRoiDrawing;
    
    // Auto-detect regions
    detectTextRegions();
  };
  imgEl.src = img.data_url;
  
  // Reset UI
  document.getElementById('roi-extract-btn').disabled = true;
  document.getElementById('roi-extract-image-btn').disabled = true;
  document.getElementById('roi-modal-info').style.display = 'none';
  document.getElementById('roi-modal-results').style.display = 'none';
  document.getElementById('roi-modal-loading').style.display = 'none';
  document.getElementById('roi-cropped-section').style.display = 'none';
  updateSelectedRoisUI();
}

function switchRoiTab(tab) {
  roiModalState.activeTab = tab;
  
  document.getElementById('roi-tab-auto').classList.toggle('active', tab === 'auto');
  document.getElementById('roi-tab-manual').classList.toggle('active', tab === 'manual');
  document.getElementById('roi-auto-panel').style.display = tab === 'auto' ? 'block' : 'none';
  document.getElementById('roi-manual-panel').style.display = tab === 'manual' ? 'block' : 'none';
  
  // Reset selection when switching tabs
  roiModalState.currentRoi = null;
  roiModalState.selectedRegion = null;
  roiModalState.selectedRois = [];
  roiModalState.selectedRegionIndices = [];
  roiModalState.lastExtractedPerZone = [];
  document.getElementById('roi-extract-btn').disabled = true;
  document.getElementById('roi-extract-image-btn').disabled = true;
  document.getElementById('roi-modal-info').style.display = 'none';
  updateSelectedRoisUI();
  redrawRoiCanvas();
}

async function detectTextRegions() {
  const { imageData } = roiModalState;
  if (!imageData) return;
  
  const regionsContainer = document.getElementById('roi-detected-regions');
  regionsContainer.innerHTML = '<div class="roi-detecting"><div class="spinner"></div> Detecting regions...</div>';
  
  try {
    let base64 = imageData;
    if (base64.includes(',')) {
      base64 = base64.split(',')[1];
    }
    
    const response = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/detect-regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: base64 })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    roiModalState.detectedRegions = result.regions || [];
    renderDetectedRegions();
    redrawRoiCanvas();
    
  } catch (error) {
    console.error('Error detecting regions:', error);
    regionsContainer.innerHTML = `
      <div class="roi-no-regions">
        <i class="fas fa-exclamation-triangle"></i> 
        Could not auto-detect regions.
        <br>Use the "Manual Select" tab to draw a region.
      </div>
    `;
  }
}

function renderDetectedRegions() {
  const { detectedRegions } = roiModalState;
  const container = document.getElementById('roi-detected-regions');
  
  if (detectedRegions.length === 0) {
    container.innerHTML = `
      <div class="roi-no-regions">
        <i class="fas fa-info-circle"></i> 
        No regions detected.
        <br>Use the "Manual Select" tab to draw a region.
      </div>
    `;
    return;
  }
  
  // Count by type
  const textCount = detectedRegions.filter(r => r.type === 'text').length;
  const visualCount = detectedRegions.filter(r => r.is_visual).length;
  const mixedCount = detectedRegions.filter(r => r.type === 'mixed').length;
  
  const getTypeIcon = (type) => {
    switch(type) {
      case 'text': return '<i class="fas fa-font" title="Text"></i>';
      case 'illustration': return '<i class="fas fa-image" title="Illustration"></i>';
      case 'box': return '<i class="fas fa-square" title="Box"></i>';
      case 'shape': return '<i class="fas fa-shapes" title="Shape"></i>';
      case 'banner': return '<i class="fas fa-minus" title="Banner"></i>';
      case 'mixed': return '<i class="fas fa-layer-group" title="Mixed"></i>';
      case 'colored': return '<i class="fas fa-palette" title="Color Area"></i>';
      case 'section': return '<i class="fas fa-th-large" title="Section"></i>';
      default: return '<i class="fas fa-vector-square"></i>';
    }
  };
  
  const getTypeClass = (type, isVisual) => {
    if (type === 'text') return 'type-text';
    if (type === 'mixed') return 'type-mixed';
    if (isVisual) return 'type-visual';
    return '';
  };
  
  const regionsHtml = detectedRegions.map((region, idx) => `
    <div class="roi-region-item ${getTypeClass(region.type, region.is_visual)}" 
         onclick="toggleDetectedRegion(${idx})" data-region-idx="${idx}">
      <div class="roi-region-info">
        <span class="roi-region-num">#${idx + 1}</span>
        <span class="roi-region-type">${getTypeIcon(region.type)}</span>
        <span class="roi-region-size">${region.width}x${region.height}px</span>
        <span class="roi-region-conf">${Math.round(region.confidence)}%</span>
      </div>
      <div class="roi-region-text">${region.text ? escapeHtml(region.text.substring(0, 40)) + (region.text.length > 40 ? '...' : '') : `<em>${region.type}</em>`}</div>
    </div>
  `).join('');
  
  container.innerHTML = `
    <div class="roi-regions-summary">
      <span class="roi-summary-item"><i class="fas fa-font"></i> ${textCount} text</span>
      <span class="roi-summary-item"><i class="fas fa-image"></i> ${visualCount} visual</span>
      ${mixedCount > 0 ? `<span class="roi-summary-item"><i class="fas fa-layer-group"></i> ${mixedCount} mixed</span>` : ''}
    </div>
    <div class="roi-regions-list">
      ${regionsHtml}
    </div>
    <div class="roi-regions-hint">
      <i class="fas fa-mouse-pointer"></i> Click a region or click directly on the image
    </div>
  `;
}

function toggleDetectedRegion(idx) {
  const region = roiModalState.detectedRegions[idx];
  if (!region) return;

  const existsAt = roiModalState.selectedRois.findIndex(r => r.regionIdx === idx);
  if (existsAt >= 0) {
    roiModalState.selectedRois.splice(existsAt, 1);
    roiModalState.selectedRegionIndices = roiModalState.selectedRois
      .filter(r => typeof r.regionIdx === 'number')
      .map(r => r.regionIdx);
  } else {
    roiModalState.selectedRois.push({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      type: region.type || (region.is_visual ? 'visual' : 'text'),
      source: 'auto',
      regionIdx: idx
    });
    roiModalState.selectedRegionIndices.push(idx);
  }

  const last = roiModalState.selectedRois[roiModalState.selectedRois.length - 1] || null;
  roiModalState.currentRoi = last ? { x: last.x, y: last.y, width: last.width, height: last.height } : null;
  roiModalState.selectedRegion = last ? { type: last.type } : null;

  // Highlight selected in list
  document.querySelectorAll('.roi-region-item').forEach((el, i) => {
    el.classList.toggle('selected', roiModalState.selectedRegionIndices.includes(i));
  });

  const count = roiModalState.selectedRois.length;
  if (count > 0) {
    const r = roiModalState.currentRoi;
    document.getElementById('roi-modal-coords').textContent = 
      `Selected: ${count} | Last: X: ${r.x}, Y: ${r.y}, ${r.width}x${r.height}px`;
    document.getElementById('roi-modal-info').style.display = 'block';
    document.getElementById('roi-extract-btn').disabled = false;
    document.getElementById('roi-extract-image-btn').disabled = false;
  } else {
    document.getElementById('roi-extract-btn').disabled = true;
    document.getElementById('roi-extract-image-btn').disabled = true;
    document.getElementById('roi-modal-info').style.display = 'none';
  }

  updateSelectedRoisUI();
  redrawRoiCanvas();
}

function highlightRegionOnHover(e) {
  if (roiModalState.activeTab !== 'auto' || roiModalState.detectedRegions.length === 0) return;
  
  const { scale, detectedRegions } = roiModalState;
  const mouseX = e.offsetX / scale;
  const mouseY = e.offsetY / scale;
  
  // Find region under cursor
  let hoveredIdx = -1;
  for (let i = 0; i < detectedRegions.length; i++) {
    const r = detectedRegions[i];
    if (mouseX >= r.x && mouseX <= r.x + r.width && mouseY >= r.y && mouseY <= r.y + r.height) {
      hoveredIdx = i;
      break;
    }
  }
  
  // Update cursor
  roiModalState.canvas.style.cursor = hoveredIdx >= 0 ? 'pointer' : 'default';
}

function selectRegionOnClick(e) {
  if (roiModalState.activeTab !== 'auto' || roiModalState.detectedRegions.length === 0) return;
  
  const { scale, detectedRegions } = roiModalState;
  const mouseX = e.offsetX / scale;
  const mouseY = e.offsetY / scale;
  
  // Find region under cursor
  for (let i = 0; i < detectedRegions.length; i++) {
    const r = detectedRegions[i];
    if (mouseX >= r.x && mouseX <= r.x + r.width && mouseY >= r.y && mouseY <= r.y + r.height) {
      toggleDetectedRegion(i);
      return;
    }
  }
}

function closeRoiModal() {
  document.getElementById('roi-modal').style.display = 'none';
  roiModalState.imageIdx = null;
  roiModalState.currentRoi = null;
  roiModalState.selectedRois = [];
  roiModalState.selectedRegionIndices = [];
  roiModalState.lastExtractedPerZone = [];
}

function redrawRoiCanvas() {
  const { ctx, canvas, image, currentRoi, scale, detectedRegions, activeTab } = roiModalState;
  if (!image) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  
  // Color mapping for region types
  const getRegionColor = (region) => {
    switch(region.type) {
      case 'text': return '#00ff00';      // Green for text
      case 'illustration': return '#ff9800'; // Orange for illustrations
      case 'box': return '#2196f3';       // Blue for boxes
      case 'shape': return '#9c27b0';     // Purple for shapes
      case 'banner': return '#00bcd4';    // Cyan for banners
      case 'mixed': return '#ffeb3b';     // Yellow for mixed
      case 'colored': return '#e91e63';   // Pink for colored areas
      case 'section': return '#607d8b';   // Gray for sections
      default: return '#00ff00';
    }
  };
  
  // Draw detected regions in auto mode
  if (activeTab === 'auto' && detectedRegions.length > 0) {
    detectedRegions.forEach((region, idx) => {
      const isSelected = roiModalState.selectedRegionIndices.includes(idx);
      
      const color = getRegionColor(region);
      ctx.strokeStyle = isSelected ? '#ff0000' : color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.setLineDash(isSelected ? [] : [5, 3]);
      ctx.strokeRect(
        region.x * scale,
        region.y * scale,
        region.width * scale,
        region.height * scale
      );
      ctx.setLineDash([]);
      
      // Draw region number with background
      if (!isSelected) {
        const numX = region.x * scale + 2;
        const numY = region.y * scale + 2;
        ctx.fillStyle = color;
        ctx.fillRect(numX, numY, 18, 16);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 11px Arial';
        ctx.fillText(`${idx + 1}`, numX + 4, numY + 12);
      }
    });
  }
  
  if (currentRoi) {
    // Draw selected ROI rectangle
    ctx.strokeStyle = '#ff0000';
    ctx.lineWidth = 3;
    ctx.strokeRect(
      currentRoi.x * scale,
      currentRoi.y * scale,
      currentRoi.width * scale,
      currentRoi.height * scale
    );
    
    // Semi-transparent overlay outside ROI
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    const rx = currentRoi.x * scale;
    const ry = currentRoi.y * scale;
    const rw = currentRoi.width * scale;
    const rh = currentRoi.height * scale;
    
    ctx.fillRect(0, 0, canvas.width, ry);
    ctx.fillRect(0, ry + rh, canvas.width, canvas.height - ry - rh);
    ctx.fillRect(0, ry, rx, rh);
    ctx.fillRect(rx + rw, ry, canvas.width - rx - rw, rh);
  }

  if (roiModalState.selectedRois.length > 0) {
    roiModalState.selectedRois.forEach((r) => {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(r.x * scale, r.y * scale, r.width * scale, r.height * scale);
    });
  }
}

function startRoiDrawing(e) {
  roiModalState.isDrawing = true;
  roiModalState.startX = e.offsetX / roiModalState.scale;
  roiModalState.startY = e.offsetY / roiModalState.scale;
  roiModalState.currentRoi = null;
}

function drawRoi(e) {
  if (!roiModalState.isDrawing) return;
  
  const currentX = e.offsetX / roiModalState.scale;
  const currentY = e.offsetY / roiModalState.scale;
  
  const x = Math.min(roiModalState.startX, currentX);
  const y = Math.min(roiModalState.startY, currentY);
  const width = Math.abs(currentX - roiModalState.startX);
  const height = Math.abs(currentY - roiModalState.startY);
  
  roiModalState.currentRoi = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  };
  
  redrawRoiCanvas();
  
  // Update info
  document.getElementById('roi-modal-coords').textContent = 
    `X: ${roiModalState.currentRoi.x}, Y: ${roiModalState.currentRoi.y}, ` +
    `${roiModalState.currentRoi.width}x${roiModalState.currentRoi.height}px`;
  document.getElementById('roi-modal-info').style.display = 'block';
}

function stopRoiDrawing() {
  if (roiModalState.isDrawing && roiModalState.currentRoi && 
      roiModalState.currentRoi.width > 5 && roiModalState.currentRoi.height > 5) {
    roiModalState.selectedRois.push({
      ...roiModalState.currentRoi,
      type: 'manual',
      source: 'manual'
    });
    roiModalState.selectedRegionIndices = roiModalState.selectedRois
      .filter(r => typeof r.regionIdx === 'number')
      .map(r => r.regionIdx);
    document.getElementById('roi-extract-btn').disabled = roiModalState.selectedRois.length === 0;
    document.getElementById('roi-extract-image-btn').disabled = roiModalState.selectedRois.length === 0;
    document.getElementById('roi-modal-coords').textContent = 
      `Selected: ${roiModalState.selectedRois.length} | Last: X: ${roiModalState.currentRoi.x}, Y: ${roiModalState.currentRoi.y}, ${roiModalState.currentRoi.width}x${roiModalState.currentRoi.height}px`;
    document.getElementById('roi-modal-info').style.display = 'block';
    updateSelectedRoisUI();
  }
  roiModalState.isDrawing = false;
}

function removeSelectedRoi(idx) {
  if (idx < 0 || idx >= roiModalState.selectedRois.length) return;
  const removed = roiModalState.selectedRois[idx];
  roiModalState.selectedRois.splice(idx, 1);
  if (removed && typeof removed.regionIdx === 'number') {
    roiModalState.selectedRegionIndices = roiModalState.selectedRegionIndices.filter(i => i !== removed.regionIdx);
  }
  const last = roiModalState.selectedRois[roiModalState.selectedRois.length - 1] || null;
  roiModalState.currentRoi = last ? { x: last.x, y: last.y, width: last.width, height: last.height } : null;
  document.getElementById('roi-extract-btn').disabled = roiModalState.selectedRois.length === 0;
  document.getElementById('roi-extract-image-btn').disabled = roiModalState.selectedRois.length === 0;
  updateSelectedRoisUI();
  redrawRoiCanvas();
}

function clearSelectedRois() {
  roiModalState.selectedRois = [];
  roiModalState.selectedRegionIndices = [];
  roiModalState.currentRoi = null;
  roiModalState.selectedRegion = null;
  document.getElementById('roi-extract-btn').disabled = true;
  document.getElementById('roi-extract-image-btn').disabled = true;
  document.getElementById('roi-modal-info').style.display = 'none';
  updateSelectedRoisUI();
  redrawRoiCanvas();
}

function updateSelectedRoisUI() {
  const container = document.getElementById('roi-selected-rois');
  if (!container) return;
  const count = roiModalState.selectedRois.length;
  if (count === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }
  const items = roiModalState.selectedRois.map((r, idx) => {
    const label = r.source === 'manual' ? 'Manual' : (r.type || 'Auto');
    return `
      <div class="roi-selected-item">
        <span class="roi-selected-label">${label}</span>
        <span class="roi-selected-coords">X:${r.x} Y:${r.y} ${r.width}x${r.height}</span>
        <button class="btn-sm" onclick="removeSelectedRoi(${idx})" title="Remove"><i class="fas fa-times"></i></button>
      </div>
    `;
  }).join('');
  container.innerHTML = `
    <div class="roi-selected-header">
      <strong>Selected regions: ${count}</strong>
      <button class="btn-sm" onclick="clearSelectedRois()" title="Clear"><i class="fas fa-eraser"></i></button>
    </div>
    <div class="roi-selected-list">${items}</div>
  `;
  container.style.display = 'block';
}

async function extractRoiText() {
  const { imageData } = roiModalState;
  const rois = roiModalState.selectedRois.length > 0 ? roiModalState.selectedRois : (roiModalState.currentRoi ? [{...roiModalState.currentRoi, source: 'single'}] : []);
  if (rois.length === 0 || !imageData) return;
  
  const useClaude = document.getElementById('roi-use-claude').checked;
  
  document.getElementById('roi-modal-loading').style.display = 'flex';
  document.getElementById('roi-loading-text').textContent = 'Extracting text and image...';
  document.getElementById('roi-modal-results').style.display = 'none';
  document.getElementById('roi-cropped-section').style.display = 'none';
  
  try {
    let base64 = imageData;
    if (base64.includes(',')) {
      base64 = base64.split(',')[1];
    }
    
    const texts = [];
    const cropped = [];
    const perZone = [];

    for (let i = 0; i < rois.length; i++) {
      const r = rois[i];
      const response = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/ocr/roi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: base64,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          use_claude: useClaude
        })
      });

      const result = await response.json();
      if (result.error) {
        throw new Error(result.error);
      }

      texts.push(`--- Region ${i + 1} (${r.width}x${r.height}) ---\n${result.text || '(No text found)'}`);
      if (result.cropped_image) {
        cropped.push({ idx: i, dataUrl: result.cropped_image, roi: r });
      }

      perZone.push({
        roi: { x: r.x, y: r.y, width: r.width, height: r.height },
        text: result.text || '',
        cropped_image: result.cropped_image || null
      });
    }

    roiModalState.lastCroppedImages = cropped.map(c => c.dataUrl);
    roiModalState.lastCroppedImage = roiModalState.lastCroppedImages[0] || null;
    roiModalState.lastExtractedPerZone = perZone;

    document.getElementById('roi-modal-text').textContent = texts.join('\n\n');
    document.getElementById('roi-modal-results').style.display = 'block';

    if (cropped.length > 0) {
      const galleryHtml = cropped.map((c) => `
        <div class="roi-crop-tile">
          <img src="${c.dataUrl}" alt="Cropped region" />
          <button class="btn-sm" onclick="downloadImageFromSrc('${c.dataUrl}', 'roi_${roiModalState.imageIdx}_${Date.now()}_${c.idx + 1}.png')">
            <i class="fas fa-download"></i> Download
          </button>
        </div>
      `).join('');
      const imgEl = document.getElementById('roi-cropped-img');
      if (imgEl) imgEl.src = roiModalState.lastCroppedImage;
      const section = document.getElementById('roi-cropped-section');
      section.style.display = 'block';
      const gallery = document.getElementById('roi-cropped-gallery');
      if (gallery) gallery.innerHTML = `<div class="roi-crops-grid">${galleryHtml}</div>`;
    }

    const resultsDiv = document.getElementById(`roi-results-${roiModalState.imageIdx}`);
    if (resultsDiv) {
      const mainGallery = cropped.map((c) => `
        <div class="roi-result-image">
          <img src="${c.dataUrl}" alt="Cropped region" />
          <button class="btn-sm" onclick="downloadImageFromSrc('${c.dataUrl}', 'roi_${roiModalState.imageIdx}_${Date.now()}_${c.idx + 1}.png')">
            <i class="fas fa-download"></i> Download
          </button>
        </div>
      `).join('');
      resultsDiv.innerHTML = `
        <div class="roi-result-item">
          <div class="roi-result-header">
            <strong>OCR ROI (Regions: ${rois.length}):</strong>
          </div>
          <pre>${escapeHtml(texts.join('\n\n'))}</pre>
          ${mainGallery ? `<div class="roi-result-gallery">${mainGallery}</div>` : ''}
        </div>
      `;
      resultsDiv.style.display = 'block';
    }
    
  } catch (error) {
    console.error('OCR ROI error:', error);
    alert('Failed to extract text: ' + error.message);
  } finally {
    document.getElementById('roi-modal-loading').style.display = 'none';
  }
}

function copyRoiText() {
  const text = document.getElementById('roi-modal-text').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Text copied to clipboard');
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

async function extractRoiImageOnly() {
  const { imageData, image } = roiModalState;
  const rois = roiModalState.selectedRois.length > 0 ? roiModalState.selectedRois : (roiModalState.currentRoi ? [{...roiModalState.currentRoi, source: 'single'}] : []);
  if (rois.length === 0 || !imageData) return;
  
  document.getElementById('roi-modal-loading').style.display = 'flex';
  document.getElementById('roi-loading-text').textContent = 'Extracting image...';
  document.getElementById('roi-modal-results').style.display = 'none';
  document.getElementById('roi-cropped-section').style.display = 'none';
  
  try {
    const croppedImages = [];
    for (let i = 0; i < rois.length; i++) {
      const r = rois[i];
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = r.width;
      cropCanvas.height = r.height;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.drawImage(image, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      const croppedDataUrl = cropCanvas.toDataURL('image/png');
      croppedImages.push({ idx: i, dataUrl: croppedDataUrl, roi: r });
    }

    roiModalState.lastCroppedImages = croppedImages.map(c => c.dataUrl);
    roiModalState.lastCroppedImage = roiModalState.lastCroppedImages[0] || null;

    document.getElementById('roi-modal-text').textContent = `(Image only - ${rois.length} region(s))`;
    document.getElementById('roi-modal-results').style.display = 'block';

    const galleryHtml = croppedImages.map((c) => `
      <div class="roi-crop-tile">
        <img src="${c.dataUrl}" alt="Cropped region" />
        <button class="btn-sm" onclick="downloadImageFromSrc('${c.dataUrl}', 'roi_${roiModalState.imageIdx}_${Date.now()}_${c.idx + 1}.png')">
          <i class="fas fa-download"></i> Download
        </button>
      </div>
    `).join('');

    const section = document.getElementById('roi-cropped-section');
    section.style.display = 'block';
    const gallery = document.getElementById('roi-cropped-gallery');
    if (gallery) gallery.innerHTML = `<div class="roi-crops-grid">${galleryHtml}</div>`;

    const resultsDiv = document.getElementById(`roi-results-${roiModalState.imageIdx}`);
    if (resultsDiv) {
      const mainGallery = croppedImages.map((c) => `
        <div class="roi-result-image">
          <img src="${c.dataUrl}" alt="Cropped region" />
          <button class="btn-sm" onclick="downloadImageFromSrc('${c.dataUrl}', 'roi_${roiModalState.imageIdx}_${Date.now()}_${c.idx + 1}.png')">
            <i class="fas fa-download"></i> Download
          </button>
        </div>
      `).join('');
      resultsDiv.innerHTML = `
        <div class="roi-result-item">
          <div class="roi-result-header">
            <strong>Extracted images (Regions: ${rois.length}):</strong>
          </div>
          <div class="roi-result-gallery">${mainGallery}</div>
        </div>
      `;
      resultsDiv.style.display = 'block';
    }

    showToast('Image(s) extracted successfully');
    
  } catch (error) {
    console.error('Error extracting image:', error);
    alert('Failed to extract image: ' + error.message);
  } finally {
    document.getElementById('roi-modal-loading').style.display = 'none';
  }
}

function downloadCroppedImage() {
  const { lastCroppedImage, lastCroppedImages, imageIdx, currentRoi, selectedRois } = roiModalState;
  const images = Array.isArray(lastCroppedImages) && lastCroppedImages.length > 0 ? lastCroppedImages : (lastCroppedImage ? [lastCroppedImage] : []);
  if (images.length === 0) return;

  const rois = selectedRois.length > 0 ? selectedRois : (currentRoi ? [{ ...currentRoi }] : []);
  images.forEach((img, i) => {
    const r = rois[i] || rois[0] || currentRoi || { width: 0, height: 0 };
    const filename = `roi_image${imageIdx + 1}_${r.width}x${r.height}_${Date.now()}_${i + 1}.png`;
    downloadImageFromSrc(img, filename);
  });
}

function downloadImageFromSrc(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('Image downloaded: ' + filename);
}

function attachCroppedImage() {
  const { lastCroppedImage, lastCroppedImages, imageIdx, currentRoi, selectedRois, lastExtractedPerZone } = roiModalState;
  const images = Array.isArray(lastCroppedImages) && lastCroppedImages.length > 0 ? lastCroppedImages : (lastCroppedImage ? [lastCroppedImage] : []);
  if (images.length === 0 || !state.currentResults) return;

  if (!Array.isArray(state.currentResults._extracted_images)) {
    state.currentResults._extracted_images = [];
  }
  const extracted = state.currentResults._extracted_images;
  const src = (typeof imageIdx === 'number') ? extracted[imageIdx] : null;
  const page = getExtractedImagePage(src) ?? 1;

  const pushAll = () => {
    syncResultsToEditor();
    const renderRoot = document.getElementById('template-render-root');
    if (renderRoot) {
      renderRoot.innerHTML = renderTemplateView('DOCUMENT', state.currentResults);
      setTimeout(() => {
        attachEditableListeners();
        attachExtractedImageEditorHandlers();
      }, 0);
    }
  };

  let remaining = images.length;
  images.forEach((dataUrl) => {
    const temp = new Image();
    temp.onload = () => {
      extracted.push({
        data_url: dataUrl,
        page,
        page_number: page,
        width: temp.width,
        height: temp.height,
        source: 'roi',
        derived_from_idx: (typeof imageIdx === 'number') ? imageIdx : null,
        created_at: new Date().toISOString(),
      });
      remaining -= 1;
      if (remaining === 0) pushAll();
    };
    temp.onerror = () => {
      extracted.push({
        data_url: dataUrl,
        page,
        page_number: page,
        width: null,
        height: null,
        source: 'roi',
        derived_from_idx: (typeof imageIdx === 'number') ? imageIdx : null,
        created_at: new Date().toISOString(),
      });
      remaining -= 1;
      if (remaining === 0) pushAll();
    };
    temp.src = dataUrl;
  });
  
  // Add cropped image to results
  if (!state.currentResults._roi_extractions) {
    state.currentResults._roi_extractions = [];
  }

  const now = new Date().toISOString();
  const rois = selectedRois.length > 0 ? selectedRois : (currentRoi ? [{ ...currentRoi }] : []);
  const modalText = document.getElementById('roi-modal-text').textContent;

  images.forEach((img, i) => {
    const r = rois[i] || rois[0] || currentRoi;
    const per = Array.isArray(lastExtractedPerZone) ? lastExtractedPerZone[i] : null;
    state.currentResults._roi_extractions.push({
      source_image_idx: imageIdx,
      roi: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : { ...currentRoi },
      text: per && typeof per.text === 'string' ? per.text : modalText,
      cropped_image: img,
      timestamp: now
    });
  });
  
  // Update the results in storage
  if (state.selectedJobId) {
    fetch(`${API_BASE}/jobs/${state.selectedJobId}/results`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: state.currentResults })
    }).then(() => {
      showToast(`Image(s) attached to results (${images.length})`);
    }).catch(err => {
      console.error('Error saving:', err);
      showToast('Save failed');
    });
  } else {
    showToast(`Image(s) attached (local only) (${images.length})`);
  }
}

// ===== EXPORT FUNCTIONS =====
async function exportToPDF() {
  if (!state.currentResults) {
    showToast('No results to export');
    return;
  }
  
  showToast('Generating PDF...');
  
  try {
    // Use browser print functionality with custom styling
    const previewContent = qs('preview').innerHTML;
    const printWindow = window.open('', '_blank');
    
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Export document</title>
        <link rel="stylesheet" href="styles.css">
        <style>
          body { padding: 20px; background: white; }
          .export-buttons { display: none !important; }
          .btn-action, .btn-delete-row, .btn-delete-col, .table-actions { display: none !important; }
          .editable-cell, .editable-field { border: none !important; background: transparent !important; }
          @media print {
            body { padding: 0; }
            .page-card { page-break-after: always; }
            .extracted-images-section { page-break-before: always; }
          }
        </style>
      </head>
      <body>
        ${previewContent}
        <script>
          setTimeout(() => {
            window.print();
            window.close();
          }, 500);
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  } catch (err) {
    console.error('Error exporting to PDF:', err);
    showToast('Failed to export PDF');
  }
}

async function exportToExcel() {
  if (!state.currentResults) {
    showToast('No results to export');
    return;
  }

  if (!window.ExcelJS) {
    showToast('Excel export library not loaded');
    return;
  }

  showToast('Generating Excel...');

  try {
    const results = state.currentResults;
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'FilesToData';
    workbook.created = new Date();

    const CELESTE = 'FFDEEAF6';
    const BORDER_STYLE = { style: 'thin', color: { argb: 'FF000000' } };
    const BORDER_ALL = { top: BORDER_STYLE, bottom: BORDER_STYLE, left: BORDER_STYLE, right: BORDER_STYLE };

    const safeSheetName = (name) => {
      const cleaned = String(name || 'Sheet').replace(/[\\/?*:[\]]/g, ' ').trim();
      return cleaned.slice(0, 31) || 'Sheet';
    };

    // ALWAYS use single-sheet J.Crew Sewing Worksheet format
    // This is the required format for all exports from this application
    let fileName = 'document';
    
    // Debug: log the full results structure
    console.log('Full results for export:', JSON.stringify(results, null, 2).substring(0, 5000));

    if (window.exportToExcelSewingWorksheet) {
      // Use the single-sheet J.Crew template export (ONE SHEET ONLY - no additional sheets)
      fileName = await window.exportToExcelSewingWorksheet(results, workbook);
      // DO NOT add any more sheets - it must be ONE SHEET ONLY
    } else {
      // Fallback to generic export (multiple sheets)
      const flattenObject = (obj, prefix = '') => {
        let out = {};
        if (!obj || typeof obj !== 'object') return out;
        for (const key of Object.keys(obj)) {
          if (key.startsWith('_')) continue;
          const val = obj[key];
          const newKey = prefix ? `${prefix}.${key}` : key;
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            Object.assign(out, flattenObject(val, newKey));
          } else if (!Array.isArray(val)) {
            out[newKey] = val;
          }
        }
        return out;
      };

      const addKeyValueSheet = (sheetName, obj) => {
        const ws = workbook.addWorksheet(safeSheetName(sheetName));
        ws.columns = [{ width: 50 }, { width: 80 }];
        ws.addRow(['Field', 'Value']);
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
          cell.border = BORDER_ALL;
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        const flat = flattenObject(obj);
        for (const [k, v] of Object.entries(flat)) {
          const valueStr = v === null || v === undefined ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
          const row = ws.addRow([k, valueStr]);
          row.eachCell(cell => { cell.border = BORDER_ALL; });
        }
        return ws;
      };

      const addTableSheet = (sheetName, arr) => {
        const rows = Array.isArray(arr) ? arr : [];
        const ws = workbook.addWorksheet(safeSheetName(sheetName));
        if (rows.length === 0) {
          ws.addRow(['No data']);
          return ws;
        }

        const headersSet = new Set();
        for (const r of rows) {
          if (r && typeof r === 'object') {
            Object.keys(r).filter(k => !k.startsWith('_')).forEach(k => headersSet.add(k));
          }
        }
        const headers = Array.from(headersSet);
        const headerRow = ws.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
          cell.border = BORDER_ALL;
        });
        ws.views = [{ state: 'frozen', ySplit: 1 }];

        for (const r of rows) {
          const rowValues = headers.map(h => {
            const v = r ? r[h] : '';
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') return JSON.stringify(v);
            return v;
          });
          const dataRow = ws.addRow(rowValues);
          dataRow.eachCell(cell => { cell.border = BORDER_ALL; });
        }

        ws.columns = headers.map(h => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
        return ws;
      };

      addKeyValueSheet('Summary', results);

      if (Array.isArray(results.pages)) {
        results.pages.forEach((page, idx) => {
          addKeyValueSheet(`Page ${idx + 1}`, page?.data || {});
          const sw = page?.data?.sewing_worksheet || {};
          if (Array.isArray(sw.quantity_lines)) addTableSheet(`P${idx + 1} Quantity`, sw.quantity_lines);
          if (Array.isArray(sw.measurement_rows)) addTableSheet(`P${idx + 1} Measurements`, sw.measurement_rows);
        });
      } else {
        if (Array.isArray(results.table_of_contents)) addTableSheet('Table of contents', results.table_of_contents);
        if (Array.isArray(results.bom_product_materials)) addTableSheet('BOM materials', results.bom_product_materials);
        if (Array.isArray(results.bom_product_impressions_wide)) addTableSheet('BOM impressions', results.bom_product_impressions_wide);
        if (Array.isArray(results.measurements_plus_wide)) addTableSheet('Measurements (plus)', results.measurements_plus_wide);
        if (Array.isArray(results.measurements_regular_wide)) addTableSheet('Measurements (regular)', results.measurements_regular_wide);
        if (Array.isArray(results.product_details_construction)) addTableSheet('Construction details', results.product_details_construction);
        if (Array.isArray(results.items)) addTableSheet('Items', results.items);
      }

      // Images sheet - ONLY for non-sewing worksheet exports
      const images = Array.isArray(results._extracted_images) ? results._extracted_images : [];
      if (images.length) {
        const wsImg = workbook.addWorksheet('Images');
        wsImg.columns = [
          { width: 8 }, { width: 8 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 60 }, { width: 45 },
        ];
        const imgHeaderRow = wsImg.addRow(['Page', 'Index', 'Width', 'Height', 'Format', 'OCR text', 'Image']);
        imgHeaderRow.font = { bold: true };
        imgHeaderRow.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CELESTE } };
          cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
        });
        wsImg.views = [{ state: 'frozen', ySplit: 1 }];

        let rowCursor = 2;
        for (const img of images) {
          const dataUrl = img?.data_url || '';
          const match = /^data:image\/(png|jpe?g|webp|bmp|gif);base64,(.+)$/i.exec(dataUrl);
          const ext = match ? match[1].toLowerCase().replace('jpg', 'jpeg') : 'png';
          const base64 = match ? match[2] : null;

          wsImg.addRow([img?.page ?? '', img?.index ?? '', img?.width ?? '', img?.height ?? '', img?.format ?? ext, img?.ocr_text ?? '', '']);
          wsImg.getRow(rowCursor).height = 160;

          if (base64) {
            const imageId = workbook.addImage({ base64, extension: ext });
            wsImg.addImage(imageId, { tl: { col: 6, row: rowCursor - 1 }, ext: { width: 300, height: 200 } });
          }
          rowCursor += 1;
        }
        wsImg.getColumn(6).alignment = { vertical: 'top', wrapText: true };
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast('Excel exported');
  } catch (err) {
    console.error('Error exporting to Excel:', err);
    showToast('Failed to export Excel');
  }
}

window.exportToPDF = exportToPDF;
window.exportToExcel = exportToExcel;

async function parseJsonOrThrow(res, method, path) {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
  }

  if (!contentType.includes('application/json')) {
    throw new Error(
      `${method} ${path} -> Expected JSON but got '${contentType || 'unknown'}'. ` +
      `This usually means apiBase is wrong (pointing to the frontend) or missing '/api'.\n` +
      `${text.slice(0, 500)}`
    );
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${method} ${path} -> Invalid JSON\n${text.slice(0, 500)}`);
  }
}

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'ngrok-skip-browser-warning': 'true' },
  });
  return parseJsonOrThrow(res, 'GET', path);
}

async function apiPostForm(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'ngrok-skip-browser-warning': 'true' },
    body: formData,
  });
  return parseJsonOrThrow(res, 'POST', path);
}

async function apiPutJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(res, 'PUT', path);
}

function showToast(message) {
  const toast = qs('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

async function checkHealth() {
  const el = qs('status-indicator');
  try {
    const data = await apiGet('/health');
    el.classList.remove('status-unknown', 'status-error');
    el.classList.add('status-ok');
    const textEl = el.querySelector('.status-text');
    if (textEl) textEl.textContent = `Connected`;
  } catch {
    el.classList.remove('status-unknown', 'status-ok');
    el.classList.add('status-error');
    const textEl = el.querySelector('.status-text');
    if (textEl) textEl.textContent = 'Connection error';
  }
}

async function loadJobs() {
  try {
    const data = await apiGet('/jobs');
    state.jobs = data.jobs || [];
    renderJobs();
  } catch (err) {
    console.error('Error loading jobs', err);
  }
}

function renderJobs() {
  const container = qs('jobs-list');
  container.innerHTML = '';

  if (!state.jobs.length) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-inbox"></i>
        <p>No jobs yet</p>
      </div>
    `;
    return;
  }

  for (const job of state.jobs) {
    const div = document.createElement('div');
    div.className = 'job-item' + (job.id === state.selectedJobId ? ' active' : '');
    div.addEventListener('click', () => selectJob(job.id));

    const dot = document.createElement('span');
    dot.className = 'status-dot status-' + (job.status || 'PENDING').toLowerCase();

    const infoDiv = document.createElement('div');
    infoDiv.className = 'job-info';
    
    const title = document.createElement('div');
    title.className = 'job-title';
    title.textContent = job.file_name || 'Untitled';

    const meta = document.createElement('div');
    meta.className = 'job-meta';
    meta.textContent = `${job.mode} · ${job.status}`;

    infoDiv.append(title, meta);
    div.append(dot, infoDiv);
    container.appendChild(div);
  }
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  renderJobs();
  try {
    const job = await apiGet(`/jobs/${jobId}`);
    renderJobDetail(job);
  } catch (err) {
    console.error('Error getting job', err);
    showToast('Failed to load job');
  }
}

function scheduleSelectedJobRefresh(jobId, delayMs = 2000) {
  if (!jobId) return;
  if (state.jobPollTimer) {
    clearTimeout(state.jobPollTimer);
    state.jobPollTimer = null;
  }
  state.jobPollTimer = setTimeout(async () => {
    if (state.selectedJobId !== jobId) return;
    try {
      const job = await apiGet(`/jobs/${jobId}`);
      renderJobDetail(job);
    } catch (e) {
      console.error('Auto-refresh failed', e);
    }
  }, delayMs);
}

function renderJobDetail(job) {
  const section = qs('detail-section');
  const uploadSection = qs('upload-section');
  const tabs = document.getElementById('detail-tabs');
  const processingPanel = document.getElementById('detail-processing');
  
  // Hide upload, show detail
  if (uploadSection) uploadSection.classList.add('hidden');
  section.classList.remove('hidden');

  qs('detail-file-name').textContent = job.file_name || 'Untitled';
  qs('detail-meta').textContent = `${job.mode} · ${job.status}`;

  const editor = qs('results-editor');
  const previewEl = qs('preview');
  
  // Store results for editing
  const normalizedResults = ensureResultsObject(job.results);
  state.currentResults = normalizedResults ? JSON.parse(JSON.stringify(normalizedResults)) : null;
  if (state.currentResults) {
    hydrateTargetBrandsIncDefaults(state.currentResults);
  }
  state.currentJob = job;
  
  // Reset table counter for fresh IDs
  tableIdCounter = 0;
  window.editableTables = {};

  const isProcessing = job.status === 'PROCESSING' && !job.results;
  if (processingPanel) processingPanel.classList.toggle('hidden', !isProcessing);
  if (tabs) tabs.classList.toggle('hidden', isProcessing);

  // Hide all tab panels while processing to avoid confusion
  document.querySelectorAll('.tab-content').forEach((el) => {
    el.classList.toggle('hidden', isProcessing);
  });
  // Keep editor tab visible
  const editorTab = document.getElementById('tab-editor');
  if (editorTab) editorTab.classList.toggle('hidden', false);
  
  // Only set editor value if it exists (JSON tab was removed)
  if (editor) {
    if (job.results) {
      editor.value = JSON.stringify(job.results, null, 2);
    } else if (job.status === 'PROCESSING') {
      editor.value = 'Processing...';
    } else if (job.status === 'FAILED') {
      editor.value = `Error: ${job.error_message || 'Unknown error'}`;
    } else {
      editor.value = 'Waiting for results...';
    }
  }

  const templateMode = job.mode === 'DOCUMENT' || shouldUseTemplateView(job.mode, state.currentResults);
  const templateView = ensureTemplateViewEl();
  const editorContainer = document.querySelector('#tab-editor .editor-container');

  if (templateView && editorContainer) {
    templateView.classList.toggle('hidden', !templateMode);
    editorContainer.classList.toggle('hidden', templateMode);
    templateView.style.display = templateMode ? 'block' : 'none';
    editorContainer.style.display = templateMode ? 'none' : '';
    if (templateMode) {
      if (job.results) {
        templateView.innerHTML = renderTemplateSplitView(job.mode, state.currentResults, job);
        setTimeout(() => {
          attachEditableListeners();
          attachExtractedImageEditorHandlers();
        }, 0);
      } else {
        templateView.innerHTML = renderTemplateSplitView(job.mode, null, job);
      }
    } else {
      templateView.innerHTML = '';
    }
  }

  // Only render preview if element exists (Final Preview tab was removed)
  if (previewEl && !templateMode) {
    if (job.results) {
      previewEl.innerHTML = renderResultsPreview(job.mode, job.results);
      setTimeout(() => attachEditableListeners(), 0);
    } else {
      previewEl.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-hourglass-half"></i>
          <p>${escapeHtml(job.status === 'PROCESSING' ? 'Processing document...' : 'Waiting for results')}</p>
        </div>
      `;
    }
  }

  if (!templateMode) {
    // Load document for PDF regions tab
    if (typeof loadDocumentForRegions === 'function') {
      loadDocumentForRegions(job);
    }

    // Load document for Document viewer tab
    if (typeof loadDocumentForViewer === 'function') {
      loadDocumentForViewer(job);
    }

    // Load document for Editor tab
    if (typeof loadDocumentForEditor === 'function') {
      loadDocumentForEditor(job);
    }
  }

  if (templateMode && !job.results && (job.status === 'PENDING' || job.status === 'PROCESSING') && state.selectedJobId) {
    scheduleSelectedJobRefresh(state.selectedJobId);
  }

  // Only attach oninput if editor exists (JSON tab was removed)
  if (editor) {
    editor.oninput = () => {
      let parsed;
      try {
        parsed = JSON.parse(editor.value || '{}');
      } catch {
        if (previewEl) previewEl.innerHTML = `<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><p>Invalid JSON</p></div>`;
        return;
      }
      state.currentResults = parsed;
      tableIdCounter = 0;
      window.editableTables = {};
      if (previewEl) previewEl.innerHTML = renderResultsPreview(job.mode, parsed);
      setTimeout(() => attachEditableListeners(), 0);
    };
  }
}

async function handleFileSelected(file) {
  if (!file) return;

  const form = new FormData();
  form.append('file', file, file.name);

  try {
    showToast('Uploading file...');
    const tpl = state.uploadTemplate || 'auto';
    const tplParam = tpl && tpl !== 'auto' ? `&template=${encodeURIComponent(tpl)}` : '';
    const res = await apiPostForm(`/jobs?mode=${state.mode}${tplParam}`, form);
    showToast('Job created');
    await loadJobs();
    if (res.job_id) {
      await selectJob(res.job_id);
    }
  } catch (err) {
    console.error('Error creating job', err);
    showToast('Failed to create job');
  }
}

async function saveResults() {
  if (!state.selectedJobId || state.saving) return;
  let data;

  const editorEl = qs('results-editor');
  if (editorEl && typeof editorEl.value === 'string') {
    try {
      data = JSON.parse(editorEl.value || '{}');
    } catch {
      showToast('Invalid JSON');
      return;
    }
  } else {
    data = state.currentResults;
  }

  if (!data) {
    showToast('Nothing to save');
    return;
  }

  try {
    state.saving = true;
    await apiPutJson(`/jobs/${state.selectedJobId}/results`, { data });
    showToast('Results saved');
    try {
      state.tocEditorCollapsed = true;
      state.tocEditorDocked = false;
      localStorage.setItem('tocEditorCollapsed', '1');
    } catch {}
    try {
      await selectJob(state.selectedJobId);
    } catch {}
  } catch (err) {
    console.error('Error saving results', err);
    showToast('Failed to save results');
  } finally {
    state.saving = false;
  }
}

window.saveResults = saveResults;

function initUI() {
  const uploadBox = qs('upload-box');
  const fileInput = qs('file-input');
  const templateSelect = qs('template-select');

  if (uploadBox) {
    uploadBox.addEventListener('click', (e) => {
      // Don't trigger file input if clicking on mode buttons
      if (e.target.closest('.mode-btn')) return;
      fileInput.click();
    });
    uploadBox.addEventListener('dragover', e => {
      e.preventDefault();
      uploadBox.style.borderColor = 'var(--primary)';
    });
    uploadBox.addEventListener('dragleave', e => {
      e.preventDefault();
      uploadBox.style.borderColor = '';
    });
    uploadBox.addEventListener('drop', e => {
      e.preventDefault();
      uploadBox.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      handleFileSelected(file);
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', e => {
      const file = e.target.files[0];
      handleFileSelected(file);
    });
  }

  // Mode selector buttons
  const btnModeDocument = qs('btn-mode-document');
  const btnModeDesign = qs('btn-mode-design');
  
  if (btnModeDocument) {
    btnModeDocument.addEventListener('click', (e) => {
      e.stopPropagation();
      state.mode = 'DOCUMENT';
      btnModeDocument.classList.add('active');
      if (btnModeDesign) btnModeDesign.classList.remove('active');
    });
  }

  if (btnModeDesign) {
    btnModeDesign.addEventListener('click', (e) => {
      e.stopPropagation();
      state.mode = 'DESIGN';
      btnModeDesign.classList.add('active');
      if (btnModeDocument) btnModeDocument.classList.remove('active');
    });
  }

  // Refresh button
  const btnRefresh = qs('btn-refresh-job');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      if (state.selectedJobId) {
        await selectJob(state.selectedJobId);
        showToast('Job refreshed');
      }
    });
  }

  // Save button removed

  // New job button
  const btnNewJob = qs('btn-new-job');
  if (btnNewJob) {
    btnNewJob.addEventListener('click', () => {
      // Show upload section, hide detail
      const uploadSection = qs('upload-section');
      const detailSection = qs('detail-section');
      if (uploadSection) uploadSection.classList.remove('hidden');
      if (detailSection) detailSection.classList.add('hidden');
      state.selectedJobId = null;
      renderJobs();
    });
  }

  // Tab navigation
  initTabs();
  
  // JSON toolbar buttons
  const btnFormatJson = qs('btn-format-json');
  if (btnFormatJson) {
    btnFormatJson.addEventListener('click', () => {
      const editor = qs('results-editor');
      try {
        const parsed = JSON.parse(editor.value);
        editor.value = JSON.stringify(parsed, null, 2);
        showToast('JSON formatted');
      } catch {
        showToast('Invalid JSON');
      }
    });
  }

  const btnCopyJson = qs('btn-copy-json');
  if (btnCopyJson) {
    btnCopyJson.addEventListener('click', () => {
      const editor = qs('results-editor');
      navigator.clipboard.writeText(editor.value).then(() => {
        showToast('JSON copied to clipboard');
      });
    });
  }

  if (templateSelect) {
    templateSelect.value = state.uploadTemplate || 'auto';
    templateSelect.addEventListener('change', () => {
      state.uploadTemplate = templateSelect.value || 'auto';
      try {
        localStorage.setItem('uploadTemplate', state.uploadTemplate);
      } catch {}
    });
  }
}

// Tab navigation functionality
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // Update button states
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update tab content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      
      const targetTab = document.getElementById(`tab-${tabId}`);
      if (targetTab) {
        targetTab.classList.add('active');
      }
      
      // Initialize PDF regions if switching to that tab
      if (tabId === 'pdf-regions' && typeof initPdfRegions === 'function') {
        initPdfRegions();
        if (state.currentJob && typeof loadDocumentForRegions === 'function') {
          loadDocumentForRegions(state.currentJob);
        }
      }
      
      // Initialize Document viewer if switching to that tab
      if (tabId === 'document' && typeof loadDocumentForViewer === 'function') {
        if (state.currentJob) {
          loadDocumentForViewer(state.currentJob);
        }
      }
      
      // Initialize Editor if switching to that tab
      if (tabId === 'editor' && typeof loadDocumentForEditor === 'function') {
        if (state.currentJob) {
          loadDocumentForEditor(state.currentJob);
        }
      }
    });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  try {
    state.imageEditorCollapsed = localStorage.getItem('imageEditorCollapsed') === '1';
  } catch {}
  try {
    state.tocEditorCollapsed = localStorage.getItem('tocEditorCollapsed') !== '0';
  } catch {}
  try {
    const savedTpl = localStorage.getItem('uploadTemplate');
    if (savedTpl) state.uploadTemplate = savedTpl;
  } catch {}
  initUI();
  await checkHealth();
  await loadJobs();
});

