function getApiBase() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = (params.get('apiBase') || '').trim();
  const fromStorage = (localStorage.getItem('apiBase') || '').trim();
  const base = (fromQuery || fromStorage || 'http://localhost:7071/api').replace(/\/+$/, '');
  if (fromQuery) {
    localStorage.setItem('apiBase', base);
  }
  return base;
}

const API_BASE = getApiBase();

const state = {
  mode: 'DOCUMENT',
  jobs: [],
  selectedJobId: null,
  saving: false,
  currentResults: null, // Store current results for editing
  editMode: true, // Enable edit mode by default
};

function qs(id) {
  return document.getElementById(id);
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
        ${sizeCols.map(s => `<td class="num">${escapeHtml(fmt(r?.[s.key]) || '')}</td>`).join('')}
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

  // Editable quantity lines table
  const qtyColumns = [
    { key: 'style', label: 'S#' },
    { key: 'po', label: 'PO#' },
    { key: 'xfty', label: 'XFTY' },
    { key: 'color_name', label: 'COLOR' },
    { key: 'color_code', label: 'COLOR CODE' },
    { key: 'sizes.xxs_2_3', label: 'XXS (2/3)', numeric: true },
    { key: 'sizes.xs_4_5', label: 'XS (4/5)', numeric: true },
    { key: 'sizes.s_6_7', label: 'S (6/7)', numeric: true },
    { key: 'sizes.m_8_9', label: 'M (8/9)', numeric: true },
    { key: 'sizes.l_10_11', label: 'L (10/11)', numeric: true },
    { key: 'sizes.xl_12_13', label: 'XL (12/13)', numeric: true },
    { key: 'sizes.xxl_14_15', label: 'XXL (14/15)', numeric: true },
    { key: 'sizes.xxxl_16', label: 'XXXL (16)', numeric: true },
    { key: 'total', label: 'TOTAL', numeric: true }
  ];

  // Editable measurement rows table
  const measColumns = [
    { key: 'name', label: 'Measurement points' },
    { key: 'tolerance', label: 'Tolerance (-/+)', numeric: true },
    { key: 'xxs_2_3', label: 'XXS (2/3)', numeric: true },
    { key: 'xs_4_5', label: 'XS (4/5)', numeric: true },
    { key: 's_6_7', label: 'S (6/7)', numeric: true },
    { key: 'm_8_9', label: 'M (8/9)', numeric: true },
    { key: 'l_10_11', label: 'L (10/11)', numeric: true },
    { key: 'xl_12_13', label: 'XL (12/13)', numeric: true },
    { key: 'xxl_14_15', label: 'XXL (14/15)', numeric: true },
    { key: 'xxxl_16', label: 'XXXL (16)', numeric: true }
  ];

  const editBadge = state.editMode ? '<span class="edit-mode-badge"><i class="fas fa-edit"></i> Editable</span>' : '';

  return `
    <div class="page-card">
      <div class="page-title">Page ${escapeHtml(page.page_number)} ${editBadge}</div>
      <div class="sheet">
        <div class="sheet-title">${escapeHtml(title)}</div>

        <div class="sheet-grid">
          ${sheetField('Contact', header.contact, `${basePath}.header.contact`)}
          ${sheetField('Requested by', header.requested_by, `${basePath}.header.requested_by`)}
          ${sheetField('Work plant', header.work_plant, `${basePath}.header.work_plant`)}
          ${sheetField('Plant address', header.work_plant_address, `${basePath}.header.work_plant_address`)}
          ${sheetField('Document date', header.document_date, `${basePath}.header.document_date`)}
          ${sheetField('Revised', header.revised_date, `${basePath}.header.revised_date`)}
        </div>

        <div class="sheet-section">1. ORDER INFO</div>
        <div class="sheet-grid">
          ${sheetField('#FILE', orderInfo.file, `${basePath}.order_info.file`)}
          ${sheetField('Buyer', orderInfo.buyer, `${basePath}.order_info.buyer`)}
          ${sheetField('STYLE', orderInfo.style, `${basePath}.order_info.style`)}
          ${sheetField('Product', orderInfo.product, `${basePath}.order_info.product`)}
          ${sheetField('Season', orderInfo.season, `${basePath}.order_info.season`)}
          ${sheetField('Quantity', orderInfo.qty, `${basePath}.order_info.qty`)}
          ${sheetField('Ship date', orderInfo.ship_date, `${basePath}.order_info.ship_date`)}
          ${sheetField('CM cost', orderInfo.cm_cost, `${basePath}.order_info.cm_cost`)}
          ${sheetField('TOTAL USD', orderInfo.total_usd, `${basePath}.order_info.total_usd`)}
        </div>

        <div class="sheet-section">2. FABRIC INFO</div>
        <div class="sheet-grid">
          ${sheetField('Yarn', fabricInfo.yarn, `${basePath}.fabric_info.yarn`)}
          ${sheetField('Fabric 1', fabricInfo.fabric, `${basePath}.fabric_info.fabric`)}
          ${sheetField('Width', fabricInfo.width, `${basePath}.fabric_info.width`)}
          ${sheetField('Weight', fabricInfo.weight, `${basePath}.fabric_info.weight`)}
          ${sheetField('Fabric 2', fabricInfo.fabric2, `${basePath}.fabric_info.fabric2`)}
          ${sheetField('Width 2', fabricInfo.width2, `${basePath}.fabric_info.width2`)}
          ${sheetField('Yield', fabricInfo.yield_total, `${basePath}.fabric_info.yield_total`)}
          ${sheetField('LOSS', fabricInfo.loss_comment, `${basePath}.fabric_info.loss_comment`)}
        </div>

        <div class="sheet-section">3. ORDER PROCEDURE</div>
        ${processText ? `<div class="sheet-field" style="grid-template-columns: 1fr;"><div class="sheet-value ${state.editMode ? 'editable-field' : ''}" ${state.editMode ? 'contenteditable="true"' : ''} data-path="${basePath}.order_procedure">${escapeHtml(processText)}</div></div>` : `<div class="empty">—</div>`}

        <div class="sheet-section">4. QUANTITY BY STYLE, COLOR & PO</div>
        ${renderEditableTable(qtyLines, qtyColumns, `${basePath}.quantity_lines`)}

        <div class="sheet-section">5. CUTTING DETAILS</div>
        ${renderEditableLines(cutNotes, `${basePath}.cutting_detail_notes`)}

        <div class="sheet-section">6. SEWING</div>
        ${renderEditableLines(sewNotes, `${basePath}.sewing_detail_notes`)}

        <div class="sheet-section">7. MEASUREMENT SPECIFICATIONS</div>
        ${renderEditableTable(measRows, measColumns, `${basePath}.measurement_rows`)}

        <div class="sheet-section">8. LABELS / PACKING</div>
        ${renderLabelsInfo(labelsInfo, sw.trim_packing_notes)}
      </div>

      ${rawText ? `<details class="raw"><summary>Extracted text (page ${escapeHtml(page.page_number)})</summary><pre>${escapeHtml(rawText)}</pre></details>` : ''}
    </div>
  `;
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

function renderEditableTable(data, columns, tablePath, options = {}) {
  const tableId = generateTableId();
  const rows = Array.isArray(data) ? data : [];
  const { showRowNumbers = false, title = '' } = options;

  if (!state.editMode) {
    // Non-editable mode - simple table
    if (rows.length === 0) return `<div class="empty">No data</div>`;
    const thead = columns.map(c => `<th class="${c.numeric ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('');
    const tbody = rows.map((row, i) => {
      const cells = columns.map(c => {
        // Support nested keys like "sizes.xxs_2_3"
        const val = c.key.includes('.') ? getNestedValue(row, c.key) : row[c.key];
        return `<td class="${c.numeric ? 'num' : ''}">${escapeHtml(fmt(val) || '—')}</td>`;
      }).join('');
      return `<tr>${showRowNumbers ? `<td>${i + 1}</td>` : ''}${cells}</tr>`;
    }).join('');
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
      // Support nested keys like "sizes.xxs_2_3"
      const val = c.key.includes('.') ? getNestedValue(row, c.key) : row[c.key];
      return `
        <td class="editable-cell ${c.numeric ? 'num' : ''}" contenteditable="true"
            data-table="${tableId}" data-row="${rowIdx}" data-col="${colIdx}" data-key="${c.key}"
            data-path="${tablePath}[${rowIdx}].${c.key}"
            onblur="updateTableCell('${tableId}', '${tablePath}', ${rowIdx}, '${c.key}', this.textContent)">
          ${escapeHtml(fmt(val ?? ''))}
        </td>
      `;
    }).join('');
    return `
      <tr data-row="${rowIdx}">
        ${showRowNumbers ? `<td>${rowIdx + 1}</td>` : ''}
        ${cells}
        <td class="row-actions">
          <button class="btn-delete-row" onclick="deleteTableRow('${tableId}', '${tablePath}', ${rowIdx})" title="Delete row">
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
    // Support nested keys like "sizes.xxs_2_3"
    if (key.includes('.')) {
      setNestedValueInRow(target[rowIdx], key, value.trim());
    } else {
      target[rowIdx][key] = value.trim();
    }
    syncResultsToEditor();
  }
}

function addTableRow(tableId, tablePath) {
  if (!state.currentResults) return;
  
  const tableInfo = window.editableTables?.[tableId];
  if (!tableInfo) return;
  
  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) target[part] = [];
    target = target[part];
  }
  
  if (Array.isArray(target)) {
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
  
  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  
  if (Array.isArray(target)) {
    target.forEach(row => { row[newKey] = ''; });
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
  
  // Handle paths with array notation
  const pathParts = tablePath.replace(/\[(\d+)\]/g, '.$1').split('.');
  let target = state.currentResults;
  for (const part of pathParts) {
    if (target[part] === undefined) return;
    target = target[part];
  }
  
  if (Array.isArray(target)) {
    target.forEach(row => { delete row[col.key]; });
    syncResultsToEditor();
    refreshPreview();
  }
}

function updateColumnHeader(tableId, colIdx, newLabel) {
  const tableInfo = window.editableTables?.[tableId];
  if (!tableInfo) return;
  if (tableInfo.columns[colIdx]) {
    tableInfo.columns[colIdx].label = newLabel;
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

// Make functions globally available
window.updateTableCell = updateTableCell;
window.addTableRow = addTableRow;
window.deleteTableRow = deleteTableRow;
window.addTableColumn = addTableColumn;
window.deleteTableColumn = deleteTableColumn;
window.updateColumnHeader = updateColumnHeader;

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
    ${renderEditableTable(toc, tocColumns, 'table_of_contents')}
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
    ${renderEditableTable(bomMaterials, bomMatColumns, 'bom_product_materials')}
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
    ${renderEditableTable(bomImpressions, bomImpColumns, 'bom_product_impressions_wide')}
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
    ${renderEditableTable(measPlus, measPlusColumns, 'measurements_plus_wide')}
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
    ${renderEditableTable(measRegular, measRegColumns, 'measurements_regular_wide')}
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
    ${renderEditableTable(construction, constColumns, 'product_details_construction')}
  `;

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
  
  const imagesHtml = images.map((img, idx) => `
    <div class="extracted-image-item">
      <div class="extracted-image-header">
        <span class="image-info">Page ${img.page}, Image #${img.index} (${img.width}x${img.height})</span>
      </div>
      <img src="${img.data_url}" alt="Extracted image ${idx + 1}" class="extracted-image-preview" />
      ${img.ocr_text ? `<div class="extracted-image-ocr"><strong>OCR text:</strong><pre>${escapeHtml(img.ocr_text)}</pre></div>` : ''}
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
  `;
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

    const safeSheetName = (name) => {
      const cleaned = String(name || 'Sheet')
        .replace(/[\\/?*:[\]]/g, ' ')
        .trim();
      return cleaned.slice(0, 31) || 'Sheet';
    };

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
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const flat = flattenObject(obj);
      for (const [k, v] of Object.entries(flat)) {
        const valueStr = v === null || v === undefined ? '' : (typeof v === 'string' ? v : JSON.stringify(v));
        ws.addRow([k, valueStr]);
      }

      ws.getColumn(1).alignment = { vertical: 'top', wrapText: true };
      ws.getColumn(2).alignment = { vertical: 'top', wrapText: true };
      return ws;
    };

    const addTableSheet = (sheetName, arr) => {
      const rows = Array.isArray(arr) ? arr : [];
      const ws = workbook.addWorksheet(safeSheetName(sheetName));
      if (rows.length === 0) {
        ws.addRow(['No data']);
        return ws;
      }

      // Build headers from union of keys
      const headersSet = new Set();
      for (const r of rows) {
        if (r && typeof r === 'object') {
          Object.keys(r).filter(k => !k.startsWith('_')).forEach(k => headersSet.add(k));
        }
      }
      const headers = Array.from(headersSet);
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      for (const r of rows) {
        const rowValues = headers.map(h => {
          const v = r ? r[h] : '';
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') return JSON.stringify(v);
          return v;
        });
        ws.addRow(rowValues);
      }

      ws.columns = headers.map(h => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 2)) }));
      ws.eachRow((row, rowNumber) => {
        row.alignment = { vertical: 'top', wrapText: true };
        if (rowNumber === 1) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      });
      return ws;
    };

    // Summary
    addKeyValueSheet('Summary', results);

    // Document pages (if present)
    if (Array.isArray(results.pages)) {
      results.pages.forEach((page, idx) => {
        addKeyValueSheet(`Page ${idx + 1}`, page?.data || {});

        const sw = page?.data?.sewing_worksheet || {};
        if (Array.isArray(sw.quantity_lines)) addTableSheet(`P${idx + 1} Quantity`, sw.quantity_lines);
        if (Array.isArray(sw.measurement_rows)) addTableSheet(`P${idx + 1} Measurements`, sw.measurement_rows);
      });
    } else {
      // Known tables for product_factura / generic document
      if (Array.isArray(results.table_of_contents)) addTableSheet('Table of contents', results.table_of_contents);
      if (Array.isArray(results.bom_product_materials)) addTableSheet('BOM materials', results.bom_product_materials);
      if (Array.isArray(results.bom_product_impressions_wide)) addTableSheet('BOM impressions', results.bom_product_impressions_wide);
      if (Array.isArray(results.measurements_plus_wide)) addTableSheet('Measurements (plus)', results.measurements_plus_wide);
      if (Array.isArray(results.measurements_regular_wide)) addTableSheet('Measurements (regular)', results.measurements_regular_wide);
      if (Array.isArray(results.product_details_construction)) addTableSheet('Construction details', results.product_details_construction);
      if (Array.isArray(results.items)) addTableSheet('Items', results.items);
    }

    // Images sheet
    const images = Array.isArray(results._extracted_images) ? results._extracted_images : [];
    if (images.length) {
      const wsImg = workbook.addWorksheet('Images');
      wsImg.columns = [
        { width: 8 },  // Page
        { width: 8 },  // Index
        { width: 10 }, // Width
        { width: 10 }, // Height
        { width: 10 }, // Format
        { width: 60 }, // OCR text
        { width: 45 }, // Image
      ];
      wsImg.addRow(['Page', 'Index', 'Width', 'Height', 'Format', 'OCR text', 'Image']);
      wsImg.getRow(1).font = { bold: true };
      wsImg.views = [{ state: 'frozen', ySplit: 1 }];

      let rowCursor = 2;
      for (const img of images) {
        const dataUrl = img?.data_url || '';
        const match = /^data:image\/(png|jpe?g|webp|bmp|gif);base64,(.+)$/i.exec(dataUrl);
        const ext = match ? match[1].toLowerCase().replace('jpg', 'jpeg') : 'png';
        const base64 = match ? match[2] : null;

        wsImg.addRow([
          img?.page ?? '',
          img?.index ?? '',
          img?.width ?? '',
          img?.height ?? '',
          img?.format ?? ext,
          img?.ocr_text ?? '',
          '',
        ]);
        wsImg.getRow(rowCursor).height = 160;

        if (base64) {
          const imageId = workbook.addImage({ base64, extension: ext });
          // Place image in column 7 (Image). ExcelJS uses 0-based col/row.
          wsImg.addImage(imageId, {
            tl: { col: 6, row: rowCursor - 1 },
            ext: { width: 300, height: 200 },
          });
        }

        rowCursor += 1;
      }
      wsImg.getColumn(6).alignment = { vertical: 'top', wrapText: true };
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `document_${new Date().toISOString().slice(0, 10)}.xlsx`;
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

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

async function apiPostForm(path, formData) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}`);
  return res.json();
}

async function apiPutJson(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} -> ${res.status}`);
  return res.json();
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
    el.querySelector('span').textContent = `Backend: ${data.status}`;
  } catch {
    el.classList.remove('status-unknown', 'status-ok');
    el.classList.add('status-error');
    el.querySelector('span').textContent = 'Backend: error';
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
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No jobs yet';
    container.appendChild(p);
    return;
  }

  for (const job of state.jobs) {
    const div = document.createElement('div');
    div.className = 'job-item' + (job.id === state.selectedJobId ? ' active' : '');
    div.addEventListener('click', () => selectJob(job.id));

    const dot = document.createElement('span');
    dot.className = 'status-dot status-' + (job.status || 'PENDING').toLowerCase();

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = job.file_name || 'Untitled';

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${job.mode} · ${job.status}`;

    div.append(dot, title, meta);
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

function renderJobDetail(job) {
  const section = qs('detail-section');
  section.classList.remove('hidden');

  qs('detail-file-name').textContent = job.file_name || 'Untitled';
  qs('detail-meta').textContent = `${job.mode} · ${job.status}`;

  const editor = qs('results-editor');
  const previewEl = qs('preview');
  
  // Store results for editing
  state.currentResults = job.results ? JSON.parse(JSON.stringify(job.results)) : null;
  
  // Reset table counter for fresh IDs
  tableIdCounter = 0;
  window.editableTables = {};
  
  if (job.results) {
    editor.value = JSON.stringify(job.results, null, 2);
  } else if (job.status === 'PROCESSING') {
    editor.value = 'Processing...';
  } else if (job.status === 'FAILED') {
    editor.value = `Error: ${job.error_message || 'Unknown error'}`;
  } else {
    editor.value = 'Waiting for results...';
  }

  if (job.results) {
    previewEl.innerHTML = renderResultsPreview(job.mode, job.results);
    // Attach editable listeners after rendering
    setTimeout(() => attachEditableListeners(), 0);
  } else {
    previewEl.innerHTML = `<p class="empty">${escapeHtml(job.file_name || '')}</p><p class="empty">${escapeHtml(job.mode)} · ${escapeHtml(job.status)}</p>`;
  }

  editor.oninput = () => {
    let parsed;
    try {
      parsed = JSON.parse(editor.value || '{}');
    } catch {
      previewEl.innerHTML = `<p class="empty">Invalid JSON</p>`;
      return;
    }
    state.currentResults = parsed;
    tableIdCounter = 0;
    window.editableTables = {};
    previewEl.innerHTML = renderResultsPreview(job.mode, parsed);
    setTimeout(() => attachEditableListeners(), 0);
  };
}

async function handleFileSelected(file) {
  if (!file) return;

  const form = new FormData();
  form.append('file', file, file.name);

  try {
    showToast('Uploading file...');
    const res = await apiPostForm(`/jobs?mode=${state.mode}`, form);
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
  try {
    data = JSON.parse(qs('results-editor').value || '{}');
  } catch {
    showToast('Invalid JSON');
    return;
  }

  try {
    state.saving = true;
    await apiPutJson(`/jobs/${state.selectedJobId}/results`, { data });
    showToast('Results saved');
  } catch (err) {
    console.error('Error saving results', err);
    showToast('Failed to save results');
  } finally {
    state.saving = false;
  }
}

function initUI() {
  const uploadBox = qs('upload-box');
  const fileInput = qs('file-input');

  uploadBox.addEventListener('click', () => fileInput.click());
  uploadBox.addEventListener('dragover', e => {
    e.preventDefault();
  });
  uploadBox.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    handleFileSelected(file);
  });

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    handleFileSelected(file);
  });

  qs('btn-mode-document').addEventListener('click', () => {
    state.mode = 'DOCUMENT';
    qs('btn-mode-document').classList.add('active');
    qs('btn-mode-design').classList.remove('active');
  });

  qs('btn-mode-design').addEventListener('click', () => {
    state.mode = 'DESIGN';
    qs('btn-mode-design').classList.add('active');
    qs('btn-mode-document').classList.remove('active');
  });

  qs('btn-refresh-job').addEventListener('click', async () => {
    if (state.selectedJobId) {
      await selectJob(state.selectedJobId);
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initUI();
  await checkHealth();
  await loadJobs();
});

