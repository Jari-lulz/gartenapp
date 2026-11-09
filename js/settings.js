// Einstellungen bleiben nur auf diesem Handy gespeichert (nie im Code auf GitHub).
import { HOME_LOCATION } from './config.js';

function read(key, fallback) {
  try {
    const v = localStorage.getItem('garten.' + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem('garten.' + key);
    else localStorage.setItem('garten.' + key, JSON.stringify(value));
  } catch {
    /* Speicher nicht verfügbar – dann eben nur für diese Sitzung */
  }
}

export const settings = {
  get apiKey() { return read('apiKey', ''); },
  set apiKey(v) { write('apiKey', v); },
  get model() { return read('model', ''); },
  set model(v) { write('model', v); },
  get location() { return read('location', null) || HOME_LOCATION; }, // { name, lat, lon }
  set location(v) { write('location', v); },
  get lastBackup() { return read('lastBackup', 0); },
  set lastBackup(v) { write('lastBackup', v); },
  get backupSnooze() { return read('backupSnooze', 0); },
  set backupSnooze(v) { write('backupSnooze', v); },
  isDismissed(key) { return !!read('dismissed', {})[key]; },
  dismiss(key) {
    const d = read('dismissed', {});
    d[key] = Date.now();
    write('dismissed', d);
  },
  getCache(key) { return read('cache.' + key, null); },
  setCache(key, v) { write('cache.' + key, v); },
};
