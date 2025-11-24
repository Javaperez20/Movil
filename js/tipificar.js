// js/tipificar.js
// Página Tipificar (archivo completo, actualizado)
// - Ahora los campos "fijos" (excepto Fecha/hora y Buscar casos) se generan desde fijos.xlsx
// - Mantiene: offcanvas, campos dinámicos, options, dropdowns mejorados, envío de forms, etc.

import { loadDataWorkbook, loadOptionsWorkbook, loadFijosWorkbook } from './excel.js';
import { buildPrefillUrl, openPrefillWindow } from './forms.js';
import { kvGet } from './storage.js';
import { initOculto } from './oculto.js';

let workbookData = [];
let optionsData = { options: [], fields: [] };
let fijosData = []; // array de definiciones de campos fijos (desde fijos.xlsx)
let fixedFieldsMeta = {}; // map field_name -> metadata
let fixedFieldOrder = []; // array of field names in the original order
let selectedOptionKey = null;
let dateIntervalId = null;
let currentDateInput = null;

export async function initTipificar() {
  // refs
  const datetimeEl = document.getElementById('field_datetime');
  const searchInput = document.getElementById('searchInputTipificar'); // permanece fijo
  const fixedTopContainer = document.getElementById('fixedFieldsTop');
  const fixedBottomContainer = document.getElementById('fixedFieldsBottom');
  const dynamicFieldsContainer = document.getElementById('dynamicFields');
  const optionsToggleContainer = document.getElementById('optionsToggle');
  const optionsFieldsContainer = document.getElementById('optionsFields');

  if (dynamicFieldsContainer) dynamicFieldsContainer.classList.add('inputs-area');
  if (optionsFieldsContainer) optionsFieldsContainer.classList.add('inputs-area');
  if (optionsToggleContainer) optionsToggleContainer.classList.add('options-toggle-container');

  // textarea auto-resize helper
  function resizeTextareaEl(el) {
    if (!el || el.tagName.toLowerCase() !== 'textarea') return;
    el.style.height = 'auto';
    const sh = el.scrollHeight;
    el.style.height = sh + 'px';
  }
  function installAutoResizeTextarea(el) {
    if (!el || el.tagName.toLowerCase() !== 'textarea') return;
    el.addEventListener('input', () => resizeTextareaEl(el));
    setTimeout(() => resizeTextareaEl(el), 0);
  }

  // clear dynamic fields helper
  document.addEventListener('clear-dynamic-fields', () => {
    const c = document.getElementById('dynamicFields');
    if (c) c.innerHTML = '';
  });

  // live datetime
  if (dateIntervalId !== null) clearInterval(dateIntervalId);
  if (datetimeEl) {
    datetimeEl.value = new Date().toLocaleString();
    currentDateInput = datetimeEl;
    dateIntervalId = setInterval(() => {
      if (currentDateInput) currentDateInput.value = new Date().toLocaleString();
    }, 1000);
  }

  // load workbooks
  workbookData = await loadDataWorkbook().catch(err => { console.warn('loadDataWorkbook error', err); return []; });
  optionsData = await loadOptionsWorkbook().catch(err => { console.warn('loadOptionsWorkbook error', err); return { options: [], fields: [] }; });
  fijosData = await loadFijosWorkbook().catch(err => { console.warn('loadFijosWorkbook error', err); return []; });

  // normalize and index fixed fields metadata
  fixedFieldsMeta = {};
  fixedFieldOrder = [];
  fijosData.forEach((f) => {
    // expected normalization of columns from fijos.xlsx:
    // field_name, field_label, field_placeholder, field_type, field_choices, field_sources
    const name = String(f.field_name || '').trim();
    if (!name) return;
    const meta = {
      field_name: name,
      field_label: f.field_label || name,
      field_placeholder: f.field_placeholder || '',
      field_type: (f.field_type || '').toLowerCase() || '',
      field_choices: (f.field_choices || '').toString(),
      field_sources: (f.field_sources || '').toString(), // optional semicolon-separated keys to look in item
      auto_fill: f.auto_fill || '' // optional legacy flag
    };
    fixedFieldsMeta[name] = meta;
    fixedFieldOrder.push(name);
  });

  // render fixed fields according to requested order:
  // datetime always present; then first 4 generated fields (if exist) into fixedTopContainer;
  // then searchInput (already in DOM); then remaining generated fields into fixedBottomContainer.
  function clearFixedContainers() {
    if (fixedTopContainer) fixedTopContainer.innerHTML = '';
    if (fixedBottomContainer) fixedBottomContainer.innerHTML = '';
  }
  clearFixedContainers();

  function createGeneratedFieldElement(meta) {
    // returns wrapper element containing label and input/textarea or dropdown wrapper
    const row = document.createElement('div');
    row.className = 'input-row';
    const label = document.createElement('label');
    label.textContent = meta.field_label || meta.field_name;

    // determine element type: if field_choices present -> strict autocomplete; if field_type==='input' -> input; else textarea
    const rawChoices = (meta.field_choices || '').toString().trim();
    const hasChoices = rawChoices.length > 0;

    if (hasChoices) {
      const choicesArr = rawChoices.split(';').map(s => s.trim()).filter(Boolean);
      const created = createStrictAutocompleteDropdown(meta.field_name, meta.field_placeholder || '', choicesArr);
      const wrapper = created.wrapper || created; // function returns {wrapper, inputEl}
      const inputEl = created.inputEl || wrapper.querySelector('input');
      // dataset
      inputEl.dataset.fieldName = meta.field_name;
      inputEl.dataset.label = meta.field_label || meta.field_name;
      row.appendChild(label);
      row.appendChild(wrapper);
    } else if (meta.field_type === 'input') {
      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.placeholder = meta.field_placeholder || '';
      inputEl.dataset.fieldName = meta.field_name;
      inputEl.dataset.label = meta.field_label || meta.field_name;
      inputEl.classList.add('generated-input');
      row.appendChild(label);
      row.appendChild(inputEl);
    } else {
      const inputEl = document.createElement('textarea');
      inputEl.rows = 1;
      inputEl.placeholder = meta.field_placeholder || '';
      inputEl.dataset.fieldName = meta.field_name;
      inputEl.dataset.label = meta.field_label || meta.field_name;
      installAutoResizeTextarea(inputEl);
      row.appendChild(label);
      row.appendChild(inputEl);
    }
    return row;
  }

  // render according to order
  const total = fixedFieldOrder.length;
  for (let i = 0; i < total; i++) {
    const name = fixedFieldOrder[i];
    const meta = fixedFieldsMeta[name];
    const el = createGeneratedFieldElement(meta);
    // first 4 -> top container, else -> bottom container
    if (i < 4) {
      fixedTopContainer && fixedTopContainer.appendChild(el);
    } else {
      fixedBottomContainer && fixedBottomContainer.appendChild(el);
    }
  }

  // expose helper to get a fixed input element by field name
  function getFixedInputEl(fieldName) {
    if (!fieldName) return null;
    // try selector by data-field-name
    const sel = `[data-field-name="${CSS.escape(fieldName)}"]`;
    let el = document.querySelector(sel);
    if (el) return el;
    // fallback try id pattern fixed_{fieldName}
    el = document.getElementById(`fixed_${fieldName}`);
    return el;
  }

  // --------------------
  // Render options (segmented toggle)
  // --------------------
  function renderOptions(options) {
    const wrap = document.getElementById('optionsToggle');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.classList.add('options-toggle-container');
    options = options || [];
    if (options.length === 0) console.warn('[tipificar] no options in optionsData.options');
    options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'opt-btn';
      btn.textContent = opt.option_label || opt.option_key || `Option ${idx+1}`;
      btn.dataset.key = opt.option_key;
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedOptionKey = opt.option_key;
        renderDynamicFieldsForOption(selectedOptionKey);
      });
      wrap.appendChild(btn);
    });
    if (options.length > 0) {
      const first = wrap.querySelector('.opt-btn');
      if (first) first.click();
    }
  }
  renderOptions(optionsData.options || []);

  // --------------------
  // Offcanvas (search)
  // --------------------
  const offcanvas = document.getElementById('offcanvas');
  const offcanvasList = document.getElementById('offcanvasList');
  const offcanvasClose = document.getElementById('offcanvasClose');
  const offcanvasBackdrop = createOffcanvasBackdrop();

  function openOffcanvas() {
    if (!offcanvas) return;
    offcanvas.setAttribute('aria-hidden', 'false');
    offcanvasBackdrop.classList.add('active');
  }
  function closeOffcanvas() {
    if (!offcanvas) return;
    offcanvas.setAttribute('aria-hidden', 'true');
    offcanvasBackdrop.classList.remove('active');
  }
  offcanvasClose && offcanvasClose.addEventListener('click', closeOffcanvas);
  offcanvasBackdrop && offcanvasBackdrop.addEventListener('click', closeOffcanvas);

  if (searchInput) {
    searchInput.addEventListener('input', debounce((ev) => {
      const q = (ev.target.value || '').trim().toLowerCase();
      if (!q) { closeOffcanvas(); return; }
      if (!workbookData || workbookData.length === 0) {
        renderOffcanvasList([], offcanvasList, closeOffcanvas, 'No se pudo cargar data.xlsx o está vacío.');
        openOffcanvas();
        return;
      }
      const filtered = workbookData.filter(item => {
        const title = (item.titulo || '').toString().toLowerCase();
        const id = (item.id || '').toString().toLowerCase();
        return (title && title.includes(q)) || (id && id.includes(q));
      }).slice(0, 6);
      if (filtered.length === 0) {
        renderOffcanvasList([], offcanvasList, closeOffcanvas, 'No se encontraron coincidencias.');
      } else {
        renderOffcanvasList(filtered, offcanvasList, closeOffcanvas);
      }
      openOffcanvas();
    }, 220));
  }

  // --------------------
  // Copy button
  // --------------------
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) {
  try {
    initOculto(copyBtn, collectFormDataObject, { formKeyToUse: 'a', silent: true });
    console.info('[tipificar] initOculto inicializado para form_key="a" (silent=true)');
  } catch (e) {
    console.warn('No se pudo inicializar initOculto', e);
  }
}
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const fields = getActiveFields();
      const lines = [];
      fields.forEach(f => {
        if (!f.value || String(f.value).trim() === '') return;
        const label = f.label || prettifyLabel(f.name);
        if (/observaciones?/i.test(label)) lines.push(`${label.toUpperCase()}:\n${f.value}`);
        else lines.push(`${label.toUpperCase()}: ${f.value}`);
      });
      const text = lines.join('\n');

      // collect structured data object to send to historico
      let dataObj = {};
      try { dataObj = await collectFormDataObject(); } catch (e) { console.warn('collectFormDataObject error before copy', e); }

      try {
        await navigator.clipboard.writeText(text);
        setCopyStatus('Copiado.');
        // Dispatch evento para que el módulo histórico guarde la tarjeta
        try {
          document.dispatchEvent(new CustomEvent('history-save', { detail: { dataObj: dataObj, text: text, datetime: new Date().toISOString() } }));
        } catch (e) { console.warn('No se pudo dispatch history-save', e); }
        
      } catch (err) {
        setCopyStatus('No se pudo copiar automáticamente. Texto mostrado abajo.');
        const pre = document.createElement('pre');
        pre.textContent = text;
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.background = '#fff';
        pre.style.padding = '8px';
        pre.style.border = '1px solid #ddd';
        dynamicFieldsContainer && dynamicFieldsContainer.appendChild(pre);

        // igualmente intentamos guardar en histórico aunque el copy automático fallara
        try {
          document.dispatchEvent(new CustomEvent('history-save', { detail: { dataObj: dataObj, text: text, datetime: new Date().toISOString() } }));
        } catch (e) { console.warn('No se pudo dispatch history-save fallback', e); }
      }
      
    }
  );
  }

  // --------------------
  // Open sized window sync then navigate (helps avoid popup-block)
  // --------------------
  function openSizedWindowAndNavigate(url, width = 700, height = null, windowName = null) {
    if (!url) return null;
    try {
      const screenLeft = typeof window.screenLeft !== 'undefined' ? window.screenLeft : (window.screenX || 0);
      const screenTop = typeof window.screenTop !== 'undefined' ? window.screenTop : (window.screenY || 0);
      const screenWidth = window.innerWidth || screen.width;
      const screenHeight = window.innerHeight || screen.height;
      const finalHeight = (height === null) ? Math.max(300, Math.floor((screenHeight) / 2)) : height;
      const left = Math.max(0, Math.floor((screenWidth - width) / 2) + (screenLeft || 0));
      const top = Math.max(0, Math.floor((screenHeight - finalHeight) / 2) + (screenTop || 0));
      const features = `toolbar=0,location=0,status=0,menubar=0,scrollbars=1,resizable=1,width=${width},height=${finalHeight},left=${left},top=${top}`;
      const name = windowName || `form_win_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const w = window.open('about:blank', name, features);
      if (!w) {
        openPrefillWindow(url);
        return null;
      }
      try { w.location.href = url; } catch (e) { openPrefillWindow(url); }
      try { if (typeof w.focus === 'function') w.focus(); } catch (e) {}
      return w;
    } catch (e) {
      console.warn('openSizedWindowAndNavigate fallback', e);
      openPrefillWindow(url);
      return null;
    }
  }

  // --------------------
  // Send handler
  // --------------------
  const sendBtn = document.getElementById('sendBtn');
  if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      try {
        const dataObj = await collectFormDataObject();
        const fm = window.__formsMapping || { forms: [], mapping: [] };
        
        if (!fm.forms || fm.forms.length === 0) {
          console.warn('No hay formularios configurados en forms_mapping.xlsx');
          alert('No hay formularios configurados. Revisa forms_mapping.xlsx.');
          return;
        }

        let targetFormKeys = [];
        if (selectedOptionKey) {
          const opt = (optionsData.options || []).find(o => String(o.option_key) === String(selectedOptionKey));
          if (opt && opt.form_key) targetFormKeys = [String(opt.form_key)];
          else targetFormKeys = fm.forms.map(f => String(f.form_key));
        } else {
          targetFormKeys = fm.forms.map(f => String(f.form_key));
        }

        for (let i = 0; i < targetFormKeys.length; i++) {
          const key = targetFormKeys[i];
          const form = (fm.forms || []).find(f => String(f.form_key) === String(key));
          if (!form) { console.warn(`[tipificar] form_key not found: ${key}`); continue; }
          const mappingForForm = (fm.mapping || []).filter(m => m.form_key === form.form_key);
          const url = buildPrefillUrl(form.form_url, mappingForForm, dataObj);

          console.log(`[tipificar] opening form key=${form.form_key} mappingRows=${mappingForForm.length} url=`, url);
          const safeKey = String(form.form_key || `form_${i}`).replace(/[^\w\-]/g, '_');
          const windowName = `prefill_${safeKey}_${i}_${Date.now()}`;
          openSizedWindowAndNavigate(url, 700, null, windowName);
          await new Promise(res => setTimeout(res, 140));
        }
      } catch (err) {
        console.error('Error al enviar formularios prefilled', err);
        alert('Ocurrió un error al preparar los formularios. Revisa la consola.');
      }
    });
  }

  // --------------------
  // Autocomplete dropdown (exact same improved implementation as before)
  // --------------------
  function createStrictAutocompleteDropdown(fieldName, placeholder, choicesArr = []) {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder || '';
    input.dataset.fieldName = fieldName;
    input.dataset.label = placeholder || fieldName;
    input.autocomplete = 'off';
    input.setAttribute('aria-autocomplete', 'list');
    input.classList.add('generated-input');

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-datalist-wrapper';
    wrapper.style.position = 'relative';
    wrapper.style.display = 'inline-block';
    wrapper.appendChild(input);

    const dropdown = document.createElement('ul');
    dropdown.className = 'custom-datalist';
    dropdown.setAttribute('role', 'listbox');
    dropdown.style.position = 'absolute';
    dropdown.style.left = '0';
    dropdown.style.right = '0';
    dropdown.style.zIndex = '2200';
    dropdown.style.listStyle = 'none';
    dropdown.style.margin = '6px 0 0 0';
    dropdown.style.padding = '6px 0';
    dropdown.style.borderRadius = '8px';
    dropdown.style.boxShadow = '0 8px 20px rgba(0,0,0,0.08)';
    dropdown.style.maxHeight = 'calc(var(--baseline-height,38px) * 4 + 8px)';
    dropdown.style.overflowY = 'auto';
    dropdown.style.display = 'none';
    dropdown.style.background = 'var(--card)';

    let choices = choicesArr.slice();
    let visible = choices.slice();
    let activeIndex = -1;

    const baselinePx = (() => {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue('--baseline-height');
        return v ? parseInt(v, 10) || 38 : 38;
      } catch (e) { return 38; }
    })();
    const desiredMaxHeight = baselinePx * 4 + 8;

    let onWindowChange = null;

    function computeAndApplyPosition() {
      const rect = input.getBoundingClientRect();
      const viewportH = window.innerHeight || document.documentElement.clientHeight;
      const spaceBelow = Math.max(0, viewportH - rect.bottom - 8);
      const spaceAbove = Math.max(0, rect.top - 8);
      const preferUp = (spaceBelow < Math.min(desiredMaxHeight, 160) && spaceAbove > spaceBelow);

      if (preferUp) {
        dropdown.style.top = 'auto';
        dropdown.style.bottom = '100%';
        dropdown.style.margin = '0 0 6px 0';
        const maxH = Math.max(80, Math.min(desiredMaxHeight, spaceAbove));
        dropdown.style.maxHeight = `${maxH}px`;
      } else {
        dropdown.style.bottom = 'auto';
        dropdown.style.top = '100%';
        dropdown.style.margin = '6px 0 0 0';
        const maxH = Math.max(80, Math.min(desiredMaxHeight, spaceBelow || desiredMaxHeight));
        dropdown.style.maxHeight = `${maxH}px`;
      }
    }

    function renderList(list) {
      dropdown.innerHTML = '';
      list.forEach((ch, idx) => {
        const li = document.createElement('li');
        li.className = 'custom-datalist-item';
        li.dataset.value = ch;
        li.textContent = ch;
        li.style.padding = '8px 12px';
        li.style.cursor = 'pointer';
        li.style.whiteSpace = 'nowrap';
        li.style.overflow = 'hidden';
        li.style.textOverflow = 'ellipsis';
        li.style.minHeight = 'var(--baseline-height)';
        li.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          input.value = ch;
          hide();
          input.focus();
        });
        li.addEventListener('mouseover', () => setActive(idx));
        dropdown.appendChild(li);
      });
      if (list.length === 0) {
        const li = document.createElement('li');
        li.className = 'custom-datalist-empty';
        li.textContent = 'No hay opciones';
        li.style.padding = '8px 12px';
        li.style.color = 'var(--muted)';
        dropdown.appendChild(li);
      }
    }

    function show() {
      renderList(visible);
      computeAndApplyPosition();
      dropdown.style.display = 'block';
      if (document.documentElement.getAttribute('data-theme') === 'dark') dropdown.classList.add('custom-datalist--dark');
      else dropdown.classList.remove('custom-datalist--dark');

      if (!onWindowChange) {
        onWindowChange = debounce(() => {
          if (dropdown.style.display !== 'none') computeAndApplyPosition();
        }, 120);
        window.addEventListener('resize', onWindowChange, { passive: true });
        window.addEventListener('scroll', onWindowChange, true);
      }
    }
    function hide() {
      dropdown.style.display = 'none';
      activeIndex = -1;
      if (onWindowChange) {
        window.removeEventListener('resize', onWindowChange, { passive: true });
        window.removeEventListener('scroll', onWindowChange, true);
        onWindowChange = null;
      }
    }

    function setActive(i) {
      const items = Array.from(dropdown.querySelectorAll('.custom-datalist-item'));
      items.forEach((it, idx) => {
        if (idx === i) {
          it.classList.add('active');
          it.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
        } else {
          it.classList.remove('active');
          it.style.background = 'transparent';
        }
      });
      activeIndex = i;
      const it = items[i];
      if (it) {
        try { it.scrollIntoView({ block: 'nearest' }); } catch (e) {}
      }
    }

    function findBestMatch(q) {
      const qq = (q || '').toString().trim().toLowerCase();
      if (!qq) return null;
      const exact = choices.find(ch => ch.toLowerCase() === qq);
      if (exact) return exact;
      const starts = choices.find(ch => ch.toLowerCase().startsWith(qq));
      if (starts) return starts;
      const incl = choices.find(ch => ch.toLowerCase().includes(qq));
      if (incl) return incl;
      return null;
    }

    function filter(q) {
      const qq = (q || '').toLowerCase().trim();
      visible = choices.filter(ch => ch.toLowerCase().includes(qq));
      renderList(visible);
      show();
      activeIndex = -1;
    }

    input.addEventListener('input', (ev) => {
      filter(ev.target.value || '');
    });

    input.addEventListener('keydown', (ev) => {
      const items = Array.from(dropdown.querySelectorAll('.custom-datalist-item'));
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (dropdown.style.display === 'none') { filter(input.value); return; }
        const next = Math.min(items.length - 1, Math.max(0, activeIndex + 1));
        setActive(next);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (dropdown.style.display === 'none') { filter(input.value); return; }
        const prev = Math.max(0, activeIndex - 1);
        setActive(prev);
      } else if (ev.key === 'Enter') {
        if (dropdown.style.display !== 'none' && activeIndex >= 0) {
          ev.preventDefault();
          const it = items[activeIndex];
          if (it) { input.value = it.dataset.value; hide(); }
          return;
        }
        const best = findBestMatch(input.value);
        if (best) {
          ev.preventDefault();
          input.value = best;
          hide();
        }
      } else if (ev.key === 'Tab') {
        if (dropdown.style.display !== 'none' && activeIndex >= 0) {
          const items2 = Array.from(dropdown.querySelectorAll('.custom-datalist-item'));
          const it = items2[activeIndex];
          if (it) {
            input.value = it.dataset.value;
            hide();
            return;
          }
        }
        const bestOnTab = findBestMatch(input.value);
        if (bestOnTab) {
          input.value = bestOnTab;
          hide();
        }
      } else if (ev.key === 'Escape') {
        if (dropdown.style.display !== 'none') { ev.preventDefault(); hide(); }
      }
    });

    input.addEventListener('blur', () => {
      setTimeout(() => {
        const v = (input.value || '').trim();
        if (v === '') { hide(); return; }
        const exact = choices.find(ch => ch === v);
        if (exact) { input.value = exact; hide(); return; }
        const caseInsensitive = choices.find(ch => ch.toLowerCase() === v.toLowerCase());
        if (caseInsensitive) { input.value = caseInsensitive; hide(); return; }
        const best = findBestMatch(v);
        if (best) { input.value = best; hide(); return; }

        input.value = '';
        input.classList.add('input-empty');
        setTimeout(() => input.classList.remove('input-empty'), 900);
        hide();
      }, 120);
    });

    document.addEventListener('click', (ev) => { if (!wrapper.contains(ev.target)) hide(); });

    wrapper.appendChild(dropdown);
    return { wrapper, inputEl: input, setChoices: (arr) => { choices = arr.slice(); visible = choices.slice(); } };
  }

  // --------------------
  // Helper: Auto-fill fixed fields from a data item (used by offcanvas and by external "use-case")
  // --------------------
  function autoFillFixedFieldsFromItem(item) {
    if (!item) return;
    // For each generated fixed field, attempt to populate ONLY if configured to do so
    const fixedEls = Array.from(document.querySelectorAll('#fixedFieldsTop [data-field-name], #fixedFieldsBottom [data-field-name]'));
    fixedEls.forEach(el => {
      const fname = el.dataset.fieldName;
      if (!fname) return;
      const meta = fixedFieldsMeta[fname];
      if (!meta) return;

      // Determine whether this field is allowed to be auto-filled:
      // - If field_sources is provided (non-empty) we use that list.
      // - Else if meta.auto_fill === 'true' we allow fallbacks (legacy behavior).
      // - Otherwise we SKIP auto-fill for this field.
      const sourcesRaw = meta.field_sources ? String(meta.field_sources).trim() : '';
      const autoFillFlag = String(meta.auto_fill || '').toLowerCase() === 'true';

      if (!sourcesRaw && !autoFillFlag) {
        // Not configured to auto-fill -> skip
        return;
      }

      const candidates = [];

      if (sourcesRaw) {
        sourcesRaw.split(';').map(s => s.trim()).filter(Boolean).forEach(s => candidates.push(s));
      }

      // If explicit sources not provided but autoFillFlag true, allow fallback keys including the field_name itself
      if (autoFillFlag || !sourcesRaw) {
        candidates.push(fname);
        ['c','d','e','f','telefonos','telefono','motivo','proceso','sondeo','nombre','rut','id'].forEach(k => {
          if (!candidates.includes(k)) candidates.push(k);
        });
      }

      // find first candidate key present with non-empty value
      let assigned = null;
      for (let k of candidates) {
        // try exact key, lowercase key, uppercase key
        if (k in item && item[k] !== undefined && String(item[k]).trim() !== '') { assigned = item[k]; break; }
        const lk = k.toLowerCase();
        if (lk in item && item[lk] !== undefined && String(item[lk]).trim() !== '') { assigned = item[lk]; break; }
        const uk = k.toUpperCase();
        if (uk in item && item[uk] !== undefined && String(item[uk]).trim() !== '') { assigned = item[uk]; break; }
      }

      if (assigned !== null && assigned !== undefined && String(assigned).trim() !== '') {
        // set value and resize if textarea
        try {
          // if el is actual input/textarea
          if (el.tagName && (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea')) {
            el.value = assigned;
            if (el.tagName.toLowerCase() === 'textarea') resizeTextareaEl(el);
          } else {
            // wrapper: try to find an inner input or textarea
            const inner = el.querySelector ? (el.querySelector('input,textarea') || null) : null;
            if (inner) {
              inner.value = assigned;
              if (inner.tagName.toLowerCase() === 'textarea') resizeTextareaEl(inner);
            }
          }
        } catch (e) {
          console.warn('Error asignando valor a fixed field', fname, e);
        }
      }
    });
  }

  // --------------------
  // Render dynamic fields for option
  // --------------------
  function renderDynamicFieldsForOption(optionKey) {
    const container = document.getElementById('optionsFields');
    if (!container) return;
    container.innerHTML = '';
    const fields = (optionsData.fields || []).filter(f => f.option_key === optionKey);
    fields.forEach(f => {
      const row = document.createElement('div');
      row.className = 'input-row';
      const label = document.createElement('label');
      label.textContent = f.field_label || f.field_name;

      const rawChoices = (f.field_choices || f.choices || f.field_options || f.options || '').toString().trim();
      const hasChoices = rawChoices.length > 0;
      if (hasChoices) {
        const choicesArr = rawChoices.split(';').map(s => s.trim()).filter(Boolean);
        const { wrapper, inputEl } = createStrictAutocompleteDropdown(f.field_name, f.field_placeholder || '', choicesArr);
        inputEl.dataset.fieldName = f.field_name;
        inputEl.dataset.label = f.field_label || f.field_name;
        row.appendChild(label);
        row.appendChild(wrapper);
      } else if (f.field_type && String(f.field_type).toLowerCase() === 'input') {
        const inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = f.field_placeholder || '';
        inputEl.dataset.fieldName = f.field_name;
        inputEl.dataset.label = f.field_label || f.field_name;
        inputEl.classList.add('generated-input');
        row.appendChild(label);
        row.appendChild(inputEl);
      } else {
        const inputEl = document.createElement('textarea');
        inputEl.rows = 1;
        inputEl.placeholder = f.field_placeholder || '';
        inputEl.dataset.fieldName = f.field_name;
        inputEl.dataset.label = f.field_label || f.field_name;
        installAutoResizeTextarea(inputEl);
        row.appendChild(label);
        row.appendChild(inputEl);
      }
      container.appendChild(row);
    });
  }

  // --------------------
  // Offcanvas list & campo injection
  // --------------------
/* Reemplaza la función renderOffcanvasList existente por ésta (sólo este bloque) */
function renderOffcanvasList(items, container, closer, message = '') {
  container.innerHTML = '';
  if (message) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = message; container.appendChild(p); return;
  }
  if (!items || items.length === 0) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No hay coincidencias.'; container.appendChild(p); return;
  }
  items.forEach(it => {
    const card = document.createElement('div'); card.className = 'card';
    card.style.borderLeft = `6px solid ${it.color || 'transparent'}`;
    card.innerHTML = `<div class="title">${escapeHtml(it.titulo || it.id)}</div><div class="small">${escapeHtml(it.subtitulo || '')}</div>`;
    card.addEventListener('click', () => {
      // Clear dynamic fields always (keeps existing fixed inputs unless the item explicitly provides values)
      document.dispatchEvent(new CustomEvent('clear-dynamic-fields'));

      // Use the shared autofill helper to populate fixed fields
      autoFillFixedFieldsFromItem(it);

      // Apply campos_extra if present
      if (it.campos_extra) document.dispatchEvent(new CustomEvent('apply-campos-extra', { detail: { campos_extra: it.campos_extra, id: it.id, titulo: it.titulo, color: it.color || null } }));

      closer();
    });
    container.appendChild(card);
  });
}

  // --------------------
  // apply-campos-extra listener & inject helper
  // --------------------
  function applyCamposExtra(arg) {
    if (!arg) return;
    if (typeof arg === 'string') { injectCamposText(arg); return; }
    const campos = arg.campos_extra || arg.campos || '';
    const container = document.getElementById('dynamicFields'); if (!container) return;
    container.innerHTML = '';
    setDynamicHeader({ id: arg.id, titulo: arg.titulo, color: arg.color });
    injectCamposText(campos);
  }

// Reemplaza únicamente la función injectCamposText por esta versión más robusta
function injectCamposText(text) {
  const container = document.getElementById('dynamicFields'); if (!container) return;

  // Split top-level fields while ignoring semicolons that are inside a choices=... segment
  function splitTopLevelFields(s) {
    const parts = [];
    let buf = '';
    let i = 0;
    const L = s.length;
    let inChoices = false;
    while (i < L) {
      // detect start of "choices=" (case-insensitive) from current position in the rest of the string
      const rest = s.slice(i).toLowerCase();
      if (!inChoices && rest.startsWith('choices=')) {
        // append 'choices=' to buffer and advance
        buf += s.substr(i, 8);
        i += 8;
        inChoices = true;
        continue;
      }

      const ch = s[i];

      if (inChoices) {
        // while inChoices, append until we hit the ':' that ends the field definition (the first ':' after choices=)
        buf += ch;
        if (ch === ':') {
          // end of meta portion (choices value area ended by ':')
          inChoices = false;
        }
        i++;
        continue;
      }

      // not inChoices: semicolon is a top-level field separator
      if (ch === ';') {
        // push trimmed if not empty
        const t = buf.trim();
        if (t.length > 0) parts.push(t);
        buf = '';
        i++;
        continue;
      }

      // normal char
      buf += ch;
      i++;
    }
    // push remainder
    const t = buf.trim();
    if (t.length > 0) parts.push(t);
    return parts;
  }

  // parse each field part like before but now supporting meta (type, choices, name, placeholder)
  const parts = splitTopLevelFields(String(text || ''));

  parts.forEach(p => {
    // Split only on the first ':' to separate left(definition) and placeholder
    const colon = p.indexOf(':');
    const left = colon === -1 ? p.trim() : p.slice(0, colon).trim();
    const placeholder = colon === -1 ? '' : p.slice(colon + 1).trim();

    // left can have metadata separated by '|' -> label | key=val | key=val ...
    const segs = left.split('|').map(s => s.trim()).filter(Boolean);
    const labelText = segs[0] || '';
    const meta = {};
    for (let i = 1; i < segs.length; i++) {
      const kv = segs[i];
      const eq = kv.indexOf('=');
      if (eq === -1) { meta[kv.toLowerCase()] = true; continue; }
      const k = kv.slice(0, eq).trim().toLowerCase();
      const v = kv.slice(eq + 1).trim();
      meta[k] = v;
    }

    // allow explicit field name via meta.name, else generate from label
    const fieldName = meta.name ? String(meta.name).trim() : labelToFieldName(labelText);

    const row = document.createElement('div'); row.className = 'input-row';
    const lbl = document.createElement('label'); lbl.textContent = labelText || fieldName;
    row.appendChild(lbl);

    // If there are choices (meta.choices) or type=choices -> create dropdown autocomplete
    if ((meta.type && String(meta.type).toLowerCase() === 'choices') || meta.choices) {
      const rawChoices = meta.choices ? String(meta.choices) : '';
      // rawChoices uses semicolons as separator for options
      const choicesArr = rawChoices.split(';').map(s => s.trim()).filter(Boolean);
      const { wrapper, inputEl } = createStrictAutocompleteDropdown(fieldName, placeholder || (meta.placeholder || ''), choicesArr);
      inputEl.dataset.fieldName = fieldName;
      inputEl.dataset.label = labelText || fieldName;
      row.appendChild(wrapper);
    } else if (meta.type && String(meta.type).toLowerCase() === 'input') {
      // single-line input
      const inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.placeholder = placeholder || (meta.placeholder || '');
      inputEl.dataset.fieldName = fieldName;
      inputEl.dataset.label = labelText || fieldName;
      inputEl.classList.add('generated-input');
      row.appendChild(inputEl);
    } else {
      // default: textarea with auto-resize
      const inputEl = document.createElement('textarea');
      inputEl.rows = 1;
      inputEl.placeholder = placeholder || (meta.placeholder || '');
      inputEl.dataset.fieldName = fieldName;
      inputEl.dataset.label = labelText || fieldName;
      installAutoResizeTextarea(inputEl);
      row.appendChild(inputEl);
    }

    container.appendChild(row);
  });

  // focus the first generated control
  // setTimeout(() => { const first = container.querySelector('textarea, input'); if (first) first.focus(); }, 40);
}

  function setDynamicHeader(item) {
    const container = document.getElementById('dynamicFields'); if (!container) return;
    let header = container.querySelector('.dynamic-header');
    if (!header) { header = document.createElement('div'); header.className = 'dynamic-header'; header.style.marginBottom = '8px'; header.style.display = 'flex'; header.style.alignItems = 'center'; header.style.gap = '10px'; header.style.paddingBottom = '6px'; container.insertBefore(header, container.firstChild); }
    const titleText = item && item.titulo ? String(item.titulo) : '';
    const idText = item && item.id ? String(item.id) : '';
    const color = item && item.color ? String(item.color) : null;
    header.innerHTML = '';
    const left = document.createElement('div'); left.style.fontWeight = '700'; left.style.fontSize = '0.98rem'; left.textContent = titleText;
    const sep = document.createElement('div'); sep.className = 'dynamic-separator'; sep.style.width = '14px'; sep.style.height = '3px'; sep.style.borderRadius = '2px'; sep.style.background = color || 'transparent'; sep.style.flex = '0 0 auto';
    const right = document.createElement('div'); right.style.fontFamily = 'Roboto Mono, monospace'; right.style.fontWeight = '700'; right.style.fontSize = '0.98rem'; right.textContent = idText;
    header.appendChild(left); header.appendChild(sep); header.appendChild(right);
  }

  // --- Data collection helpers
  async function collectFormDataObject() {
    const obj = {};
    obj.datetime = datetimeEl ? datetimeEl.value : '';
    // collect generated fixed fields
    const fixedEls = Array.from(document.querySelectorAll('#fixedFieldsTop [data-field-name], #fixedFieldsBottom [data-field-name]'));
    fixedEls.forEach(el => {
      const key = el.dataset.fieldName;
      if (!key) return;
      let val = '';
      if (el.tagName.toLowerCase() === 'textarea' || el.tagName.toLowerCase() === 'input') val = el.value;
      else {
        const inner = el.querySelector('input, textarea');
        if (inner) val = inner.value;
      }
      obj[key] = val;
    });
    // dynamic fields
    const dyn = document.querySelectorAll('#dynamicFields [data-field-name]'); dyn.forEach(d => { obj[d.dataset.fieldName] = d.value; });
    // options fields
    const opts = document.querySelectorAll('#optionsFields [data-field-name]'); opts.forEach(o => { obj[o.dataset.fieldName] = o.value; });

    // añadir datos del Ejecutivo guardado
    try {
      const ej = await kvGet('ejecutivo');
      if (ej) {
        if (ej.cedula) obj.ejecutivo_cedula = ej.cedula;
        if (ej.name) obj.ejecutivo_nombre = ej.name;
        if (ej.cedula && !obj.ejecutivo) obj.ejecutivo = ej.cedula;
      }
    } catch (e) {
      console.warn('No se pudo leer Ejecutivo desde storage al generar dataObj', e);
    }

    return obj;
  }

  // reemplaza la función getActiveFields por esta versión
function getActiveFields() {
  const arr = [];

  // Incluir siempre Fecha y hora al inicio
  arr.push({
    name: 'datetime',
    label: 'Fecha y hora',
    value: datetimeEl ? datetimeEl.value : ''
  });

  // Campos fijos generados (top + bottom) en el mismo orden visual
  const fixedEls = Array.from(document.querySelectorAll('#fixedFieldsTop [data-field-name], #fixedFieldsBottom [data-field-name]'));
  fixedEls.forEach(el => {
    const name = el.dataset.fieldName;
    if (!name) return;
    const label = el.dataset.label || prettifyLabel(name);
    let value = '';

    // si el elemento es input/textarea directos
    if (el.tagName && (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea')) {
      value = el.value;
    } else {
      // si es wrapper (p.ej. dropdown) buscar inner input/textarea
      const inner = el.querySelector ? (el.querySelector('input,textarea') || null) : null;
      if (inner) value = inner.value;
    }

    arr.push({ name, label, value });
  });

  // Campos dinámicos (campos_extra)
  const dyn = document.querySelectorAll('#dynamicFields [data-field-name]');
  dyn.forEach(d => arr.push({ name: d.dataset.fieldName, label: d.dataset.label || prettifyLabel(d.dataset.fieldName), value: d.value }));

  // Campos de options (segmented)
  const opts = document.querySelectorAll('#optionsFields [data-field-name]');
  opts.forEach(o => arr.push({ name: o.dataset.fieldName, label: o.dataset.label || prettifyLabel(o.dataset.fieldName), value: o.value }));

  return arr;
}

  // utilities
  function setCopyStatus(msg) { const el = document.getElementById('copyStatus'); if (el) el.textContent = msg; setTimeout(() => { if (el) el.textContent = ''; }, 4000); }
  function createOffcanvasBackdrop() { let b = document.querySelector('.offcanvas-backdrop'); if (!b) { b = document.createElement('div'); b.className = 'offcanvas-backdrop'; document.body.appendChild(b); } return b; }
  function escapeHtml(unsafe) { return String(unsafe).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function debounce(fn, delay) { let timer = null; return function(...args){ clearTimeout(timer); timer = setTimeout(()=>fn.apply(this,args), delay); }; }
  function labelToFieldName(label) { return String(label||'').trim().toLowerCase().replace(/\s+/g,'_').replace(/[^\w\-]/g,''); }
  function prettifyLabel(key) { return String(key||'').replace(/_/g,' ').replace(/\b\w/g, l => l.toUpperCase()); }

  // Helper to focus the top of the page (used after clearing all)
  function focusPageStart() {
    const topEl = document.querySelector('#tipificarTitle') || document.querySelector('header h1') || document.body;
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { /* ignore */ }
    if (topEl && topEl instanceof HTMLElement) {
      try {
        topEl.setAttribute('tabindex', '-1');
        topEl.focus({ preventScroll: false });
        setTimeout(() => {
          try { topEl.removeAttribute('tabindex'); } catch (e) {}
        }, 800);
      } catch (e) { /* ignore */ }
    }
  }

  // --------------------
  // CLEAR ALL modal behavior
  // --------------------
  const clearAllBtn = document.getElementById('clearAllBtn');
  const clearAllModal = document.getElementById('clearAllModal');
  const confirmClearAllBtn = document.getElementById('confirmClearAllBtn');
  const cancelClearAllBtn = document.getElementById('cancelClearAllBtn');

  let lastFocusedBeforeClearModal = null;
  function openClearModal() {
    if (!clearAllModal) return;
    lastFocusedBeforeClearModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearAllModal.hidden = false;
    clearAllModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => confirmClearAllBtn && confirmClearAllBtn.focus(), 60);
    document.addEventListener('keydown', clearModalKeydown);
    clearAllModal.addEventListener('click', clearModalBackdropClick);
  }
  function closeClearModal() {
    if (!clearAllModal) return;
    clearAllModal.hidden = true;
    clearAllModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    try { if (lastFocusedBeforeClearModal && typeof lastFocusedBeforeClearModal.focus === 'function') lastFocusedBeforeClearModal.focus(); } catch (e) {}
    document.removeEventListener('keydown', clearModalKeydown);
    clearAllModal.removeEventListener('click', clearModalBackdropClick);
  }
  function clearModalBackdropClick(ev) {
    if (ev.target === clearAllModal) cancelClearAllBtn && cancelClearAllBtn.click();
  }
  function clearModalKeydown(ev) {
    if (ev.key === 'Escape') cancelClearAllBtn && cancelClearAllBtn.click();
  }

  async function clearAllFields() {
    // clear generated fixed fields
    const fixedEls = Array.from(document.querySelectorAll('#fixedFieldsTop [data-field-name], #fixedFieldsBottom [data-field-name]'));
    fixedEls.forEach(el => {
      const inner = (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea') ? el : (el.querySelector ? el.querySelector('input,textarea') : null);
      if (inner) {
        inner.value = '';
        if (inner.tagName.toLowerCase() === 'textarea') resizeTextareaEl(inner);
      }
    });

    // dynamic and options
    const dyn = document.getElementById('dynamicFields'); if (dyn) dyn.innerHTML = '';
    const opts = document.getElementById('optionsFields'); if (opts) opts.innerHTML = '';

    // Reset options toggle to first option
    try {
      const wrap = document.getElementById('optionsToggle');
      if (wrap) {
        const btns = Array.from(wrap.querySelectorAll('.opt-btn'));
        if (btns.length > 0) {
          btns.forEach(b => b.classList.remove('active'));
          btns[0].classList.add('active');
          selectedOptionKey = btns[0].dataset.key;
          renderDynamicFieldsForOption(selectedOptionKey);
        }
      }
    } catch (e) { console.warn('reset options error', e); }

    setCopyStatus('Borrado.');
  }

  if (clearAllBtn) clearAllBtn.addEventListener('click', (e) => { e.preventDefault(); openClearModal(); });
  if (cancelClearAllBtn) cancelClearAllBtn.addEventListener('click', (e) => { e.preventDefault(); closeClearModal(); });
  if (confirmClearAllBtn) confirmClearAllBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await clearAllFields(); } catch (err) { console.warn('Error clearing fields', err); }
    closeClearModal();
    // After the modal closes, focus the top of the page so the user is at the start
    setTimeout(() => {
      try { focusPageStart(); } catch (e) { console.warn('focusPageStart error', e); }
    }, 120);
  });

  // navigate to Buscar
  const goToBuscarBtn = document.getElementById('goToBuscarBtn');
  if (goToBuscarBtn) goToBuscarBtn.addEventListener('click', () => { document.getElementById('tabBuscar').click(); });

  // apply-campos-extra listener
  document.addEventListener('apply-campos-extra', (ev) => { if (!ev || !ev.detail) return; applyCamposExtra(ev.detail); });

  // NEW: use-case listener -> auto-fill fixed fields, set header via apply-campos-extra if provided, and resize textareas
  document.addEventListener('use-case', (ev) => {
    if (!ev || !ev.detail) return;
    const item = ev.detail;
    // Clear dynamic fields first (consumer may already clear, but ensure)
    document.dispatchEvent(new CustomEvent('clear-dynamic-fields'));
    // Attempt to autofill fixed fields
    autoFillFixedFieldsFromItem(item);
    // If item has campos_extra still dispatch apply-campos-extra to create dynamic fields/header
    if (item.campos_extra) {
      document.dispatchEvent(new CustomEvent('apply-campos-extra', { detail: { campos_extra: item.campos_extra, id: item.id, titulo: item.titulo, color: item.color || null } }));
    }
    // resize any textareas just in case
    setTimeout(() => {
      const fixedEls = Array.from(document.querySelectorAll('#fixedFieldsTop textarea, #fixedFieldsBottom textarea, #dynamicFields textarea'));
      fixedEls.forEach(el => { if (el && el.tagName && el.tagName.toLowerCase() === 'textarea') resizeTextareaEl(el); });
    }, 60);
  });

  // resize fixed textareas when use-case fills them (legacy hook removed; handled in use-case listener)

  // ensure initial render if not done
  if (optionsData && Array.isArray(optionsData.options) && optionsData.options.length > 0) renderOptions(optionsData.options);
}