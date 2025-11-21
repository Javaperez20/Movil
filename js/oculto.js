// js/oculto.js
//
// Módulo para manejar "oculto.xlsx" — permite enviar datos "en segundo plano"
// (sin mostrar ventana) mediante envío a iframe oculto si se configura silent:true.
//
// Uso:
// import { initOculto } from './oculto.js';
// initOculto(copyBtnEl, collectFormDataObject, { formKeyToUse: 'ejecutivo', silent: true });
//
// Notas:
// - Para enviar silenciosamente a Google Forms necesitas mapping rows con form_entry_id
//   (ej. "entry.123456789") y form_url que apunte al formulario (viewform). El código
//   intenta derivar el endpoint "/formResponse" a partir de form_url.
// - No podemos leer la respuesta del servidor (cross-origin). El envío se realiza en un iframe
//   oculto para que no interrumpa la UX.
// - Si no hay mapping, se usa el fallback anterior (abrir URL con cc+body en query string).
//
// Dependencias: exporta/usa buildPrefillUrl y openPrefillWindow de './forms.js'
//               (ambas deben existir en tu proyecto).

import { buildPrefillUrl, openPrefillWindow } from './forms.js';

/* Carga y parseo de oculto.xlsx (sheet0: forms, sheet1: mapping) */
export async function loadOcultoWorkbook() {
  try {
    const resp = await fetch('oculto.xlsx');
    if (!resp.ok) {
      console.warn('oculto.xlsx no encontrado o HTTP error', resp.status);
      return { forms: [], mapping: [] };
    }
    const ab = await resp.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });

    const out = { forms: [], mapping: [] };

    if (wb.SheetNames.length >= 1) {
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (rows && rows.length > 0) {
        const headers = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const obj = {};
          for (let c = 0; c < headers.length; c++) {
            const k = headers[c] || `col${c}`;
            obj[k] = row[c] !== undefined ? String(row[c]) : '';
          }
          if (obj.form_key && obj.form_url) out.forms.push(obj);
        }
      }
    }

    if (wb.SheetNames.length >= 2) {
      const sheet = wb.Sheets[wb.SheetNames[1]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      if (rows && rows.length > 0) {
        const headers = (rows[0] || []).map(h => String(h || '').trim().toLowerCase());
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const obj = {};
          for (let c = 0; c < headers.length; c++) {
            const k = headers[c] || `col${c}`;
            obj[k] = row[c] !== undefined ? String(row[c]) : '';
          }
          if (obj.form_key && obj.form_entry_id) out.mapping.push(obj);
        }
      }
    }

    return out;
  } catch (err) {
    console.error('Error leyendo oculto.xlsx', err);
    return { forms: [], mapping: [] };
  }
}

/* Deriva la URL de envío (formResponse) a partir de una form_url (p.ej. Google Forms viewform).
   Si no puede transformar, devuelve la misma URL. */
function ensureFormResponseUrl(url) {
  try {
    const u = new URL(url, window.location.href);
    // Si la ruta contiene '/viewform' o '/edit', reemplazar por '/formResponse'
    if (/\/(viewform|edit)(?:$|\?)/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/(viewform|edit).*/, '/formResponse');
      u.search = '';
      return u.toString();
    }
    // Si la ruta termina con /forms/d/e/<id>/... buscamos el segmento y establecemos /formResponse
    const parts = u.pathname.split('/');
    // si detectamos 'forms' segment and 'd' then set last segment to formResponse
    const idxForms = parts.findIndex(p => p === 'forms');
    if (idxForms >= 0 && parts.length > idxForms + 2) {
      // construct /forms/.../formResponse
      const base = parts.slice(0, idxForms + 3); // up to '/forms/d/e/<id>'
      base.push('formResponse');
      u.pathname = base.join('/');
      u.search = '';
      return u.toString();
    }
    // fallback: try replacing last segment with formResponse
    parts[parts.length - 1] = 'formResponse';
    u.pathname = parts.join('/');
    u.search = '';
    return u.toString();
  } catch (e) {
    return url;
  }
}

/* Crea y envía un form POST hacia iframe oculto. inputs: array de { name, value } */
function submitToHiddenIframe(actionUrl, inputs = {}) {
  const iframeName = `oculto_iframe_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const iframe = document.createElement('iframe');
  iframe.name = iframeName;
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = actionUrl;
  form.target = iframeName;
  form.style.display = 'none';
  form.setAttribute('novalidate', 'true');

  // append inputs
  Object.keys(inputs).forEach(k => {
    const v = inputs[k];
    const inp = document.createElement('input');
    inp.type = 'hidden';
    inp.name = k;
    inp.value = v === undefined || v === null ? '' : String(v);
    form.appendChild(inp);
  });

  document.body.appendChild(form);

  // Submit and cleanup after timeout
  try {
    form.submit();
  } catch (err) {
    console.warn('submitToHiddenIframe submit error', err);
  }

  // Limpieza: remove form+iframe después de unos segundos (no intentamos leer respuesta)
  setTimeout(() => {
    try { form.remove(); } catch (e) {}
    try { iframe.remove(); } catch (e) {}
  }, 12_000); // 12s para dar tiempo al envío
}

/**
 * Inicializa el comportamiento "oculto".
 * - copyBtnEl: botón al que se enganchará el envío (por click)
 * - getDataObjectFn: función async -> dataObj (ej. collectFormDataObject)
 * - options: { formKeyToUse, openWindowOptions, silent }
 */
export async function initOculto(copyBtnEl, getDataObjectFn, options = {}) {
  if (!copyBtnEl || typeof getDataObjectFn !== 'function') {
    console.warn('initOculto: se requieren copyBtnEl y getDataObjectFn');
    return;
  }

  const cfg = Object.assign({
    formKeyToUse: null,
    openWindowOptions: { width: 700, height: null },
    silent: false // si true: intenta enviar silenciosamente via iframe+form
  }, options);

  const workbook = await loadOcultoWorkbook();
  if (!workbook || (!Array.isArray(workbook.forms) || workbook.forms.length === 0)) {
    console.info('initOculto: no hay forms en oculto.xlsx — no se activará envío oculto');
    return;
  }

  function resolveTargetForm() {
    if (cfg.formKeyToUse) {
      const f = workbook.forms.find(x => String(x.form_key) === String(cfg.formKeyToUse));
      if (f) return f;
    }
    const ej = workbook.forms.find(x => String(x.form_key).toLowerCase() === 'ejecutivo');
    if (ej) return ej;
    return workbook.forms[0];
  }

  const mappingByForm = {};
  (workbook.mapping || []).forEach(row => {
    const key = String(row.form_key || '').trim();
    if (!key) return;
    if (!mappingByForm[key]) mappingByForm[key] = [];
    mappingByForm[key].push(row);
  });

  const targetForm = resolveTargetForm();
  if (!targetForm) {
    console.warn('initOculto: no se pudo resolver form objetivo');
    return;
  }
  const mappingForTarget = mappingByForm[targetForm.form_key] || [];

  const handler = async (ev) => {
    try {
      const dataObj = await Promise.resolve(getDataObjectFn());
      if (!dataObj) { console.warn('initOculto: getDataObjectFn returned falsy'); return; }

      // Si tenemos mapping rows y silent=true -> enviar en segundo plano hacia action (formResponse)
      if (mappingForTarget && mappingForTarget.length > 0 && cfg.silent) {
        // mapping rows deben tener form_entry_id que luce como "entry.123456"
        const inputs = {};
        mappingForTarget.forEach(row => {
          const entryId = String(row.form_entry_id || '').trim();
          const fieldKey = String(row.field_name || '').trim();
          if (!entryId) return;
          // tomar valor de dataObj por field_name; si no existe, usar row.value (si existe)
          let val = '';
          if (fieldKey && (fieldKey in dataObj)) val = dataObj[fieldKey];
          else if (row.value) val = row.value;
          inputs[entryId] = val === undefined || val === null ? '' : String(val);
        });

        // targetForm.form_url -> derive formResponse endpoint
        const actionUrl = ensureFormResponseUrl(String(targetForm.form_url || ''));
        // enviar por form->iframe
        submitToHiddenIframe(actionUrl, inputs);
        return; // no abrir ventana
      }

      // Si mapping rows existen y silent==false -> usar buildPrefillUrl + abrir en ventana (previo comportamiento)
      if (mappingForTarget && mappingForTarget.length > 0) {
        const url = buildPrefillUrl(targetForm.form_url, mappingForTarget, dataObj);
        if (cfg.silent) {
          // si silent y mapping existe pero no podemos derivar action -> fallback abrir en background
          try { window.open(url, `_blank`); } catch (e) { openPrefillWindow(url); }
        } else {
          const width = cfg.openWindowOptions && cfg.openWindowOptions.width ? cfg.openWindowOptions.width : 700;
          const height = cfg.openWindowOptions && cfg.openWindowOptions.height ? cfg.openWindowOptions.height : null;
          const name = `oculto_${targetForm.form_key}_${Date.now()}`;
          const features = `toolbar=0,location=0,status=0,menubar=0,scrollbars=1,resizable=1,width=${width},height=${height || 800}`;
          const w = window.open('about:blank', name, features);
          if (!w) { openPrefillWindow(url); return; }
          try { w.location.href = url; } catch (e) { openPrefillWindow(url); }
        }
        return;
      }

      // Sin mapping -> fallback: enviar cc+body en query string (no silent submit posible sin conocer entry IDs)
      {
        const ccVal = dataObj.ejecutivo_cedula || dataObj.ejecutivo || '';
        const lines = [];
        if (dataObj.datetime) lines.push(`Fecha y hora: ${dataObj.datetime}`);
        if (dataObj.ejecutivo_nombre) lines.unshift(`Ejecutivo: ${dataObj.ejecutivo_nombre}`);
        Object.keys(dataObj).forEach(k => {
          if (k === 'datetime' || k === 'ejecutivo_cedula' || k === 'ejecutivo_nombre') return;
          const v = dataObj[k];
          if (v === undefined || v === null || String(v).trim() === '') return;
          lines.push(`${k}: ${v}`);
        });
        const bodyText = lines.join('\n');
        const sep = targetForm.form_url.includes('?') ? '&' : '?';
        const params = new URLSearchParams();
        if (ccVal) params.set('cc', ccVal);
        params.set('body', bodyText);
        const url = targetForm.form_url + sep + params.toString();

        try {
          const name = `oculto_fallback_${targetForm.form_key}_${Date.now()}`;
          window.open(url, name);
        } catch (err) {
          console.warn('initOculto fallback open error', err);
          openPrefillWindow(url);
        }
      }
    } catch (err) {
      console.error('initOculto handler error', err);
    }
  };

  // Attach listener (no se impide la acción original de copiar)
  copyBtnEl.addEventListener('click', handler);
  console.info('initOculto: listener attached to copy button for form_key=', targetForm.form_key, 'silent=', cfg.silent);
}