// js/timer-pip.js
// PiP timer with smooth color transition and toggle behavior.
// Includes DEFAULT_ALERT_VOLUME set to 0.02 for controlled alert volume.
// Behavior change (2025-11-18):
// - When the countdown reaches 00:00 it now stays in a "finished" state (00:00)
//   instead of immediately resetting to 02:00. Clicking after finish resets to
//   02:00 but leaves it paused (consistent with clicking while running).
// - Clicking while running still stops and resets to 02:00 paused.
// - start/stop logic keeps the same UX for normal usage.

const DEFAULT_SECONDS = 120; // 02:00 in seconds
const DEFAULT_ALERT_VOLUME = 0.02; // user's requested alert volume

let pipWindow = null;
let pipDisplayElement = null;
let timerInterval = null;
let running = false;
let finished = false;         // NEW: indicates we have reached 00:00 and are in finished state
let startTimestamp = 0;
let remainingMs = DEFAULT_SECONDS * 1000;

function formatMMSS(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export async function initTimerButton(buttonEl) {
  if (!buttonEl) return;
  buttonEl.classList.add('pip-mini');
  buttonEl.addEventListener('click', async () => {
    if (!window.documentPictureInPicture || typeof window.documentPictureInPicture.requestWindow !== 'function') {
      console.warn('Picture-in-Picture requestWindow no soportado en este navegador.');
      return;
    }
    try {
      if (pipWindow) {
        try { pipWindow.close(); } catch(e){/*ignore*/}
        stopTimer();
        remainingMs = DEFAULT_SECONDS * 1000;
        finished = false;
        pipWindow = null;
      } else {
        remainingMs = DEFAULT_SECONDS * 1000;
        finished = false;
        await openAlarmPip();
        updateDisplayAndBackground(remainingMs);
      }
    } catch (err) {
      console.error('Error toggling PiP:', err);
    }
  });
}

async function openAlarmPip() {
  if (!window.documentPictureInPicture || typeof window.documentPictureInPicture.requestWindow !== 'function') {
    throw new Error('documentPictureInPicture.requestWindow no disponible');
  }
  if (pipWindow) {
    try { pipWindow.focus(); } catch (e) {}
    return;
  }
  pipWindow = await window.documentPictureInPicture.requestWindow({ width: 320, height: 120 });
  const doc = pipWindow.document;

  const style = doc.createElement('style');
  style.textContent = `
    html,body{margin:0;height:100%;overflow:hidden;-webkit-user-select:none;-ms-user-select:none;user-select:none;}
    body{display:flex;align-items:center;justify-content:center;border-radius:12px;padding:6px;box-sizing:border-box;background:rgb(137,182,231);}
    .wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:12px;}
    #pipDisplay{font-family:'Roboto Mono', monospace, system-ui; font-size:36px; font-weight:700; color:#ffffff; border-radius:8px; padding:6px 18px; background:transparent; pointer-events:none;}
    .overlay{ position:absolute; inset:0; cursor:pointer; background:transparent; border-radius:12px; }
  `;
  doc.head.appendChild(style);

  const wrap = doc.createElement('div');
  wrap.className = 'wrap';
  wrap.style.position = 'relative';
  wrap.style.borderRadius = '12px';

  pipDisplayElement = doc.createElement('div');
  pipDisplayElement.id = 'pipDisplay';
  pipDisplayElement.textContent = formatMMSS(remainingMs);
  wrap.appendChild(pipDisplayElement);

  const overlay = doc.createElement('div');
  overlay.className = 'overlay';
  overlay.addEventListener('click', () => {
    // New logic: three cases:
    // - if running: stop and reset to DEFAULT (paused)
    // - else if finished (we reached 00:00 previously): reset to DEFAULT (paused)
    // - else (not running and not finished): start countdown
    if (running) {
      stopTimer();
      remainingMs = DEFAULT_SECONDS * 1000;
      finished = false;
      updateDisplayAndBackground(remainingMs);
    } else {
      if (finished || remainingMs === 0) {
        // After finish, clicking should reset to default but remain paused
        remainingMs = DEFAULT_SECONDS * 1000;
        finished = false;
        updateDisplayAndBackground(remainingMs);
      } else {
        // Normal start
        remainingMs = DEFAULT_SECONDS * 1000;
        startCountdown();
      }
    }
  });
  wrap.appendChild(overlay);

  doc.body.appendChild(wrap);

  updateDisplayAndBackground(remainingMs);

  pipWindow.addEventListener('unload', () => {
    stopTimer();
    pipWindow = null;
    finished = false;
  });
}

function startCountdown() {
  if (running) return;
  // Ensure we start from DEFAULT_SECONDS so UI is consistent.
  // If in the future we want resume-from-remaining, this is the place to adapt.
  finished = false;
  running = true;
  startTimestamp = Date.now();
  let lastKnownSec = Math.ceil(remainingMs / 1000);
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTimestamp;
    const newRemaining = Math.max(0, DEFAULT_SECONDS * 1000 - elapsed);
    const curSec = Math.ceil(newRemaining / 1000);

    if (curSec !== lastKnownSec) {
      if (curSec === 30 || curSec === 15) playTick();
      if (curSec === 0) {
        // Reached the end. Play final tick, stop, and enter finished state (00:00).
        playTick();
        stopTimer();            // sets running = false and clears interval
        remainingMs = 0;        // show 00:00
        finished = true;        // indicate finished state so clicks reset paused
        updateDisplayAndBackground(0);
        lastKnownSec = 0;
        return;
      }
      lastKnownSec = curSec;
    }

    remainingMs = newRemaining;
    updateDisplayAndBackground(remainingMs);
  }, 120);
}

function stopTimer() {
  if (!running && !timerInterval) return;
  running = false;
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateDisplayAndBackground(ms) {
  updateDisplay(ms);
  updateBackgroundSmooth(ms);
}

function updateDisplay(ms) {
  if (!pipDisplayElement) return;
  pipDisplayElement.textContent = formatMMSS(ms);
}

function updateBackgroundSmooth(ms) {
  if (!pipWindow) return;
  const totalMs = DEFAULT_SECONDS * 1000;
  const prog = Math.max(0, Math.min(1, (totalMs - ms) / totalMs));
  const sc = { r: 137, g: 182, b: 231 };
  const ec = { r: 255, g: 105, b: 97 };
  const r = Math.round(sc.r + (ec.r - sc.r) * prog);
  const g = Math.round(sc.g + (ec.g - sc.g) * prog);
  const b = Math.round(sc.b + (ec.b - sc.b) * prog);
  const color = `rgb(${r}, ${g}, ${b})`;
  try {
    pipWindow.document.body.style.background = color;
    pipWindow.document.body.style.borderRadius = '12px';
  } catch (e) {
    // ignore
  }
}

function playTick() {
  try {
    const audio = new Audio('tick.mp3');
    audio.volume = DEFAULT_ALERT_VOLUME;
    audio.play().catch(() => {});
  } catch (e) {
    console.warn('No se pudo reproducir tick.mp3', e);
  }
}