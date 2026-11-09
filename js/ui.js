// Gemeinsame Bausteine für alle Seiten: Symbole, Kopfzeilen, kleine Helfer.
import { esc } from './util.js';

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>'),
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  settings: svg('<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>'),
  pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  send: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  speaker: svg('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
  share: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'),
};

export const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canSpeak = 'speechSynthesis' in window;

export const fmtDate = (t) => new Date(t).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
export const byName = (a, b) => a.name.localeCompare(b.name, 'de');
export const healthDot = (a) => ({ gesund: '🟢', 'leichte Probleme': '🟡', krank: '🔴' }[a?.zustand] || '⚪');

// Sehr einfaches Markdown für Chat-Antworten: **fett** und Aufzählungen
export function md(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    const item = line.match(/^[-*•]\s+(.*)/);
    if (item) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${item[1]}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      if (line) html += `<p>${line}</p>`;
    }
  }
  return html + (inList ? '</ul>' : '');
}

// Kopfzeile für Unterseiten
export const appBar = (title, backHref = '#/') => `
  <header class="appbar">
    <a class="icon-btn" href="${backHref}" aria-label="Zurück">${ICON.back}</a>
    <h1>${esc(title)}</h1>
    <span class="icon-btn placeholder"></span>
  </header>`;

// Großes Foto oben mit Zurück-Knopf
export const cover = (img) => `
  <div class="cover">
    ${img}
    <a class="icon-btn floating" href="#/" aria-label="Zurück">${ICON.back}</a>
  </div>`;

export const bottomBar = (label, plantId = '') => `
  <div class="bottom-bar">
    <button class="btn primary big" data-action="camera" data-plant="${plantId}">${ICON.camera}<span>${label}</span></button>
    <button class="icon-btn square" data-action="gallery" data-plant="${plantId}" aria-label="Foto aus der Galerie">${ICON.image}</button>
  </div>`;

export const micButton = (field) => (SpeechRec
  ? `<button class="icon-btn mic" type="button" data-action="mic" data-field="${field}" aria-label="Sprechen">${ICON.mic}</button>`
  : '');
