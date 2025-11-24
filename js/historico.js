// js/historico.js (versión mejorada - manejo robusto de field_name y duplicados)
// - Soporta field_name con múltiples nombres separados por ';' en historico.xlsx
// - Normaliza claves al comparar (minúsculas, sin espacios ni signos) para que una misma clave
//   pueda mapearse a varios contenedores aunque haya pequeñas diferencias en el nombre.
// - No borra ni "consume" valores; si la misma fuente está asignada a varios contenedores,
//   aparecerá en todos ellos.

import { kvGet, kvSet } from './storage.js';
import { fetchAndParseExcel } from './excel.js';

const STORAGE_KEY = 'historico_entries';
window.schemaByContainer = { 1: [], 2: [], 3: [], 4: [] }; // exportado a window para debugging
let schemaByContainer = window.schemaByContainer; // alias interno

export async function initHistorico() {
  await loadHistoricoSchema().catch(err => { console.warn('No se cargó historico.xlsx', err); });
  await renderHistory();

  // escuchar búsquedas en histórico
  const search = document.getElementById('searchHistorico');
  if (search) {
    search.addEventListener('input', debounce(() => renderHistory(), 220));
  }

  // escuchar evento de guardado emitido por tipificar.js
  document.addEventListener('history-save', async (ev) => {
    if (!ev || !ev.detail) return;
    try {
      await addHistoryEntry(ev.detail);
      await renderHistory();
    } catch (e) {
      console.error('Error guardando en histórico', e);
    }
  });

  // botones de export y vaciado (si existen en DOM)
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  const exportXlsxBtn = document.getElementById('exportXlsxBtn');
  const clearBtn = document.getElementById('clearHistoricoBtn');

  if (exportTxtBtn) exportTxtBtn.addEventListener('click', async () => {
    try {
      const entries = await readEntries();
      if (!entries || entries.length === 0) {
        const st = document.getElementById('historicoStatus'); if (st) { st.textContent = 'No hay entradas para exportar.'; setTimeout(()=> st.textContent='', 3000); }
        return;
      }
      const txt = buildTxtExport(entries);
      downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `historico_${(new Date()).toISOString().slice(0,19).replace(/[:T]/g,'-')}.txt`);
    } catch (e) {
      console.error('Error exportando .txt', e);
      const st = document.getElementById('historicoStatus'); if (st) { st.textContent = 'Error exportando .txt'; setTimeout(()=> st.textContent='', 3000); }
    }
  });

  if (exportXlsxBtn) exportXlsxBtn.addEventListener('click', async () => {
    try {
      const entries = await readEntries();
      if (!entries || entries.length === 0) {
        const st = document.getElementById('historicoStatus'); if (st) { st.textContent = 'No hay entradas para exportar.'; setTimeout(()=> st.textContent='', 3000); }
        return;
      }
      const wb = buildXlsxWorkbook(entries);
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      downloadBlob(new Blob([wbout], { type: 'application/octet-stream' }), `historico_${(new Date()).toISOString().slice(0,19).replace(/[:T]/g,'-')}.xlsx`);
    } catch (e) {
      console.error('Error exportando .xlsx', e);
      const st = document.getElementById('historicoStatus'); if (st) { st.textContent = 'Error exportando .xlsx'; setTimeout(()=> st.textContent='', 3000); }
    }
  });

  // vaciar histórico (modal)
  const clearModal = document.getElementById('clearHistoricoModal');
  const cancelClear = document.getElementById('cancelClearHistoricoBtn');
  const confirmClear = document.getElementById('confirmClearHistoricoBtn');
  if (clearBtn) clearBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!clearModal) return;
    clearModal.hidden = false;
    clearModal.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => { confirmClear && confirmClear.focus(); }, 60);
  });
  if (cancelClear) cancelClear.addEventListener('click', (ev) => {
    ev.preventDefault();
    if (!clearModal) return;
    clearModal.hidden = true;
    clearModal.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  });
  if (confirmClear) confirmClear.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await saveEntries([]); // vaciamos
      if (clearModal) { clearModal.hidden = true; clearModal.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; }
      await renderHistory();
      const st = document.getElementById('historicoStatus'); if (st) { st.textContent = 'Histórico vaciado.'; setTimeout(()=> st.textContent='', 3000); }
    } catch (e) {
      console.error('Error vaciando histórico', e);
    }
  });

  // cerrar modal detalle
  const closeBtn = document.getElementById('closeHistoryDetailBtn');
  const detailModal = document.getElementById('historyDetailModal');
  if (closeBtn) closeBtn.addEventListener('click', () => { if (detailModal) { detailModal.hidden = true; detailModal.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; } });
  if (detailModal) detailModal.addEventListener('click', (ev) => { if (ev.target === detailModal) { detailModal.hidden = true; detailModal.setAttribute('aria-hidden','true'); document.body.style.overflow = ''; } });
}

/* --------------------------
   UTIL: normalización y búsqueda
   -------------------------- */

// Normaliza claves para comparaciones: minúsculas, elimina espacios y caracteres no alfanuméricos
function normalizeKey(k) {
  if (k === undefined || k === null) return '';
  return String(k).toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}

// Construye un mapa normalizado de entry.data: { normKey -> originalValue }
function buildNormalizedDataMap(dataObj) {
  const map = {};
  if (!dataObj || typeof dataObj !== 'object') return map;
  Object.keys(dataObj).forEach(origKey => {
    const norm = normalizeKey(origKey);
    if (norm) {
      if (!(norm in map)) map[norm] = dataObj[origKey];
    }
  });
  return map;
}

// getFieldValue: busca el valor para un campo dado en entry.data usando normalización.
// Si fieldName puede contener múltiples aliases separados por ';', intenta en orden.
function getFieldValue(entry, fieldName) {
  if (!entry || !entry.data) return '';
  const normMap = buildNormalizedDataMap(entry.data);
  const candidates = String(fieldName || '').split(';').map(s => s.trim()).filter(Boolean);
  for (let cand of candidates) {
    const norm = normalizeKey(cand);
    if (norm && (norm in normMap)) return normMap[norm];
    if (cand in entry.data) return entry.data[cand];
    const lk = cand.toLowerCase();
    if (lk in entry.data) return entry.data[lk];
    const uk = cand.toUpperCase();
    if (uk in entry.data) return entry.data[uk];
  }
  return '';
}

/* --------------------------
   Schema loader
   -------------------------- */

async function loadHistoricoSchema() {
  try {
    const rows = await fetchAndParseExcel('historico.xlsx');
    if (!rows || rows.length < 2) return;
    const headers = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
    const contIdx = headers.indexOf('container') !== -1 ? headers.indexOf('container') : -1;
    const fieldIdx = headers.indexOf('field_name') !== -1 ? headers.indexOf('field_name') : -1;
    const labelIdx = headers.indexOf('label') !== -1 ? headers.indexOf('label') : -1;

    // reset
    window.schemaByContainer = { 1: [], 2: [], 3: [], 4: [] };
    schemaByContainer = window.schemaByContainer;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const containerRaw = contIdx >= 0 ? row[contIdx] : null;
      const fieldRaw = fieldIdx >= 0 ? row[fieldIdx] : null;
      const labelRaw = labelIdx >= 0 ? row[labelIdx] : null;
      if (!fieldRaw) continue;

      // Soportamos múltiples nombres en una celda separados por ';'
      const fieldCell = String(fieldRaw || '');
      const fieldParts = fieldCell.split(';').map(s => s.trim()).filter(Boolean);
      const containerNum = Number(containerRaw) || 1;
      const c = Math.min(Math.max(1, containerNum), 4);

      fieldParts.forEach(fp => {
        schemaByContainer[c].push({
          field_name: fp,
          label: labelRaw ? String(labelRaw).trim() : String(fp).trim()
        });
      });
    }
    // expose for debugging
    window.schemaByContainer = schemaByContainer;
    return schemaByContainer;
  } catch (err) {
    console.warn('loadHistoricoSchema error', err);
    window.schemaByContainer = { 1: [], 2: [], 3: [], 4: [] };
    schemaByContainer = window.schemaByContainer;
    return schemaByContainer;
  }
}

/* --------------------------
   Storage helpers + CRUD
   -------------------------- */

async function readEntries() {
  try {
    const arr = await kvGet(STORAGE_KEY);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e2) {
      console.warn('readEntries error', e);
      return [];
    }
  }
}

async function saveEntries(arr) {
  try {
    await kvSet(STORAGE_KEY, arr);
  } catch (e) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e2) { console.warn('saveEntries fallback error', e2); }
  }
}

async function addHistoryEntry({ dataObj = {}, text = '', datetime = null }) {
  const entries = await readEntries();
  const entry = {
    id: `h_${Date.now()}_${Math.floor(Math.random()*10000)}`,
    datetime: datetime || new Date().toISOString(),
    data: dataObj || {},
    rawText: text || ''
  };
  entries.unshift(entry);
  await saveEntries(entries);
  return entry;
}

async function removeEntryById(id) {
  const entries = await readEntries();
  const filtered = entries.filter(e => e.id !== id);
  await saveEntries(filtered);
  return filtered;
}

/* --------------------------
   Rendering
   -------------------------- */

function formatContainerContent(containerIdx, entry) {
  const schema = schemaByContainer[containerIdx] || [];
  const lines = [];

  if (schema.length === 0) {
    if (containerIdx === 4) {
      Object.keys(entry.data || {}).forEach(k => {
        if (k === 'datetime') return;
        lines.push(`${k}: ${entry.data[k]}`);
      });
    }
    return lines.join('\n');
  }

  schema.forEach(s => {
    const rawValue = getFieldValue(entry, s.field_name);
    if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '') {
      lines.push(`${s.label}: ${rawValue}`);
    } else {
      // mantenemos la etiqueta vacía para preservar formato
      lines.push(`${s.label}: `);
    }
  });

  return lines.join('\n');
}

async function renderHistory() {
  const container = document.getElementById('historicoContainer');
  if (!container) return;
  container.innerHTML = '';
  const entries = await readEntries();
  if (!entries || entries.length === 0) {
    container.innerHTML = '<p class="muted">No hay entradas en el histórico.</p>';
    return;
  }

  const q = (document.getElementById('searchHistorico') && document.getElementById('searchHistorico').value) ? String(document.getElementById('searchHistorico').value).toLowerCase().trim() : '';
  const filtered = q ? entries.filter(en => {
    if ((en.rawText || '').toLowerCase().includes(q)) return true;
    if ((en.datetime || '').toLowerCase().includes(q)) return true;
    for (let i=1;i<=4;i++) {
      const cont = formatContainerContent(i, en) || '';
      if (cont.toLowerCase().includes(q)) return true;
    }
    return false;
  }) : entries;

  if (!filtered || filtered.length === 0) {
    container.innerHTML = '<p class="muted">No hay resultados para esa búsqueda.</p>';
    return;
  }

  filtered.forEach((entry, idx) => {
    const card = document.createElement('div');
    card.className = 'history-card';
    card.dataset.id = entry.id;

    const indexBadge = document.createElement('div');
    indexBadge.className = 'index-badge';
    indexBadge.textContent = String(idx + 1);
    card.appendChild(indexBadge);

    for (let c = 1; c <= 2; c++) {
      const contText = formatContainerContent(c, entry);
      const contWrap = document.createElement('div');
      contWrap.className = 'container';
      if (contText && contText.length > 0) {
        const lines = contText.split('\n').filter(Boolean);
        lines.forEach((ln) => {
          const div = document.createElement('div');
          if (ln.includes(':')) {
            const parts = ln.split(/:\s(.+)/);
            const label = parts[0];
            const value = parts[1] || '';
            const labEl = document.createElement('div'); labEl.className = 'label'; labEl.textContent = label;
            const valEl = document.createElement('div'); valEl.className = 'value'; valEl.textContent = value;
            div.appendChild(labEl); div.appendChild(valEl);
          } else {
            const valEl = document.createElement('div'); valEl.className = 'value'; valEl.textContent = ln;
            div.appendChild(valEl);
          }
          contWrap.appendChild(div);
        });
      } else {
        const empty = document.createElement('div');
        empty.className = 'value muted';
        empty.textContent = '';
        contWrap.appendChild(empty);
      }
      card.appendChild(contWrap);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const delBtn = document.createElement('button');
    delBtn.className = 'btn danger';
    delBtn.textContent = '🗑️';
    delBtn.title = 'Eliminar';
    delBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      try {
        await removeEntryById(entry.id);
        await renderHistory();
      } catch (e) { console.error('Error eliminando entrada histórico', e); }
    });

    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-small btn-eye';
    viewBtn.title = 'Ver detalle';
    viewBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      openDetailModal(entry);
    });

    const copyFourthBtn = document.createElement('button');
    copyFourthBtn.className = 'btn btn-small btn-copy';
    copyFourthBtn.title = 'Copiar contenedor 4';
    copyFourthBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      const textToCopy = formatContainerContent(4, entry);
      try {
        if (textToCopy && textToCopy.trim() !== '') {
          await navigator.clipboard.writeText(textToCopy);
          const status = document.getElementById('historicoStatus');
          if (status) { status.textContent = 'Copiado.'; setTimeout(()=>{ status.textContent = ''; }, 3000); }
        } else {
          const status = document.getElementById('historicoStatus');
          if (status) { status.textContent = 'No hay contenido para copiar.'; setTimeout(()=>{ status.textContent = ''; }, 3000); }
        }
      } catch (e) {
        console.warn('Clipboard write error', e);
        const status = document.getElementById('historicoStatus');
        if (status) { status.textContent = 'Error al copiar.'; setTimeout(()=>{ status.textContent = ''; }, 3000); }
      }
    });

    actions.appendChild(delBtn);
    actions.appendChild(viewBtn);
    actions.appendChild(copyFourthBtn);

    card.appendChild(actions);
    container.appendChild(card);
  });
}

function openDetailModal(entry) {
  const modal = document.getElementById('historyDetailModal');
  const body = document.getElementById('historyDetailBody');
  if (!modal || !body) return;
  body.innerHTML = '';

  const h = document.createElement('div');
  h.style.marginBottom = '8px';
  h.innerHTML = `<strong>Registrado:</strong> ${escapeHtml(entry.datetime || '')}`;
  body.appendChild(h);

  for (let c=1;c<=4;c++) {
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.background = 'var(--card)';
    pre.style.border = '1px dashed var(--input-border)';
    pre.style.padding = '8px';
    pre.style.borderRadius = '6px';
    pre.textContent = formatContainerContent(c, entry) || '';
    body.appendChild(pre);
  }

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function buildTxtExport(entries) {
  const lines = [];
  entries.forEach((en, idx) => {
    lines.push(`=== Entrada ${idx+1} ===`);
    lines.push(`ID: ${en.id}`);
    lines.push(`Registrado: ${en.datetime}`);
    for (let c=1;c<=4;c++) {
      lines.push(`--- Contenedor ${c} ---`);
      const cont = formatContainerContent(c, en) || '';
      lines.push(cont);
    }
    lines.push(`--- RAW TEXT ---`);
    lines.push(en.rawText || '');
    lines.push('\n');
  });
  return lines.join('\n');
}

function buildXlsxWorkbook(entries) {
  const rows = [];
  rows.push(['id','datetime','rawText','container1','container2','container3','container4']);
  entries.forEach(en => {
    const r = [
      en.id || '',
      en.datetime || '',
      en.rawText || '',
      formatContainerContent(1, en) || '',
      formatContainerContent(2, en) || '',
      formatContainerContent(3, en) || '',
      formatContainerContent(4, en) || ''
    ];
    rows.push(r);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'historico');
  return wb;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=> {
    try { a.remove(); } catch (e) {}
    URL.revokeObjectURL(url);
  }, 2000);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function debounce(fn, delay) { let timer = null; return function(...args){ clearTimeout(timer); timer = setTimeout(()=>fn.apply(this,args), delay); }; }