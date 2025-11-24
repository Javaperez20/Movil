// js/excel.js - carga y parseo de distintos excels (data.xlsx, agent.xlsx, options.xlsx, forms_mapping.xlsx, fijos.xlsx)
// usa SheetJS (XLSX) que debe estar cargado en la página

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

export async function fetchAndParseExcel(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const ab = await resp.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const first = wb.SheetNames[0];
  const sheet = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  return rows;
}

// data.xlsx: primera fila = headers
export async function loadDataWorkbook() {
  const rows = await fetchAndParseExcel('data.xlsx');
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const items = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c] || `col${c}`] = row[c] !== undefined ? String(row[c]) : '';
    }
    // normaliza color si existe en header 'color'
    if (obj.color) {
      obj.color = normalizeHex(obj.color) || null;
    } else {
      obj.color = null;
    }
    // if id empty skip
    if (!obj.id || String(obj.id).trim() === '') continue;
    items.push(obj);
  }
  return items;
}

function normalizeHex(input) {
  if (!input) return null;
  const s = String(input).trim();
  const cleaned = s.replace(/\s+/g, '');
  const withHash = cleaned.startsWith('#') ? cleaned : '#' + cleaned;
  if (/^#[0-9A-Fa-f]{6}$/.test(withHash)) return withHash.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(withHash)) {
    const r = withHash[1], g = withHash[2], b = withHash[3];
    return ('#' + r + r + g + g + b + b).toLowerCase();
  }
  return null;
}

// agent.xlsx -> retorna matriz simple de filas; pero exportamos helper findName
export async function loadAgentRows() {
  const rows = await fetchAndParseExcel('agent.xlsx');
  return rows;
}

export async function findAgentNameByCedula(normalizedCedula) {
  try {
    const rows = await loadAgentRows();
    if (!rows || rows.length === 0) return null;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const a = row[0] !== undefined ? String(row[0]) : '';
      const b = row[1] !== undefined ? String(row[1]) : '';
      if (normalizeCedulaForMatch(a) === normalizedCedula) return b;
    }
    return null;
  } catch (err) {
    throw err;
  }
}

function normalizeCedulaForMatch(s) {
  return String(s).replace(/[\s\.\-]/g, '').toLowerCase();
}

// options.xlsx
export async function loadOptionsWorkbook() {
  const resp = await fetch('options.xlsx');
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching options.xlsx`);
  const ab = await resp.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const result = { options: [], fields: [] };

  if (wb.SheetNames.length >= 1) {
    const optSheet = wb.Sheets[wb.SheetNames[0]];
    const optRows = XLSX.utils.sheet_to_json(optSheet, { header: 1 });
    const headers = optRows[0] ? optRows[0].map(normalizeHeader) : [];
    for (let r = 1; r < optRows.length; r++) {
      const row = optRows[r] || [];
      const obj = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c] !== undefined ? String(row[c]) : '';
      if (obj.option_key) result.options.push(obj);
    }
  }

  if (wb.SheetNames.length >= 2) {
    const fSheet = wb.Sheets[wb.SheetNames[1]];
    const fRows = XLSX.utils.sheet_to_json(fSheet, { header: 1 });
    const headers = fRows[0] ? fRows[0].map(normalizeHeader) : [];
    for (let r = 1; r < fRows.length; r++) {
      const row = fRows[r] || [];
      const obj = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c] !== undefined ? String(row[c]) : '';
      if (obj.option_key && obj.field_name) result.fields.push(obj);
    }
  }

  return result;
}

// forms_mapping.xlsx (sin cambios respecto a lo implementado previamente)
export async function loadFormsMapping() {
  const resp = await fetch('forms_mapping.xlsx');
  if (!resp.ok) throw new Error('No se pudo cargar forms_mapping.xlsx');
  const ab = await resp.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const out = { forms: [], mapping: [] };
  if (wb.SheetNames.length >= 1) {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const headers = rows[0] ? rows[0].map(normalizeHeader) : [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const obj = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c] !== undefined ? String(row[c]) : '';
      if (obj.form_key && obj.form_url) out.forms.push(obj);
    }
  }
  if (wb.SheetNames.length >= 2) {
    const sheet = wb.Sheets[wb.SheetNames[1]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    const headers = rows[0] ? rows[0].map(normalizeHeader) : [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const obj = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c] !== undefined ? String(row[c]) : '';
      if (obj.field_name && obj.form_key && obj.form_entry_id) out.mapping.push(obj);
    }
  }
  return out;
}

// NUEVO: fijos.xlsx -> define fields que serán los "fixed fields" (excepto datetime y search)
export async function loadFijosWorkbook() {
  // fijos.xlsx expected: first sheet contains rows with header names such as:
  // field_name, field_label, field_placeholder, field_type, field_choices, field_sources
  const resp = await fetch('fijos.xlsx');
  if (!resp.ok) {
    // return empty array if fijos.xlsx not present
    return [];
  }
  const ab = await resp.arrayBuffer();
  const wb = XLSX.read(ab, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(normalizeHeader);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const obj = {};
    for (let c = 0; c < headers.length; c++) {
      const k = headers[c] || `col${c}`;
      obj[k] = row[c] !== undefined ? String(row[c]) : '';
    }
    // require field_name
    if (!obj.field_name || String(obj.field_name).trim() === '') continue;
    out.push(obj);
  }
  return out;
}