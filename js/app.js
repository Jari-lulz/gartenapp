import * as db from './db.js';
import * as ai from './gemini.js';
import * as wx from './weather.js';
import { prepareImage } from './image.js';
import { settings } from './settings.js';
import { APP_URL } from './config.js';
import { esc, uid } from './util.js';
import {
  ICON, SpeechRec, canSpeak, fmtDate, byName, healthDot, md, appBar, cover, bottomBar, micButton, gardenTitle,
} from './ui.js';
import { mapSvg, normalizePlan } from './plan.js';
import {
  viewWalk, viewPlan, handlePlanClick, handlePlanSubmit, handlePlanChange, handlePlanInput,
  startPlacing, linkItem, unlinkPlant, itemForPlant,
} from './planview.js';

const app = document.getElementById('app');
const camInput = document.getElementById('cam');
const galleryInput = document.getElementById('gallery');
const restoreInput = document.getElementById('restore');
const BACKUP_DAYS = 14;

export const state = {
  pending: null,     // gerade aufgenommenes Foto: { photo, thumb, targetId, itemId, status, analysis, error, chat }
  captureFor: null,  // Pflanzen-ID, falls ein Foto für eine bestimmte Pflanze gemacht wird
  captureItem: null, // Punkt im Gartenplan, zu dem ein Foto gemacht wird
  openEntry: null,
  busyChat: null,
  chatError: null,
  placeResults: [],
  msg: {},
  // Gartenplan
  walk: null,
  plan: null,
  planPlants: [],
  sel: null,         // { kind: 'area' | 'item' | 'weg', id }
  planMode: 'view',  // 'view' | 'edit' | 'measure' | 'place'
  labels: false,
  measure: [],
  placing: null,     // { plantId, name, suggestions }
  onb: { name: '', results: [], loc: null, msg: '' }, // Ersteinrichtung
};

const owner = () => settings.name || '';

// ---------- Einrichtungs-Link: #setup=SCHLÜSSEL&name=NAME ----------
// Der Teil nach # wird nie an einen Server geschickt – Schlüssel und Name landen nur auf diesem Handy.
(function applySetupLink() {
  if (!location.hash.startsWith('#setup=')) return;
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const key = params.get('setup');
    if (key) {
      settings.apiKey = key;
      settings.model = '';
      state.msg.welcome = true;
    }
    const name = params.get('name');
    if (name && !settings.name) state.onb.name = name.slice(0, 30);
  } catch { /* kaputter Link */ }
  history.replaceState(null, '', location.pathname + location.search + '#/');
})();

// ---------- Ersteinrichtung: Name und Garten-Standort ----------
function viewOnboarding() {
  const o = state.onb;
  const ready = o.name.trim() && o.loc;
  return `
    <section class="hero onboarding">
      <div class="onb-icon">🌿</div>
      <h1>Willkommen!</h1>
      <p class="hero-date">Zwei kurze Fragen, dann geht es los. Die Antworten bleiben nur auf diesem Handy.</p>
    </section>
    <div class="page">
      <div class="card">
        <h3>1. Wie heißt du?</h3>
        <input name="onb-name" data-input="onb-name" value="${esc(o.name)}" placeholder="Dein Vorname" autocomplete="given-name">
      </div>
      <div class="card">
        <h3>2. Wo ist dein Garten?</h3>
        <p class="muted small">Für Wetter und Frostwarnungen. Ort oder Adresse eingeben – oder im Garten auf „Standort verwenden“ tippen.</p>
        ${o.loc ? `<div class="picked">📍 <div><b>${esc(o.loc.name)}</b><span class="muted small">${esc(o.loc.label || '')}</span></div><button class="btn small" data-action="onb-change">Ändern</button></div>` : `
        <form class="inline" data-form="onb-search">
          <input name="q" placeholder="z. B. Gartenstraße 5, Musterstadt" autocomplete="street-address">
          <button class="btn secondary" type="submit">Suchen</button>
        </form>
        ${o.results.map((r, i) => `<button class="btn list" data-action="onb-pick" data-i="${i}"><span><b>${esc(r.name)}</b><br><span class="muted small">${esc(r.label)}</span></span></button>`).join('')}
        <button class="btn secondary wide" data-action="onb-gps">${ICON.pin}<span>Aktuellen Standort verwenden</span></button>`}
        ${o.msg ? `<p class="status">${esc(o.msg)}</p>` : ''}
      </div>
      <button class="btn primary big" data-action="onb-done" ${ready ? '' : 'disabled'}>Los geht's</button>
    </div>`;
}

// ---------- Navigation ----------
export const route = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);

export async function render() {
  const [page, id] = route();
  document.body.dataset.page = page || 'home';
  document.title = gardenTitle(owner());
  try {
    if (!settings.name || !settings.location) app.innerHTML = viewOnboarding();
    else if (page === 'analyse') app.innerHTML = await viewAnalyse();
    else if (page === 'pflanze') app.innerHTML = await viewPlant(id);
    else if (page === 'einstellungen') app.innerHTML = viewSettings();
    else if (page === 'plan' && id === 'rundgang') app.innerHTML = viewWalk();
    else if (page === 'plan') app.innerHTML = await viewPlan();
    else {
      app.innerHTML = await viewHome();
      loadWeather();
    }
    loadPhotos();
  } catch (e) {
    console.error(e);
    app.innerHTML = `${appBar('Fehler')}<div class="page"><div class="card error"><p>Da ist etwas schiefgelaufen: ${esc(e.message)}</p><a class="btn" href="#/">Zur Startseite</a></div></div>`;
  }
}

export function rerenderIf(page) {
  if (route()[0] === page) render();
}

window.addEventListener('hashchange', () => {
  const page = route()[0];
  state.placeResults = [];
  state.chatError = null;
  if (page !== 'einstellungen') state.msg = {};
  if (page !== 'pflanze') state.openEntry = null;
  if (page !== 'plan') {
    state.planMode = 'view';
    state.measure = [];
    state.placing = null;
  }
  render().then(() => window.scrollTo(0, 0));
});

// Große Fotos erst laden, wenn sie sichtbar sind
async function loadPhotos() {
  for (const img of app.querySelectorAll('img[data-photo]:not([src])')) {
    const details = img.closest('details');
    if (details && !details.open) continue;
    const rec = await db.getPhoto(img.dataset.photo);
    if (rec) img.src = rec.data;
  }
}
document.addEventListener('toggle', loadPhotos, true);

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Hallo';
  return 'Guten Abend';
}
const placeName = () => settings.location?.name || "";

// ---------- Startseite ----------
async function viewHome() {
  const plants = (await db.getPlants()).sort(byName);
  const plan = normalizePlan(await db.getMeta('plan'));
  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const welcome = state.msg.welcome ? `
    <div class="card setup">
      <h2>Alles eingerichtet, ${esc(owner())}!</h2>
      <p>Die App ist startklar. Tippe unten auf „Pflanze fotografieren“ und probier es aus.</p>
    </div>` : '';
  const setup = settings.apiKey ? '' : `
    <div class="card setup">
      <h2>Willkommen, ${esc(owner())}!</h2>
      <p>Bevor es losgeht, muss einmal der kostenlose Gemini-Schlüssel eingetragen werden.</p>
      <a class="btn primary" href="#/einstellungen">Jetzt einrichten</a>
    </div>`;
  const needsBackup = (plants.length || plan)
    && Date.now() - settings.lastBackup > BACKUP_DAYS * 864e5
    && Date.now() > settings.backupSnooze;
  const backupHint = needsBackup ? `
    <div class="hint info">
      <b>💾 Zeit für eine Sicherung</b>
      <p>${settings.lastBackup ? `Die letzte Sicherung ist vom ${fmtDate(settings.lastBackup)}.` : 'Es gibt noch keine Sicherung.'} Schick deine Pflanzen, Fotos und den Gartenplan per E-Mail, damit nichts verloren geht.</p>
      <div class="row-btns">
        <button class="btn small solid" data-action="backup-share">${ICON.share}<span>Jetzt sichern</span></button>
        <button class="btn small" data-action="backup-snooze">Später</button>
      </div>
    </div>` : '';
  const planCard = plan
    ? `<a class="card plan-card" href="#/plan">
         <div class="plan-mini">${mapSvg(plan, plants, { interactive: false })}</div>
         <div><h3>Gartenplan</h3><p class="muted small">${plan.items.length} Bäume &amp; Pflanzen · ${plan.areas.length} Flächen</p></div>
       </a>`
    : `<a class="card plan-card" href="#/plan">
         <span class="plan-icon">🗺️</span>
         <div><h3>Gartenplan erstellen</h3><p class="muted small">Ich führe dich mit der Kamera durch den Garten und zeichne daraus einen Plan.</p></div>
       </a>`;
  state.msg.welcome = false;
  return `
    <section class="hero">
      <div class="hero-top">
        <span class="hero-place">${ICON.pin}${esc(placeName())}</span>
        <a class="icon-btn light" href="#/einstellungen" aria-label="Einstellungen">${ICON.settings}</a>
      </div>
      <p class="hero-date">${today}</p>
      <h1>${greeting()},<br>${esc(owner())}!</h1>
      <div class="wx-row" id="wx">${'<div class="wx skeleton"></div>'.repeat(4)}</div>
    </section>
    <div class="page has-bottom-bar">
      ${welcome}${setup}
      <div id="hints"></div>
      ${backupHint}
      ${planCard}
      <div class="section-head">
        <h2>Mein Garten</h2>
        <span class="count">${plants.length} ${plants.length === 1 ? 'Pflanze' : 'Pflanzen'}</span>
      </div>
      ${plants.length > 6 ? '<input class="search" type="search" placeholder="Pflanze suchen …" data-input="filter">' : ''}
      ${plants.length
        ? `<div class="grid">${plants.map(plantCard).join('')}</div>`
        : `<div class="empty-state">
             <div class="empty-icon">🌱</div>
             <p><b>Noch keine Pflanzen gespeichert.</b></p>
             <p>Tippe unten auf „Pflanze fotografieren“ und fang mit deiner Lieblingspflanze an.</p>
           </div>`}
    </div>
    ${bottomBar('Pflanze fotografieren')}`;
}

function plantCard(p) {
  const last = p.entries[0];
  const search = esc(`${p.name} ${p.standort || ''}`.toLowerCase());
  return `
    <a class="plant-card" href="#/pflanze/${p.id}" data-name="${search}">
      ${last ? `<img src="${last.thumb}" alt="" loading="lazy">` : '<div class="noimg">🌿</div>'}
      <span class="badge">${healthDot(last?.analysis)}</span>
      <div class="pc-body">
        <b>${esc(p.name)}</b>
        <small>${[p.standort, p.kuebel ? '🪴 Kübel' : ''].filter(Boolean).map(esc).join(' · ')}</small>
      </div>
    </a>`;
}

async function loadWeather() {
  const wxBox = document.getElementById('wx');
  const hintBox = document.getElementById('hints');
  try {
    const [data, plants] = await Promise.all([wx.forecast(settings.location), db.getPlants()]);
    if (!document.body.contains(wxBox)) return;
    const d = data.daily;
    wxBox.innerHTML = [0, 1, 2, 3].map((i) => {
      const k = wx.kind(d.weather_code[i], d.wind_gusts_10m_max?.[i]);
      return `
      <div class="wx">
        <span class="wx-day">${i === 0 ? 'Heute' : wx.weekday(d.time[i], true)}</span>
        ${wx.iconSvg(k)}
        <span class="wx-label">${wx.iconLabel(k)}</span>
        <span class="wx-temp"><b>${Math.round(d.temperature_2m_max[i])}°</b> ${Math.round(d.temperature_2m_min[i])}°</span>
      </div>`;
    }).join('');
    const kuebel = plants.filter((p) => p.kuebel).map((p) => p.name).sort();
    const hints = wx.buildHints(data, kuebel).filter((h) => !settings.isDismissed(h.key));
    hintBox.innerHTML = hints.map((h) => `
      <div class="hint ${h.level}">
        <b>${esc(h.title)}</b>
        <p>${esc(h.text)}</p>
        <button class="btn small" data-action="dismiss" data-key="${esc(h.key)}">✓ Erledigt</button>
      </div>`).join('');
  } catch {
    if (wxBox) wxBox.innerHTML = '<p class="wx-off">Wetter gerade nicht verfügbar</p>';
  }
}

// ---------- Foto aufnehmen & analysieren ----------
export function startCapture(input, plantId) {
  if (!settings.apiKey) {
    location.hash = '#/einstellungen';
    return;
  }
  state.captureFor = plantId || null;
  input.value = '';
  input.click();
}

async function onPhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  let img;
  try {
    img = await prepareImage(file);
  } catch (err) {
    alert(err.message);
    return;
  }
  state.pending = { ...img, targetId: state.captureFor, itemId: state.captureItem, status: 'loading', analysis: null, error: null, chat: [] };
  state.captureFor = null;
  state.captureItem = null;
  state.chatError = null;
  if (route()[0] === 'analyse') render();
  else location.hash = '#/analyse';
  runAnalysis();
}
camInput.addEventListener('change', onPhoto);
galleryInput.addEventListener('change', onPhoto);

async function runAnalysis() {
  const p = state.pending;
  if (!p) return;
  p.status = 'loading';
  p.error = null;
  rerenderIf('analyse');
  try {
    const known = p.targetId ? await db.getPlant(p.targetId) : null;
    p.analysis = await ai.analyze(p.photo, known);
    p.status = 'done';
  } catch (e) {
    p.error = e.message;
    p.status = 'error';
  }
  if (state.pending === p) rerenderIf('analyse');
}

async function viewAnalyse() {
  const p = state.pending;
  if (!p) return `${appBar('Foto')}<div class="page"><p class="empty">Kein Foto ausgewählt.</p></div>`;
  const top = cover(`<img src="${p.photo}" alt="Dein Foto">`);
  if (p.status === 'loading') {
    return `${top}<div class="sheet"><div class="card loading"><div class="spinner"></div><p><b>Einen Moment …</b></p><p class="muted">Ich schaue mir die Pflanze genau an.</p></div></div>`;
  }
  if (p.status === 'error') {
    return `${top}<div class="sheet"><div class="card error"><p>${esc(p.error)}</p><button class="btn primary" data-action="retry">Nochmal versuchen</button></div></div>`;
  }
  const plants = (await db.getPlants()).sort(byName);
  const target = p.targetId && plants.find((x) => x.id === p.targetId);
  return `${top}<div class="sheet">`
    + analysisHtml(p.analysis, true)
    + (p.analysis.pflanze_erkannt ? chatHtml(p.chat, 'pending') : '')
    + saveHtml(p, plants, target)
    + '</div>';
}

function analysisHtml(a, withTitle) {
  if (!a) return '';
  if (!a.pflanze_erkannt) {
    return `
      <div class="card warn">
        <h2>Keine Pflanze erkannt 🤔</h2>
        ${a.zustand_text ? `<p>${esc(a.zustand_text)}</p>` : ''}
        <p>Tipp: Näher rangehen, bei Tageslicht und scharf fotografieren – am besten Blätter und Blüte.</p>
      </div>`;
  }
  const conf = { hoch: '✓ ziemlich sicher', mittel: 'wahrscheinlich', niedrig: 'unsicher' }[a.sicherheit] || '';
  const healthClass = { gesund: 'good', 'leichte Probleme': 'info', krank: 'warn' }[a.zustand] || 'info';
  const care = a.pflege || {};
  const sb = a.steckbrief;
  const healthy = a.zustand === 'gesund' && !(a.probleme || []).length;
  const row =(icon, label, text) => (text ? `<div class="row"><span class="ic">${icon}</span><div><b>${label}</b><p>${esc(text)}</p></div></div>` : '');
  return `
    ${withTitle ? `
    <div class="title-block">
      <h1>${esc(a.name)}</h1>
      ${a.botanisch ? `<p class="latin">${esc(a.botanisch)}</p>` : ''}
    </div>` : ''}
    <p class="chips">
      <span class="chip ${a.sicherheit === 'hoch' ? '' : 'soft'}">${conf}</span>
      ${a.stadium ? `<span class="chip">🌱 ${esc(a.stadium)}</span>` : ''}
    </p>
    ${a.sicherheit !== 'hoch' && a.alternativen?.length ? `<p class="muted small">Könnte auch sein: ${esc(a.alternativen.join(', '))}</p>` : ''}
    ${healthy
      ? `<div class="healthy">🟢 <div><b>Sieht gesund aus</b>${a.zustand_text ? `<span>${esc(a.zustand_text)}</span>` : ''}</div></div>`
      : `<div class="card health ${healthClass}">
      <h3>${healthDot(a)} ${a.zustand === 'krank' ? 'Hier stimmt etwas nicht' : 'Kleine Probleme entdeckt'}</h3>
      <p>${esc(a.zustand_text)}</p>
      ${(a.probleme || []).map((pr) => `
        <div class="problem">
          <b>${esc(pr.name)}</b>
          <p>${esc(pr.anzeichen)}</p>
          <p>🌿 <b>Bio:</b> ${esc(pr.bio)}</p>
          ${pr.sonst ? `<p>🧴 <b>Falls das nicht hilft:</b> ${esc(pr.sonst)}</p>` : ''}
        </div>`).join('')}
    </div>`}
    ${sb ? `
    <div class="card care profile">
      <h3>Steckbrief</h3>
      ${sb.kurz ? `<p class="profile-intro">${esc(sb.kurz)}</p>` : ''}
      ${row('🌸', 'Blütezeit', sb.bluetezeit)}
      ${row('🍎', 'Früchte / Ernte', sb.fruechte)}
      ${row('🌱', 'Aussaat / Pflanzung', sb.aussaat)}
      ${row('🪴', 'Ableger &amp; Vermehrung', sb.vermehrung)}
      ${row('📏', 'Wuchs', sb.wuchs)}
    </div>` : ''}
    ${a.jetzt_tun?.length ? `<div class="card todo"><h3>${healthy ? 'Passend zur Jahreszeit' : 'Jetzt zu tun'}</h3><ul class="checks">${a.jetzt_tun.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="card care">
      <h3>Pflege</h3>
      ${row('💧', 'Gießen', care.giessen)}
      ${row('☀️', 'Standort', care.standort)}
      ${row('🧪', 'Düngen', care.duengen)}
      ${row('✂️', 'Schneiden', care.schnitt)}
      ${row('❄️', 'Winter', care.winter)}
      ${a.frostempfindlich ? row('🥶', 'Frost', 'Frostempfindlich – im Winter schützen oder reinholen.') : ''}
      ${row('☠️', 'Giftig?', a.giftig)}
    </div>`;
}

function saveHtml(p, plants, target) {
  if (!p.analysis.pflanze_erkannt) {
    return `<button class="btn primary big" data-action="camera">${ICON.camera}<span>Neues Foto machen</span></button>`;
  }
  if (target) {
    return `<button class="btn primary big" data-action="save-to" data-id="${target.id}">Bei „${esc(target.name)}“ speichern</button>`;
  }
  const name = (p.analysis.name || '').toLowerCase();
  const options = plants.map((x) => `
    <option value="${x.id}" ${x.name.toLowerCase() === name ? 'selected' : ''}>${esc(x.name)}${x.standort ? ' – ' + esc(x.standort) : ''}</option>`).join('');
  return `
    <form class="card save" data-form="save-new">
      <h3>In „Mein Garten“ speichern</h3>
      <label>Name<input name="name" value="${esc(p.analysis.name)}" required></label>
      <label>Wo steht sie? <span class="muted small">(kurz in Worten)</span><input name="standort" placeholder="z. B. neben dem Stall"></label>
      <label class="check"><input type="checkbox" name="kuebel"> 🪴 Steht im Kübel / Topf</label>
      <button class="btn primary big" type="submit">Als neue Pflanze speichern</button>
      ${p.itemId ? '' : '<p class="muted small center">Danach kannst du sie im Gartenplan antippen.</p>'}
    </form>
    ${plants.length ? `
    <form class="card save" data-form="save-existing">
      <h3>… oder zu einer vorhandenen Pflanze</h3>
      <select name="id">${options}</select>
      <button class="btn secondary" type="submit">Foto dort hinzufügen</button>
    </form>` : ''}`;
}

async function saveEntry(plant, isNew) {
  const p = state.pending;
  if (!p || !plant) return;
  const photoId = uid();
  await db.putPhoto({ id: photoId, data: p.photo });
  plant.entries.unshift({ id: uid(), date: Date.now(), photoId, thumb: p.thumb, analysis: p.analysis, chat: p.chat });
  if (!plant.botanisch && p.analysis.botanisch) plant.botanisch = p.analysis.botanisch;
  await db.putPlant(plant);
  db.requestPersistence();
  state.pending = null;
  if (p.itemId) {
    await linkItem(p.itemId, plant);
  } else if (isNew && await startPlacing(plant)) {
    return; // weiter im Gartenplan: „Wo steht sie?“
  }
  location.hash = '#/pflanze/' + plant.id;
}

// ---------- Fragen zum Foto ----------
const QUICK = ['Was soll ich als Nächstes tun?', 'Wann schneide ich sie zurück?', 'Ist sie winterhart?'];

function chatHtml(chat, scope, plantId = '', entryId = '') {
  const key = scope + entryId;
  const busy = state.busyChat === key;
  const err = state.chatError?.key === key ? state.chatError : null;
  return `
    <form class="card chat" data-form="ask" data-scope="${scope}" data-plant="${plantId}" data-entry="${entryId}">
      <h3>Fragen zu diesem Foto</h3>
      ${chat.map((m) => (m.role === 'model'
        ? `<div class="msg model"><div class="msg-text">${md(m.text)}</div>${canSpeak ? `<button type="button" class="speak" data-action="speak">${ICON.speaker}<span>Vorlesen</span></button>` : ''}</div>`
        : `<div class="msg user">${esc(m.text)}</div>`)).join('')}
      ${busy ? '<div class="msg model"><div class="dots"><span></span><span></span><span></span></div></div>' : ''}
      ${err ? `<div class="msg error">${esc(err.text)}</div>` : ''}
      ${chat.length || busy ? '' : `<div class="quick">${QUICK.map((q) => `<button type="button" class="chip-btn" data-action="quick" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}
      <div class="ask-row">
        <textarea name="q" rows="1" placeholder="Eigene Frage …" ${busy ? 'disabled' : ''}>${err ? esc(err.q) : ''}</textarea>
        ${busy ? '' : micButton('q')}
        <button class="icon-btn send" type="submit" aria-label="Frage senden" ${busy ? 'disabled' : ''}>${ICON.send}</button>
      </div>
      ${SpeechRec && !chat.length && !busy ? '<p class="muted small mic-hint">Tipp: Aufs Mikrofon tippen und die Frage einfach sagen.</p>' : ''}
    </form>`;
}

// Spracheingabe: bei Fragen wird danach automatisch gesendet, bei Beschreibungen ergänzt
let recognition = null;
function startMic(btn) {
  if (recognition) { recognition.stop(); return; }
  const form = btn.closest('form');
  const field = form.elements[btn.dataset.field || 'q'];
  const isQuestion = form.dataset.form === 'ask';
  const before = isQuestion || !field.value.trim() ? '' : field.value.trim() + ' ';
  const placeholder = field.placeholder;
  const rec = new SpeechRec();
  rec.lang = 'de-DE';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let failed = false;
  rec.onresult = (ev) => {
    field.value = before + Array.from(ev.results).map((r) => r[0].transcript).join('');
  };
  rec.onerror = (ev) => {
    failed = true;
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      alert('Das Mikrofon ist nicht freigegeben. Bitte beim Nachfragen „Zulassen“ tippen.\n\n(Auf der Test-Adresse im WLAN geht die Spracheingabe nicht – erst nach dem Veröffentlichen.)');
    } else if (ev.error === 'no-speech') {
      field.placeholder = 'Nichts gehört – nochmal aufs Mikrofon tippen';
    }
  };
  rec.onend = () => {
    recognition = null;
    btn.classList.remove('listening');
    if (field.placeholder === 'Ich höre zu …') field.placeholder = placeholder;
    field.dispatchEvent(new Event('input', { bubbles: true })); // Text merken (z. B. Beschreibung)
    if (isQuestion && !failed && field.value.trim()) ask(form, field.value);
  };
  if (canSpeak) speechSynthesis.cancel();
  if (isQuestion) field.value = '';
  field.placeholder = 'Ich höre zu …';
  btn.classList.add('listening');
  recognition = rec;
  rec.start();
}

function speak(btn) {
  const wasActive = btn.classList.contains('active');
  speechSynthesis.cancel();
  document.querySelectorAll('.speak.active').forEach((b) => { b.classList.remove('active'); b.querySelector('span').textContent = 'Vorlesen'; });
  if (wasActive) return;
  const u = new SpeechSynthesisUtterance(btn.closest('.msg').querySelector('.msg-text').innerText);
  u.lang = 'de-DE';
  u.rate = 0.95;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
  if (voice) u.voice = voice;
  const reset = () => { btn.classList.remove('active'); btn.querySelector('span').textContent = 'Vorlesen'; };
  u.onend = reset;
  u.onerror = reset;
  btn.classList.add('active');
  btn.querySelector('span').textContent = 'Stopp';
  speechSynthesis.speak(u);
}

async function ask(form, question) {
  question = (question || '').trim();
  if (!question || state.busyChat) return;
  const { scope, plant: plantId, entry: entryId } = form.dataset;
  const key = scope + entryId;
  let chat, photo, analysis, plant;
  if (scope === 'pending') {
    ({ chat, photo, analysis } = state.pending);
  } else {
    plant = await db.getPlant(plantId);
    const entry = plant.entries.find((x) => x.id === entryId);
    entry.chat = entry.chat || [];
    chat = entry.chat;
    analysis = entry.analysis;
    photo = (await db.getPhoto(entry.photoId))?.data;
    state.openEntry = entryId;
  }
  const history = chat.slice();
  chat.push({ role: 'user', text: question });
  state.busyChat = key;
  state.chatError = null;
  if (plant) await db.putPlant(plant);
  await render();
  try {
    if (!photo) throw new Error('Das Foto ist nicht mehr vorhanden.');
    chat.push({ role: 'model', text: await ai.ask(photo, analysis, history, question) });
  } catch (e) {
    chat.pop();
    state.chatError = { key, text: e.message, q: question };
  }
  state.busyChat = null;
  if (plant) await db.putPlant(plant);
  await render();
}

// ---------- Pflanzen-Seite ----------
async function viewPlant(id) {
  const p = await db.getPlant(id);
  if (!p) return `${appBar('Pflanze')}<div class="page"><p class="empty">Pflanze nicht gefunden.</p></div>`;
  const last = p.entries[0];
  const { plan, item } = await itemForPlant(p.id);
  const planChip = item
    ? `<a class="chip link" href="#/plan" data-action="goto-item" data-id="${item.id}">🗺️ Im Plan zeigen</a>`
    : plan ? `<button class="chip link" data-action="plant-place" data-id="${p.id}">🗺️ Im Plan eintragen</button>` : '';
  const info = [
    planChip,
    p.standort ? `<span class="chip">📍 ${esc(p.standort)}</span>` : '',
    p.kuebel ? '<span class="chip">🪴 Kübelpflanze</span>' : '',
  ].filter(Boolean);
  return `
    ${last ? cover(`<img data-photo="${last.photoId}" alt="">`) : appBar(p.name)}
    <div class="sheet has-bottom-bar">
      <div class="title-block">
        <h1 id="plant-title">${esc(p.name)}</h1>
        ${p.botanisch ? `<p class="latin">${esc(p.botanisch)}</p>` : ''}
        ${info.length ? `<p class="chips">${info.join('')}</p>` : ''}
      </div>
      <details class="card edit">
        <summary>✏️ Angaben ändern</summary>
        <form data-form="edit-plant" data-id="${p.id}">
          <label>Name<input name="name" value="${esc(p.name)}"></label>
          <label>Wo steht sie?<input name="standort" value="${esc(p.standort || '')}" placeholder="z. B. neben dem Stall"></label>
          <label class="check"><input type="checkbox" name="kuebel" ${p.kuebel ? 'checked' : ''}> 🪴 Steht im Kübel / Topf (für Frost-Hinweise)</label>
          <p class="saved" hidden>✓ Gespeichert</p>
        </form>
      </details>
      <div class="section-head">
        <h2>Verlauf</h2>
        <span class="count">${p.entries.length} ${p.entries.length === 1 ? 'Foto' : 'Fotos'}</span>
      </div>
      ${p.entries.map((e, i) => entryHtml(p, e, i)).join('') || '<p class="empty">Noch keine Fotos.</p>'}
      <div class="danger-zone">
        <button class="btn danger" data-action="delete-plant" data-id="${p.id}">Pflanze löschen</button>
      </div>
    </div>
    ${bottomBar('Neues Foto', p.id)}`;
}

function entryHtml(p, e, i) {
  const open = state.openEntry ? state.openEntry === e.id : i === 0;
  const a = e.analysis || {};
  return `
    <details class="card entry" ${open ? 'open' : ''}>
      <summary>
        <img src="${e.thumb}" alt="">
        <div><b>${i === 0 ? 'Neuestes Foto' : fmtDate(e.date)}</b><span>${i === 0 ? fmtDate(e.date) + ' · ' : ''}${healthDot(a)} ${esc(a.zustand || '')}</span></div>
      </summary>
      ${i === 0 ? '' : `<img class="photo" data-photo="${e.photoId}" alt="">`}
      ${analysisHtml(a, false)}
      ${chatHtml(e.chat || [], 'entry', p.id, e.id)}
      <button class="btn danger small" data-action="delete-entry" data-plant="${p.id}" data-entry="${e.id}">Dieses Foto löschen</button>
    </details>`;
}

// ---------- Einstellungen ----------
function viewSettings() {
  const loc = settings.location;
  const m = state.msg;
  return `
    ${appBar('Einstellungen')}
    <div class="page">
      <div class="card">
        <h3>👤 Dein Name</h3>
        <form data-form="edit-name" class="inline">
          <input name="name" value="${esc(owner())}" placeholder="Dein Vorname">
          <button class="btn secondary" type="submit">Speichern</button>
        </form>
        ${m.name ? `<p class="status">${esc(m.name)}</p>` : ''}
      </div>

      <form class="card" data-form="key">
        <h3>🔑 Gemini-Schlüssel</h3>
        <p class="muted small">Wird nur auf diesem Gerät gespeichert – nie im Code und nie auf GitHub.</p>
        <input name="key" type="password" autocomplete="off" value="${esc(settings.apiKey)}" placeholder="Schlüssel einfügen">
        <button class="btn primary" type="submit">Speichern &amp; testen</button>
        ${m.key ? `<p class="status">${esc(m.key)}</p>` : ''}
        ${settings.model ? `<p class="muted small">Verwendetes Modell: ${esc(settings.model)}</p>` : ''}
        <details>
          <summary>So bekommst du den kostenlosen Schlüssel</summary>
          <ol>
            <li>Öffne <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> und melde dich mit einem Google-Konto an.</li>
            <li>Tippe auf „API-Schlüssel erstellen“.</li>
            <li>Kopiere den Schlüssel und füge ihn hier ein.</li>
          </ol>
        </details>
        ${settings.apiKey ? `
        <details>
          <summary>Einrichtungs-Link für ein anderes Handy</summary>
          <p class="small">Ein persönlicher Link, der den Schlüssel auf einem anderen Handy einträgt. Nur privat verschicken (z. B. per WhatsApp) – wer den Link hat, kann deinen Schlüssel benutzen.</p>
          <button class="btn secondary wide" type="button" data-action="setup-share">${ICON.share}<span>Einrichtungs-Link teilen</span></button>
        </details>` : ''}
      </form>

      <div class="card">
        <h3>📍 Garten-Standort</h3>
        <p>Wetter und Frost-Hinweise für <b>${esc(loc.name)}</b>${loc.label ? `<br><span class="muted small">${esc(loc.label)}</span>` : ''}</p>
        ${m.place ? `<p class="status">${esc(m.place)}</p>` : ''}
        <details ${state.placeResults.length ? 'open' : ''}>
          <summary>Anderen Ort wählen</summary>
          <button class="btn secondary wide" data-action="gps">Aktuellen Standort verwenden</button>
          <form data-form="place" class="inline">
            <input name="q" placeholder="Ort oder Adresse">
            <button class="btn secondary" type="submit">Suchen</button>
          </form>
          ${state.placeResults.map((r, i) => `<button class="btn list" data-action="pick-place" data-i="${i}"><span><b>${esc(r.name)}</b><br><span class="muted small">${esc(r.label || '')}</span></span></button>`).join('')}
        </details>
      </div>

      <div class="card">
        <h3>💾 Sicherung &amp; Export</h3>
        <p class="muted small">Alle Pflanzen, Fotos und der Gartenplan liegen nur auf diesem Handy. Schick ab und zu eine Sicherung per E-Mail – im Teilen-Menü einfach „Gmail“ wählen.</p>
        ${settings.lastBackup ? `<p class="small">Letzte Sicherung: <b>${fmtDate(settings.lastBackup)}</b></p>` : '<p class="small">Noch keine Sicherung gemacht.</p>'}
        <button class="btn primary wide" data-action="backup-share">${ICON.share}<span>Per E-Mail verschicken</span></button>
        <button class="btn secondary wide" data-action="backup-download">Als Datei speichern</button>
        <button class="btn secondary wide" data-action="restore">Sicherung einspielen</button>
        ${m.backup ? `<p class="status">${esc(m.backup)}</p>` : ''}
      </div>
    </div>`;
}

// ---------- Sicherung ----------
async function backupFile() {
  const data = {
    app: 'gartenapp',
    version: 2,
    date: new Date().toISOString(),
    plants: await db.getPlants(),
    photos: await db.getPhotos(),
    meta: await db.getAllMeta(),
  };
  const name = `garten-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  return new File([JSON.stringify(data)], name, { type: 'application/json' });
}

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function shareBackup() {
  const file = await backupFile();
  const mb = (file.size / 1048576).toFixed(1).replace('.', ',');
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `${gardenTitle(owner())} – Sicherung`,
        text: `Sicherung der Garten-App (${gardenTitle(owner())}) vom ${fmtDate(Date.now())} (${mb} MB).`,
      });
      settings.lastBackup = Date.now();
      state.msg.backup = '✅ Sicherung verschickt.';
    } catch (e) {
      if (e.name !== 'AbortError') state.msg.backup = '❌ Teilen hat nicht geklappt. Versuch „Als Datei speichern“.';
    }
  } else {
    download(file);
    settings.lastBackup = Date.now();
    state.msg.backup = `✅ Datei gespeichert (${mb} MB). Du findest sie im Ordner „Downloads“.`;
  }
  render();
}

async function shareSetupLink() {
  const who = (prompt('Für wen ist der Link? (Vorname, wird beim Öffnen schon eingetragen)', '') || '').trim();
  const url = `${APP_URL}#setup=${encodeURIComponent(settings.apiKey)}${who ? `&name=${encodeURIComponent(who)}` : ''}`;
  const text = `Hallo${who ? ` ${who}` : ''}! Tippe auf diesen Link, dann ist deine Garten-App eingerichtet:\n${url}`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Garten-App', text }); } catch { /* abgebrochen */ }
  } else {
    try { await navigator.clipboard.writeText(url); alert('Link kopiert.'); } catch { prompt('Link kopieren:', url); }
  }
}

restoreInput.addEventListener('change', async () => {
  const file = restoreInput.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'gartenapp') throw new Error('Das ist keine Sicherung dieser App.');
    for (const ph of data.photos || []) await db.putPhoto(ph);
    for (const pl of data.plants || []) await db.putPlant(pl);
    for (const mt of data.meta || []) await db.putMeta(mt);
    state.msg.backup = `✅ ${data.plants.length} Pflanzen${(data.meta || []).length ? ' und der Gartenplan' : ''} eingespielt.`;
  } catch (e) {
    state.msg.backup = '❌ ' + e.message;
  }
  render();
});

// ---------- Klicks, Formulare, Eingaben ----------
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (await handlePlanClick(e, el, d)) return;
  switch (d.action) {
    case 'camera': startCapture(camInput, d.plant); break;
    case 'gallery': startCapture(galleryInput, d.plant); break;
    case 'item-photo': state.captureItem = d.id; startCapture(camInput); break;
    case 'retry': runAnalysis(); break;
    case 'save-to': await saveEntry(await db.getPlant(d.id), false); break;
    case 'quick': ask(el.closest('form'), d.q); break;
    case 'mic': startMic(el); break;
    case 'speak': speak(el); break;
    case 'dismiss':
      settings.dismiss(d.key);
      el.closest('.hint').remove();
      break;
    case 'backup-share': shareBackup(); break;
    case 'backup-download': {
      download(await backupFile());
      settings.lastBackup = Date.now();
      state.msg.backup = '✅ Datei gespeichert. Du findest sie im Ordner „Downloads“.';
      render();
      break;
    }
    case 'backup-snooze':
      settings.backupSnooze = Date.now() + 3 * 864e5;
      el.closest('.hint').remove();
      break;
    case 'setup-share': shareSetupLink(); break;
    case 'delete-plant': {
      if (!confirm('Diese Pflanze mit allen Fotos wirklich löschen?')) break;
      const p = await db.getPlant(d.id);
      for (const en of p.entries) await db.deletePhoto(en.photoId);
      await db.deletePlant(p.id);
      await unlinkPlant(p.id);
      location.hash = '#/';
      break;
    }
    case 'delete-entry': {
      if (!confirm('Dieses Foto wirklich löschen?')) break;
      const p = await db.getPlant(d.plant);
      const en = p.entries.find((x) => x.id === d.entry);
      p.entries = p.entries.filter((x) => x.id !== d.entry);
      await db.deletePhoto(en.photoId);
      await db.putPlant(p);
      state.openEntry = null;
      render();
      break;
    }
    case 'gps':
      if (!navigator.geolocation) { state.msg.place = '❌ Standort wird nicht unterstützt.'; render(); break; }
      state.msg.place = '⏳ Standort wird ermittelt …';
      render();
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          settings.location = await wx.placeFromGps(pos.coords.latitude, pos.coords.longitude);
          state.msg.place = '✅ Standort gespeichert.';
          render();
        },
        () => { state.msg.place = '❌ Standort konnte nicht ermittelt werden. Bitte den Ort eintippen.'; render(); },
        { timeout: 15000 },
      );
      break;
    case 'pick-place':
      settings.location = state.placeResults[+d.i];
      state.placeResults = [];
      state.msg.place = '✅ Ort gespeichert.';
      render();
      break;
    // Ersteinrichtung
    case 'onb-pick':
      state.onb.loc = state.onb.results[+d.i];
      state.onb.results = [];
      state.onb.msg = '';
      render();
      break;
    case 'onb-change':
      state.onb.loc = null;
      render();
      break;
    case 'onb-gps':
      if (!navigator.geolocation) { state.onb.msg = 'Standort wird hier nicht unterstützt – bitte Ort eintippen.'; render(); break; }
      state.onb.msg = '⏳ Standort wird ermittelt …';
      render();
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          state.onb.loc = await wx.placeFromGps(pos.coords.latitude, pos.coords.longitude);
          state.onb.msg = '';
          render();
        },
        () => { state.onb.msg = 'Standort konnte nicht ermittelt werden. Bitte den Ort oder die Adresse eintippen.'; render(); },
        { timeout: 15000 },
      );
      break;
    case 'onb-done': {
      const o = state.onb;
      if (!o.name.trim() || !o.loc) break;
      settings.name = o.name.trim().slice(0, 30);
      settings.location = o.loc;
      state.onb = { name: '', results: [], loc: null, msg: '' };
      location.hash = '#/';
      render();
      break;
    }
    case 'restore': restoreInput.value = ''; restoreInput.click(); break;
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  if (await handlePlanSubmit(f, fd)) return;
  switch (f.dataset.form) {
    case 'ask': ask(f, fd.get('q')); break;
    case 'onb-search': {
      const q = fd.get('q').trim();
      if (!q) break;
      state.onb.msg = '⏳ Suche …';
      render();
      try {
        state.onb.results = await wx.searchPlace(q);
        state.onb.msg = state.onb.results.length ? 'Bitte das Richtige antippen:' : 'Nichts gefunden. Versuch es nur mit dem Ort.';
      } catch {
        state.onb.msg = 'Suche fehlgeschlagen – Internet prüfen.';
      }
      render();
      break;
    }
    case 'edit-name': {
      const name = fd.get('name').trim().slice(0, 30);
      if (!name) break;
      settings.name = name;
      state.msg.name = '✅ Gespeichert.';
      render();
      break;
    }
    case 'save-new': {
      const a = state.pending.analysis;
      await saveEntry({
        id: uid(),
        name: fd.get('name').trim() || a.name,
        botanisch: a.botanisch || '',
        standort: fd.get('standort').trim(),
        kuebel: fd.get('kuebel') === 'on',
        created: Date.now(),
        entries: [],
      }, true);
      break;
    }
    case 'save-existing': await saveEntry(await db.getPlant(fd.get('id')), false); break;
    case 'key': {
      const key = fd.get('key').trim();
      settings.apiKey = key;
      settings.model = '';
      if (!key) { state.msg.key = 'Schlüssel entfernt.'; render(); break; }
      state.msg.key = '⏳ Wird getestet …';
      render();
      try {
        await ai.pickModel(key);
        state.msg.key = '✅ Funktioniert! Du kannst jetzt Pflanzen fotografieren.';
      } catch (err) {
        state.msg.key = '❌ ' + err.message;
      }
      render();
      break;
    }
    case 'place': {
      const q = fd.get('q').trim();
      if (!q) break;
      try {
        state.placeResults = await wx.searchPlace(q);
        state.msg.place = state.placeResults.length ? 'Bitte den richtigen Ort antippen:' : '❌ Kein Ort gefunden.';
      } catch {
        state.msg.place = '❌ Suche fehlgeschlagen. Internet prüfen.';
      }
      render();
      break;
    }
  }
});

// Angaben speichern sich beim Ändern von selbst
document.addEventListener('change', async (e) => {
  if (await handlePlanChange(e)) return;
  const f = e.target.closest('form[data-form="edit-plant"]');
  if (!f) return;
  const p = await db.getPlant(f.dataset.id);
  const fd = new FormData(f);
  p.name = fd.get('name').trim() || p.name;
  p.standort = fd.get('standort').trim();
  p.kuebel = fd.get('kuebel') === 'on';
  await db.putPlant(p);
  document.getElementById('plant-title').textContent = p.name;
  const saved = f.querySelector('.saved');
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 1500);
});

document.addEventListener('input', (e) => {
  if (handlePlanInput(e)) return;
  if (e.target.dataset.input === 'onb-name') {
    state.onb.name = e.target.value;
    const btn = document.querySelector('[data-action="onb-done"]');
    if (btn) btn.disabled = !(state.onb.name.trim() && state.onb.loc);
    return;
  }
  if (e.target.dataset.input !== 'filter') return;
  const q = e.target.value.toLowerCase();
  document.querySelectorAll('.plant-card').forEach((c) => { c.hidden = !c.dataset.name.includes(q); });
});

// ---------- Start ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
