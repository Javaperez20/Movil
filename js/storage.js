// storage.js - IndexedDB key/value helper con fallback a localStorage
export async function openKVDB() {
  if (!('indexedDB' in window)) throw new Error('IndexedDB no disponible');
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('app-db', 1);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet(key) {
  try {
    const db = await openKVDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const store = tx.objectStore('kv');
      const r = store.get(key);
      r.onsuccess = () => resolve(r.result ? r.result.value : undefined);
      r.onerror = () => reject(r.error);
    });
  } catch (err) {
    // fallback localStorage
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    } catch (e) {
      return undefined;
    }
  }
}

export async function kvSet(key, value) {
  try {
    const db = await openKVDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }
}

export async function kvDelete(key) {
  try {
    const db = await openKVDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
}