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
  if (job.results) {
    editor.value = JSON.stringify(job.results, null, 2);
  } else if (job.status === 'PROCESSING') {
    editor.value = 'Procesando...';
  } else if (job.status === 'FAILED') {
    editor.value = `Error: ${job.error_message || 'Error desconocido'}`;
  } else {
    editor.value = 'Esperando resultados...';
  }

  qs('preview').innerHTML = `<p>${job.file_name || ''}</p><p>${job.mode} · ${job.status}</p>`;
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

