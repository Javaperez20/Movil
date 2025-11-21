// js/buscar.js
//
// Updated so "Usar" dispatches apply-campos-extra with metadata {campos_extra, id, titulo, color}
// and focuses the Tipificar title after switching with a smooth CSS animation class.
// The focus animation class is added then removed after the animation.

import { loadDataWorkbook } from './excel.js';

let workbookData = [];

export async function initBuscar() {
  workbookData = await loadDataWorkbook().catch(err => { console.warn(err); return []; });
  renderResults(workbookData);

  const searchInput = document.getElementById('searchInputBuscar');
  if (searchInput) {
    searchInput.addEventListener('input', debounce((e) => {
      const q = (e.target.value || '').trim().toLowerCase();
      if (!q) { renderResults(workbookData); return; }
      const filtered = workbookData.filter(r => {
        const title = (r.titulo || '').toLowerCase();
        const id = (r.id || '').toLowerCase();
        return title.includes(q) || id.includes(q);
      });
      renderResults(filtered);
    }, 220));
  }
}

function renderResults(items) {
  const cards = document.getElementById('cardsContainerBuscar');
  cards.innerHTML = '';
  cards.style.marginTop = '12px';
  if (!items || items.length === 0) {
    cards.innerHTML = `<p class="muted">No hay resultados.</p>`;
    return;
  }
  items.forEach(it => {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = it.id;
    card.style.borderLeft = `6px solid ${it.color || 'transparent'}`;
    card.innerHTML = `<div class="title">${escapeHtml(it.titulo || it.id)}</div>
                      <div class="small">${escapeHtml(it.subtitulo || '')}</div>`;
    card.addEventListener('click', () => onCardClick(it));
    cards.appendChild(card);
  });
}

function onCardClick(item) {
  const titleEl = document.getElementById('importantTitle');
  if (titleEl) {
    titleEl.style.display = 'block';
    titleEl.textContent = 'Información importante';
  }

  const info = document.getElementById('importantInfo');
  info.style.display = 'block';
  info.style.borderLeft = `6px solid ${item.color || 'transparent'}`;

  // Header: H1 title + colored separator + mono id inline
  let html = `<div class="important-header">`;
  html += `<h1 style="margin:0;font-weight:700;font-size:1.1rem;">${escapeHtml(item.titulo || item.id)}</h1>`;
  html += `<div class="important-sep" style="width:14px;height:4px;border-radius:3px;background:${item.color || 'transparent'}"></div>`;
  html += `<div class="mono-id" style="font-family: Roboto Mono, monospace; font-weight:700;">${escapeHtml(item.id || '')}</div>`;
  html += `</div>`;

  // Tipificación H2
  const hItems = (item.tipificacion_h || '').split(',').map(s=>s.trim()).filter(Boolean);
  const iItems = (item.tipificacion_i || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (hItems.length || iItems.length) {
    html += `<h2 style="margin-top:12px;margin-bottom:6px;font-weight:700;">Tipificación</h2>`;
    if (hItems.length) {
      html += `<div class="meta-row">`;
      hItems.forEach(it => html += `<span class="meta-badge">${escapeHtml(it)}</span>`);
      html += `</div>`;
    }
    if (iItems.length) {
      html += `<div class="meta-row">`;
      iItems.forEach(it => html += `<span class="meta-badge">${escapeHtml(it)}</span>`);
      html += `</div>`;
    }
  }

  // Motivo H2
  if (item.motivo) {
    html += `<h2 style="margin-top:12px;margin-bottom:6px;font-weight:700;">Motivo</h2>`;
    html += `<div class="obs-sugeridas">${escapeHtml(item.motivo)}</div>`;
  }

  // Verificaciones H2
  if (item.verificaciones) {
    const fItems = (item.verificaciones || '').split(',').map(s=>s.trim()).filter(Boolean);
    if (fItems.length) {
      html += `<h2 style="margin-top:12px;margin-bottom:6px;font-weight:700;">Verificaciones</h2>`;
      html += `<ul class="verificaciones-list">`;
      fItems.forEach(it => html += `<li>${escapeHtml(it)}</li>`);
      html += `</ul>`;
    }
  }

  // Sugerencias H2
  if (item.sugerencias) {
    html += `<h2 style="margin-top:12px;margin-bottom:6px;font-weight:700;">Sugerencias</h2>`;
    html += `<div class="obs-sugeridas">${escapeHtml(item.sugerencias)}</div>`;
  }

  html += `<div style="margin-top:10px;"><button id="useThisBtn" class="btn">Usar</button></div>`;
  info.innerHTML = html;

  try { info.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }); }

  const useBtn = document.getElementById('useThisBtn');
  if (useBtn) {
    useBtn.addEventListener('click', () => {
      // Clear dynamic fields first
      document.dispatchEvent(new CustomEvent('clear-dynamic-fields'));
      // Switch to Tipificar first (so user sees the page)
      const tipBtn = document.getElementById('tabTipificar');
      if (tipBtn) tipBtn.click();
      // Dispatch use-case so Tipificar can autofill fixed fields
      document.dispatchEvent(new CustomEvent('use-case', { detail: item }));
      // Dispatch apply-campos-extra with metadata so tipificar shows header and fields
      if (item.campos_extra) {
        document.dispatchEvent(new CustomEvent('apply-campos-extra', { detail: { campos_extra: item.campos_extra, id: item.id, titulo: item.titulo, color: item.color || null } }));
      }
      // After a short delay, focus and animate Tipificar title
      setTimeout(() => {
        const title = document.querySelector('#tipificarTitle') || document.querySelector('#tipificarPage h2');
        if (title) {
          title.setAttribute('tabindex', '-1');
          title.classList.add('focus-animate');        // CSS class triggers animation
          title.focus({ preventScroll: false });
          // remove class and tabindex after animation completes
          setTimeout(() => {
            title.classList.remove('focus-animate');
            title.removeAttribute('tabindex');
          }, 700);
        }
      }, 160);
    });
  }
}

function escapeHtml(unsafe) {
  return String(unsafe)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(()=> fn.apply(this, args), delay);
  };
}