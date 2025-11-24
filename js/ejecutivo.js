// js/ejecutivo.js - completo (asegura modal centrado, z-index alto y uso de clases .btn en los botones)
// Mejoras: focus trap, bloqueo scroll de fondo, restauración de foco al cerrar.

import { kvGet, kvSet, kvDelete } from './storage.js';
import { findAgentNameByCedula } from './excel.js';

export let Ejecutivo = '';

export async function getEjecutivoName() {
  try {
    const obj = await kvGet('ejecutivo');
    return obj && obj.name ? obj.name : '';
  } catch (err) {
    return '';
  }
}

export async function saveEjecutivo(cedulaInput) {
  const cedTrim = (String(cedulaInput || '')).trim();
  if (!cedTrim) {
    await kvDelete('ejecutivo');
    Ejecutivo = '';
    return '';
  }
  const normalized = normalizeCedulaForMatch(cedTrim);
  let finalName = cedTrim;
  try {
    const agentName = await findAgentNameByCedula(normalized);
    if (agentName) finalName = agentName;
  } catch (err) {
    console.warn('findAgentNameByCedula error', err);
  }
  await kvSet('ejecutivo', { cedula: cedTrim, name: finalName });
  Ejecutivo = finalName;
  return finalName;
}

export async function deleteEjecutivo() {
  try {
    await kvDelete('ejecutivo');
    Ejecutivo = '';
  } catch (err) {
    console.warn('deleteEjecutivo error', err);
  }
}

function normalizeCedulaForMatch(s) {
  return String(s).replace(/[\s\.\-]/g, '').toLowerCase();
}

export function initEjecutivoModal() {
  const gearBtn = document.getElementById('gearBtn');
  const modal = document.getElementById('ejecutivoModal');
  const ejecutivoInput = document.getElementById('ejecutivoInput');
  const editBtn = document.getElementById('editEjecutivoBtn');
  const deleteBtn = document.getElementById('deleteEjecutivoBtn');
  const cancelBtn = document.getElementById('cancelEjecutivoBtn');
  const acceptBtn = document.getElementById('acceptEjecutivoBtn');
  const nameSpan = document.getElementById('ejecutivoName');

  // ensure modal is child of body
  try { if (modal && modal.parentNode !== document.body) document.body.appendChild(modal); } catch (e) {}

  let lastFocused = null;
  let focusableElements = [];
  let boundKeydown = null;

  async function loadAndRender() {
    try {
      const obj = await kvGet('ejecutivo');
      const name = obj && obj.name ? obj.name : '';
      Ejecutivo = name;
      renderName();
    } catch (err) {
      console.error('No se pudo leer Ejecutivo', err);
    }
  }

  function renderName() {
    if (!nameSpan) return;
    if (Ejecutivo && String(Ejecutivo).trim() !== '') {
      nameSpan.textContent = String(Ejecutivo);
      nameSpan.title = `Ejecutivo: ${Ejecutivo}`;
    } else {
      nameSpan.textContent = '';
      nameSpan.title = '';
    }
  }

  function openModal() {
    if (!modal) return;
    kvGet('ejecutivo').then(obj => {
      ejecutivoInput.value = (obj && obj.cedula) ? obj.cedula : '';
      if (ejecutivoInput.value) ejecutivoInput.setAttribute('readonly', 'readonly');
      else ejecutivoInput.removeAttribute('readonly');
      setTimeout(() => acceptBtn && acceptBtn.focus(), 60);
    }).catch(() => {
      ejecutivoInput.value = '';
      ejecutivoInput.removeAttribute('readonly');
      setTimeout(() => acceptBtn && acceptBtn.focus(), 60);
    });

    // save last focused element to restore on close
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // show modal
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    // prevent background scroll
    document.body.style.overflow = 'hidden';

    // collect focusable elements inside modal
    focusableElements = Array.from(modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hasAttribute('disabled'));

    // focus first meaningful element (ejecutivoInput if editable, else acceptBtn)
    setTimeout(() => {
      if (ejecutivoInput && !ejecutivoInput.hasAttribute('readonly')) ejecutivoInput.focus();
      else if (acceptBtn) acceptBtn.focus();
    }, 80);

    // attach keydown handler for focus trap and Escape
    boundKeydown = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelBtn && cancelBtn.click();
        return;
      }
      if (ev.key === 'Tab') {
        // focus trap
        if (!focusableElements || focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        if (ev.shiftKey) {
          if (document.activeElement === first) {
            ev.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            ev.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', boundKeydown);
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    // restore body scroll
    document.body.style.overflow = '';
    // restore focus
    try { if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus(); } catch (e) {}
    // cleanup
    if (boundKeydown) {
      document.removeEventListener('keydown', boundKeydown);
      boundKeydown = null;
    }
  }

  gearBtn && gearBtn.addEventListener('click', openModal);
  editBtn && editBtn.addEventListener('click', () => { ejecutivoInput.removeAttribute('readonly'); ejecutivoInput.focus(); });
  deleteBtn && deleteBtn.addEventListener('click', () => { ejecutivoInput.removeAttribute('readonly'); ejecutivoInput.value = ''; ejecutivoInput.focus(); });

  cancelBtn && cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    kvGet('ejecutivo').then(obj => {
      ejecutivoInput.value = (obj && obj.cedula) ? obj.cedula : '';
      ejecutivoInput.setAttribute('readonly','readonly');
      closeModal();
    }).catch(() => {
      ejecutivoInput.value = '';
      ejecutivoInput.setAttribute('readonly','readonly');
      closeModal();
    });
  });

  acceptBtn && acceptBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const cedulaEntered = (ejecutivoInput.value || '').trim();
    try {
      if (!cedulaEntered) {
        await deleteEjecutivo();
        Ejecutivo = '';
      } else {
        const finalName = await saveEjecutivo(cedulaEntered);
        Ejecutivo = finalName || cedulaEntered;
      }
      renderName();
      ejecutivoInput.setAttribute('readonly','readonly');
      closeModal();
    } catch (err) {
      console.error('Error guardando/eliminando Ejecutivo', err);
      alert('No se pudo guardar el Ejecutivo. Revisa la consola.');
    }
  });

  // ESC handled in keydown handler attached on openModal

  // click outside dialog closes modal (but ensure clicks inside dialog do not)
  modal && modal.addEventListener('click', (ev) => {
    if (ev.target === modal) {
      // simulate cancel
      cancelBtn && cancelBtn.click();
    }
  });

  loadAndRender();
}