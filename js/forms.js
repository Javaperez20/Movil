// js/forms.js
// helpers para armar URLs de prefill y abrir ventana
// - Soporta field_name simples (comportamiento original).
// - Soporta field_name múltiples separados por ';' (ej: "id; rut; ejecutivo_cedula").
//   Cuando hay múltiples campos, se concatenan en el orden indicado, una línea por campo:
//     ID: 123
//     RUT: 1.111.111-1
//   y ese texto resultante se envía como el valor para form_entry_id correspondiente.
// - Soporta columna opcional 'field_label' en la hoja mapping para controlar la etiqueta
//   que se usa para cada field (puede contener varias labels separadas por ';' alineadas con field_name).
// - Soporta columna opcional 'field_slice' con la sintaxis "start||end" (separador '||'):
//     - "start||end" -> extrae lo que hay entre la primera aparición de "start" y la primera aparición de "end" que venga después.
//     - "||end" -> desde inicio hasta "end".
//     - "start||" -> desde "start" hasta el final.
//   Para múltiples field_names puedes dar un único field_slice (se aplica a todos) o múltiples separados por ';' en el mismo orden.

export function buildPrefillUrl(formUrl, mappingForForm, dataObj) {
  // mappingForForm: [{ field_name, field_label, field_slice, form_key, form_entry_id }, ...]
  // dataObj: objeto con claves -> valores
  const params = [];

  function prettifyLabel(key) {
    return String(key || '').replace(/_/g, ' ').toUpperCase();
  }

  function applySlice(value, sliceSpec) {
    if (value === undefined || value === null) return '';
    const v = String(value);
    if (!sliceSpec || String(sliceSpec).trim() === '') return v.trim();

    // sliceSpec: "start||end"  (literal strings). If start empty -> from beginning. If end empty -> to end.
    const parts = String(sliceSpec).split('||');
    const rawStart = parts[0] !== undefined ? parts[0] : '';
    const rawEnd = parts[1] !== undefined ? parts[1] : '';

    const startMarker = rawStart;
    const endMarker = rawEnd;

    let startPos = 0;
    if (startMarker !== '') {
      const idx = v.indexOf(startMarker);
      if (idx === -1) {
        // start marker not found -> treat as "no match" -> return empty string (omit)
        return '';
      }
      startPos = idx + startMarker.length;
    } else {
      startPos = 0;
    }

    if (endMarker === '') {
      // to the end
      return v.slice(startPos).trim();
    } else {
      // find end after startPos
      const idx2 = v.indexOf(endMarker, startPos);
      if (idx2 === -1) {
        // if end not found, take until end
        return v.slice(startPos).trim();
      }
      return v.slice(startPos, idx2).trim();
    }
  }

  mappingForForm.forEach(m => {
    const entryId = (m.form_entry_id || '').trim();
    if (!entryId) return;

    const rawField = (m.field_name || '').toString();
    // Soportamos múltiples field names separados por ';'
    const fieldNames = rawField.split(';').map(s => s.trim()).filter(Boolean);
    if (fieldNames.length === 0) return;

    // Parseamos posibles labels provistos en el mapping (pueden ser 1 o N, separados por ';')
    const rawLabelCell = (m.field_label || '').toString().trim();
    const labelCandidates = rawLabelCell ? rawLabelCell.split(';').map(s => s.trim()).filter(Boolean) : [];

    // Parseamos posibles slicers provistos en 'field_slice' (1 o N, separados por ';')
    const rawSliceCell = (m.field_slice || '').toString().trim();
    const sliceCandidates = rawSliceCell ? rawSliceCell.split(';').map(s => s.trim()).filter(Boolean) : [];

    if (fieldNames.length === 1) {
      // comportamiento original para un solo field_name, aplicando slice si existe
      const fn = fieldNames[0];
      let value = dataObj[fn];
      // apply slice if provided (use first slice if any)
      if (sliceCandidates.length >= 1) {
        value = applySlice(value, sliceCandidates[0]);
      }
      if (value === undefined || value === null || String(value).trim() === '') return;
      params.push(`${encodeURIComponent(entryId)}=${encodeURIComponent(String(value))}`);
    } else {
      // múltiples campos: concatenar en varias líneas con LABEL: valor por línea
      const lines = [];
      fieldNames.forEach((fn, idx) => {
        let value = dataObj[fn];
        // pick matching slice candidate: same index if provided, otherwise use first slice if it exists
        let sliceSpec = '';
        if (sliceCandidates.length > idx) sliceSpec = sliceCandidates[idx];
        else if (sliceCandidates.length === 1) sliceSpec = sliceCandidates[0];
        if (sliceSpec) value = applySlice(value, sliceSpec);

        if (value === undefined || value === null || String(value).trim() === '') return;
        const providedLabel = labelCandidates[idx]; // puede ser undefined
        const label = providedLabel ? String(providedLabel).toUpperCase() : prettifyLabel(fn);
        lines.push(`${label}: ${String(value)}`);
      });
      if (lines.length === 0) return; // no hay valores útiles
      const combined = lines.join('\n'); // saltos de línea entre campos
      params.push(`${encodeURIComponent(entryId)}=${encodeURIComponent(String(combined))}`);
    }
  });

  if (params.length === 0) return formUrl; // NO hay campos con valor -> abrir form vacío
  const sep = formUrl.includes('?') ? '&' : '?';
  return formUrl + sep + params.join('&');
}

export function openPrefillWindow(url) {
  try {
    window.open(url, '_blank', 'noopener');
  } catch (e) {
    // fallback
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}