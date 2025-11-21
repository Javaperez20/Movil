// js/main.js - actualizado para delegar el rellenado de campos fijos a tipificar.js
// ---------------------------------------------------------------------------

import './storage.js';
import { initEjecutivoModal } from './ejecutivo.js';
import { initTipificar } from './tipificar.js';
import { initBuscar } from './buscar.js';
import { initTimerButton } from './timer-pip.js';
import { kvGet, kvSet } from './storage.js';
import { loadFormsMapping } from './excel.js';

// Theme helpers
const THEME_KEY = 'theme';
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'dark') html.setAttribute('data-theme', 'dark');
  else html.setAttribute('data-theme', 'light');
  updateThemeButtonState(theme);
}
function updateThemeButtonState(theme) {
  const themeToggleBtn = document.getElementById('themeToggle');
  if (!themeToggleBtn) return;
  if (theme === 'dark') { themeToggleBtn.textContent = '☀️'; themeToggleBtn.setAttribute('aria-pressed','true'); themeToggleBtn.title='Cambiar a modo claro'; }
  else { themeToggleBtn.textContent = '🌙'; themeToggleBtn.setAttribute('aria-pressed','false'); themeToggleBtn.title='Cambiar a modo oscuro'; }
}
async function initThemeFromPreference() {
  let stored;
  try { stored = await kvGet(THEME_KEY); } catch (e) { try { stored = localStorage.getItem(THEME_KEY) || undefined; } catch (e2) { stored = undefined; } }
  if (stored === 'dark' || stored === 'light') { applyTheme(stored); return; }
  applyTheme('light');
}
async function toggleTheme() {
  try {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { await kvSet(THEME_KEY, next); } catch (err) { try { localStorage.setItem(THEME_KEY, next); } catch(e){} }
  } catch (err) { console.warn('Error toggling theme', err); }
}

// Page segmented toggle
function initPageToggle() {
  const tipBtn = document.getElementById('tabTipificar');
  const buscarBtn = document.getElementById('tabBuscar');
  if (tipBtn) tipBtn.addEventListener('click', () => showPage('tipificar'));
  if (buscarBtn) buscarBtn.addEventListener('click', () => showPage('buscar'));
}
function showPage(name) {
  const tip = document.getElementById('tipificarPage');
  const bus = document.getElementById('buscarPage');
  const tipBtn = document.getElementById('tabTipificar');
  const buscarBtn = document.getElementById('tabBuscar');
  if (name === 'tipificar') {
    tip.classList.add('active'); tip.removeAttribute('aria-hidden');
    bus.classList.remove('active'); bus.setAttribute('aria-hidden','true');
    tipBtn && tipBtn.classList.add('seg-active'); buscarBtn && buscarBtn.classList.remove('seg-active');
  } else {
    bus.classList.add('active'); bus.removeAttribute('aria-hidden');
    tip.classList.remove('active'); tip.setAttribute('aria-hidden','true');
    buscarBtn && buscarBtn.classList.add('seg-active'); tipBtn && tipBtn.classList.remove('seg-active');

    // enfocar el título de la página Buscar
    try {
      const buscarTitle = document.querySelector('#buscarPage h2, #buscarPage .important-title-heading');
      if (buscarTitle) {
        buscarTitle.setAttribute('tabindex', '-1');
        buscarTitle.focus({ preventScroll: false });
        setTimeout(() => {
          try { buscarTitle.removeAttribute('tabindex'); } catch (e) {}
        }, 700);
      }
    } catch (e) {
      console.warn('No se pudo enfocar el título de Buscar', e);
    }
  }
}

// boot
document.addEventListener('DOMContentLoaded', async () => {
  initEjecutivoModal();
  initPageToggle();
  await initThemeFromPreference();
  document.getElementById('themeToggle').addEventListener('click', (e)=> { e.preventDefault(); toggleTheme(); });

  initTimerButton(document.getElementById('timerBtn'));

  initTipificar();
  initBuscar();

  // load forms mapping
  try {
    const fm = await loadFormsMapping();
    const out = { forms: fm.forms || [], mapping: fm.mapping || [] };
    window.__formsMapping = out;
    console.log('forms_mapping loaded', out);
    if ((!out.forms || out.forms.length === 0) && (!out.mapping || out.mapping.length === 0)) {
      console.warn('forms_mapping.xlsx cargado pero vacío o sin formato esperado.');
    }
  } catch (err) {
    console.warn('No se pudo cargar forms_mapping.xlsx', err);
    window.__formsMapping = { forms: [], mapping: [] };
  }

  // Nota: El evento 'use-case' lo maneja ahora tipificar.js (rellena los fixed fields generados),
  // por eso aquí NO se hacen asignaciones directas a elementos concretos.
});