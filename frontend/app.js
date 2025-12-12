const API_BASE = 'http://localhost:7071/api';

const state = {
  mode: 'DOCUMENT',
  jobs: [],
  selectedJobId: null,
  saving: false,
};

function qs(id) {
  return document.getElementById(id);
}

function renderMatrixTable(matrix) {
  if (!matrix) return `<div class="empty">Sin tabla</div>`;
  const headers = Array.isArray(matrix.headers) ? matrix.headers : [];
  const rows = Array.isArray(matrix.rows) ? matrix.rows : [];

  if (!headers.length || !rows.length) {
    return `<div class="empty">No se pudo extraer la tabla</div>`;
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

function sheetField(label, value) {
  return `
    <div class="sheet-field">
      <div class="sheet-label">${escapeHtml(label)}</div>
      <div class="sheet-value">${escapeHtml(fmt(value) || '')}</div>
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
  if (!Array.isArray(lines) || lines.length === 0) return `<div class="empty">Sin tabla</div>`;

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
  if (!Array.isArray(rows) || rows.length === 0) return `<div class="empty">Sin tabla</div>`;

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
      <th>PUNTOS DE MEDIDA</th>
      <th class="num">TOL (-/+)</th>
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
  if (labelsInfo?.folding_size) lines.push(`TAMANO DE FOLDING - ${labelsInfo.folding_size}`);
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

  const title = 'ORDEN DE TRABAJO DE COSTURA / SEWING WORKSHEET / 봉제 작업지시서';

  const processText = sw.order_procedure;
  const cutNotes = sw.order_procedure_notes || sw.cutting_detail_notes;
  const sewNotes = sw.sewing_detail_notes;
  const qtyLines = sw.quantity_lines;
  const measRows = sw.measurement_rows;

  return `
    <div class="page-card">
      <div class="page-title">Hoja ${escapeHtml(page.page_number)}</div>
      <div class="sheet">
        <div class="sheet-title">${escapeHtml(title)}</div>

        <div class="sheet-grid">
          ${sheetField('CONTACTO / CONTACT', header.contact)}
          ${sheetField('SOLICITADO POR', header.requested_by)}
          ${sheetField('PLANTA DE TRABAJO', header.work_plant)}
          ${sheetField('DIRECCIÓN PLANTA', header.work_plant_address)}
          ${sheetField('FECHA DOCUMENTO', header.document_date)}
          ${sheetField('REVISED', header.revised_date)}
        </div>

        <div class="sheet-section">1. INFO. DEL ORDEN</div>
        <div class="sheet-grid">
          ${sheetField('#FILE', orderInfo.file)}
          ${sheetField('CLIENTE / BUYER', orderInfo.buyer)}
          ${sheetField('STYLE', orderInfo.style)}
          ${sheetField('PRODUCTO', orderInfo.product)}
          ${sheetField('TEMPORADA', orderInfo.season)}
          ${sheetField('CANTIDAD', orderInfo.qty)}
          ${sheetField('ENTREGA / SHIPDATE', orderInfo.ship_date)}
          ${sheetField('COSTO / CM', orderInfo.cm_cost)}
          ${sheetField('TOTAL USD', orderInfo.total_usd)}
        </div>

        <div class="sheet-section">2. INFO. DE TELA</div>
        <div class="sheet-grid">
          ${sheetField('HILAZA / YARN', fabricInfo.yarn)}
          ${sheetField('TELA 1 / FABRIC', fabricInfo.fabric)}
          ${sheetField('ANCHO / WIDTH', fabricInfo.width)}
          ${sheetField('PESO / WEIGHT', fabricInfo.weight)}
          ${sheetField('TELA 2 / FABRIC2', fabricInfo.fabric2)}
          ${sheetField('ANCHO 2 / WIDTH2', fabricInfo.width2)}
          ${sheetField('CONSUMO / YIELD', fabricInfo.yield_total)}
          ${sheetField('LOSS', fabricInfo.loss_comment)}
        </div>

        <div class="sheet-section">3. PROCESO DEL ORDEN</div>
        ${processText ? `<div class="sheet-field" style="grid-template-columns: 1fr;"><div class="sheet-value">${escapeHtml(processText)}</div></div>` : `<div class="empty">—</div>`}

        <div class="sheet-section">4. CANTIDAD POR ESTILO, COLOR & PO</div>
        ${renderQuantityLinesTable(qtyLines)}

        <div class="sheet-section">5. DETALLES DE CORTE</div>
        ${renderLines(cutNotes)}

        <div class="sheet-section">6. COSTURA / SEWING</div>
        ${renderLines(sewNotes)}

        <div class="sheet-section">7. ESPECIFICACION DE MEDIDAS</div>
        ${renderMeasurementRowsTable(measRows)}

        <div class="sheet-section">8. ETIQUETAS / PACKING</div>
        ${renderLabelsInfo(labelsInfo, sw.trim_packing_notes)}
      </div>

      ${rawText ? `<details class="raw"><summary>Texto extraído (hoja ${escapeHtml(page.page_number)})</summary><pre>${escapeHtml(rawText)}</pre></details>` : ''}
    </div>
  `;
}

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

function kvRow(label, value) {
  const v = fmt(value);
  return `<div class="kv-row"><div class="kv-label">${escapeHtml(label)}</div><div class="kv-value">${escapeHtml(v || '—')}</div></div>`;
}

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
    return `<div class="empty">Sin items</div>`;
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
            <th>Descripción</th>
            <th class="num">Cant.</th>
            <th>Unidad</th>
            <th class="num">Precio unit.</th>
            <th class="num">Importe</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
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

  const em = d.emisor || {};
  const re = d.receptor || {};
  const items = d.items || [];
  const rawText = page.raw_text || d.raw_text || '';

  const general = `
    <div class="kv">
      <div class="kv-title">Datos generales</div>
      ${kvRow('Tipo', d.tipo_documento)}
      ${kvRow('Número', d.numero_documento)}
      ${kvRow('Fecha emisión', d.fecha_emision)}
      ${kvRow('Fecha vencimiento', d.fecha_vencimiento)}
      ${kvRow('Moneda', d.moneda)}
      ${kvRow('Método pago', d.metodo_pago)}
      ${kvRow('Condiciones pago', d.condiciones_pago)}
      ${kvRow('Notas', d.notas)}
    </div>
  `;

  const totals = `
    <div class="kv">
      <div class="kv-title">Totales</div>
      ${kvRow('Subtotal', d.subtotal)}
      ${kvRow('Impuestos', d.impuestos)}
      ${kvRow('Total', d.total)}
    </div>
  `;

  const parties = `
    <div class="grid-2">
      <div class="kv">
        <div class="kv-title">Emisor</div>
        ${kvRow('Nombre', em.nombre)}
        ${kvRow('RFC', em.rfc)}
        ${kvRow('Dirección', em.direccion)}
        ${kvRow('Teléfono', em.telefono)}
        ${kvRow('Email', em.email)}
      </div>
      <div class="kv">
        <div class="kv-title">Receptor</div>
        ${kvRow('Nombre', re.nombre)}
        ${kvRow('RFC', re.rfc)}
        ${kvRow('Dirección', re.direccion)}
        ${kvRow('Teléfono', re.telefono)}
        ${kvRow('Email', re.email)}
      </div>
    </div>
  `;

  const textBlock = rawText
    ? `<details class="raw"><summary>Texto extraído (hoja ${escapeHtml(page.page_number)})</summary><pre>${escapeHtml(rawText)}</pre></details>`
    : '';

  return `
    <div class="page-card">
      <div class="page-title">Hoja ${escapeHtml(page.page_number)}</div>
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
  const cambios = Array.isArray(results?.cambios_sugeridos) ? results.cambios_sugeridos : [];
  const textos = Array.isArray(results?.textos_detectados) ? results.textos_detectados : [];

  const cambiosRows = cambios
    .map(c => `
      <tr>
        <td>${escapeHtml(fmt(c.descripcion) || '—')}</td>
        <td>${escapeHtml(fmt(c.impacto) || '—')}</td>
        <td>${escapeHtml(fmt(c.prioridad) || '—')}</td>
      </tr>
    `)
    .join('');

  const textosRows = textos
    .map(t => `
      <tr>
        <td>${escapeHtml(fmt(t.texto) || '—')}</td>
        <td>${escapeHtml(fmt(t.ubicacion) || '—')}</td>
      </tr>
    `)
    .join('');

  const cambiosTable = cambios.length
    ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Cambio</th>
              <th>Impacto</th>
              <th>Prioridad</th>
            </tr>
          </thead>
          <tbody>${cambiosRows}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">Sin cambios sugeridos</div>`;

  const textosTable = textos.length
    ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Texto</th>
              <th>Ubicación</th>
            </tr>
          </thead>
          <tbody>${textosRows}</tbody>
        </table>
      </div>
    `
    : `<div class="empty">Sin textos detectados</div>`;

  return `
    <div class="preview-root">
      <div class="page-card">
        <div class="page-title">Análisis de diseño</div>
        <div class="grid-2">
          <div class="kv">
            <div class="kv-title">Resumen</div>
            ${kvRow('Tipo prenda', results?.tipo_prenda)}
            ${kvRow('Estilo', results?.estilo)}
            ${kvRow('Color', results?.color_actual)}
            ${kvRow('Material', results?.material_aparente)}
            ${kvRow('Calidad imagen', results?.calidad_imagen)}
            ${kvRow('Confianza', results?.confianza_analisis)}
          </div>
          <div class="kv">
            <div class="kv-title">Descripción</div>
            ${kvRow('General', results?.descripcion_general)}
            ${kvRow('Observaciones', results?.observaciones_adicionales)}
          </div>
        </div>

        <div class="section-title">Cambios sugeridos</div>
        ${cambiosTable}

        <div class="section-title">Textos detectados</div>
        ${textosTable}
      </div>
    </div>
  `;
}

function renderResultsPreview(mode, results) {
  if (!results) {
    return `<p class="empty">Sin resultados</p>`;
  }

  if (mode === 'DESIGN') {
    return renderDesignResults(results);
  }

  const pages = getDocumentPages(results);
  const pagesHtml = pages.map(renderDocumentPage).join('');
  return `<div class="preview-root">${pagesHtml}</div>`;
}

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
    p.textContent = 'No hay trabajos';
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
    title.textContent = job.file_name || 'Sin nombre';

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
    showToast('Error al cargar trabajo');
  }
}

function renderJobDetail(job) {
  const section = qs('detail-section');
  section.classList.remove('hidden');

  qs('detail-file-name').textContent = job.file_name || 'Sin nombre';
  qs('detail-meta').textContent = `${job.mode} · ${job.status}`;

  const editor = qs('results-editor');
  const previewEl = qs('preview');
  if (job.results) {
    editor.value = JSON.stringify(job.results, null, 2);
  } else if (job.status === 'PROCESSING') {
    editor.value = 'Procesando...';
  } else if (job.status === 'FAILED') {
    editor.value = `Error: ${job.error_message || 'Error desconocido'}`;
  } else {
    editor.value = 'Esperando resultados...';
  }

  if (job.results) {
    previewEl.innerHTML = renderResultsPreview(job.mode, job.results);
  } else {
    previewEl.innerHTML = `<p class="empty">${escapeHtml(job.file_name || '')}</p><p class="empty">${escapeHtml(job.mode)} · ${escapeHtml(job.status)}</p>`;
  }

  editor.oninput = () => {
    let parsed;
    try {
      parsed = JSON.parse(editor.value || '{}');
    } catch {
      previewEl.innerHTML = `<p class="empty">JSON inválido</p>`;
      return;
    }
    previewEl.innerHTML = renderResultsPreview(job.mode, parsed);
  };
  qs('btn-save-results').disabled = false;
}

async function handleFileSelected(file) {
  if (!file) return;

  const form = new FormData();
  form.append('file', file, file.name);

  try {
    showToast('Subiendo archivo...');
    const res = await apiPostForm(`/jobs?mode=${state.mode}`, form);
    showToast('Trabajo creado');
    await loadJobs();
    if (res.job_id) {
      await selectJob(res.job_id);
    }
  } catch (err) {
    console.error('Error creating job', err);
    showToast('Error al crear trabajo');
  }
}

async function saveResults() {
  if (!state.selectedJobId || state.saving) return;
  let data;
  try {
    data = JSON.parse(qs('results-editor').value || '{}');
  } catch {
    showToast('JSON inválido');
    return;
  }

  try {
    state.saving = true;
    await apiPutJson(`/jobs/${state.selectedJobId}/results`, { data });
    showToast('Resultados guardados');
  } catch (err) {
    console.error('Error saving results', err);
    showToast('Error al guardar resultados');
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

  qs('btn-save-results').addEventListener('click', saveResults);
}

window.addEventListener('DOMContentLoaded', async () => {
  initUI();
  await checkHealth();
  await loadJobs();
});

