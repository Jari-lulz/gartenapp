// Gartenplan-Seiten: geführter Rundgang, Plan-Ansicht, Verschieben, Messen, Pflanzen verorten.
import * as db from './db.js';
import * as ai from './gemini.js';
import { prepareImage } from './image.js';
import { esc, uid, clamp } from './util.js';
import { ICON, appBar, healthDot, micButton } from './ui.js';
import {
  AREA_TYPES, ITEM_ARTS, mapSvg, mergePlan, normalizePlan, setSize, setAreaMeters, meters, matchItems,
} from './plan.js';
import { state, render, rerenderIf } from './app.js';

const planCamInput = document.getElementById('planCam');
const planGalleryInput = document.getElementById('planGallery');
export const MAX_WALK_PHOTOS = 40;

export const WALK_STEPS = [
  { icon: '📐', title: 'Überblick von den Ecken', text: 'Stell dich nacheinander in jede Ecke des Grundstücks und fotografiere quer über den ganzen Garten.', tip: 'Am besten 4 Fotos – eins pro Ecke. Handy dabei quer halten.' },
  { icon: '🏠', title: 'Gebäude und Stallungen', text: 'Fotografiere jedes Gebäude von außen: Wohnhaus, Stallungen, Schuppen, Gewächshaus.', tip: 'Mit etwas Abstand, damit man sieht, was daneben steht.' },
  { icon: '🚶', title: 'Wege', text: 'Geh die Wege entlang und mach alle paar Meter ein Foto in Laufrichtung.', tip: 'Auch Trampelpfade zählen.' },
  { icon: '🌳', title: 'Bäume und Sträucher', text: 'Fotografiere jeden größeren Baum und Strauch – gern mit etwas Umgebung.', tip: 'Obstbäume, Hecken, Flieder, Holunder …' },
  { icon: '🌼', title: 'Pflanzen', text: 'Fotografiere die Stellen mit vielen Pflanzen. Lieber mehrere Fotos aus der Nähe als eins von weit weg.', tip: 'Stauden, Rosen, Kräuter, Gemüse – alles, was dir wichtig ist.' },
  { icon: '🗣️', title: 'Beschreibung', text: 'Erzähl kurz, wie alles liegt. Tipp aufs Mikrofon und sprich einfach.', tip: 'z. B. „Das Haus steht im Norden, der Stall rechts daneben, hinten ist die Obstwiese mit den Apfelbäumen.“' },
];

export async function loadPlan() {
  return normalizePlan(await db.getMeta('plan'));
}
async function savePlan(plan) {
  plan.updated = Date.now();
  await db.putMeta(plan);
}

const newWalk = (update) => ({ step: 0, photos: [], desc: '', status: 'idle', error: null, update });
const num = (v) => parseFloat(String(v || '').replace(',', '.'));
const fmtNum = (n) => (n == null ? '' : String(n).replace('.', ','));

function nearestAreaName(plan, x, y) {
  const inside = plan.areas.filter((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h)
    .sort((a, b) => a.w * a.h - b.w * b.h);
  if (inside.length) return inside[0].name;
  let best = null;
  let dist = Infinity;
  for (const a of plan.areas) {
    const d = Math.hypot(a.x + a.w / 2 - x, a.y + a.h / 2 - y);
    if (d < dist) { dist = d; best = a; }
  }
  return best ? `nahe ${best.name}` : '';
}

// ---------- Geführter Rundgang ----------
export function viewWalk() {
  const w = (state.walk ||= newWalk(false));
  const title = w.update ? 'Plan ergänzen' : 'Rundgang';
  if (w.status === 'loading') {
    return `${appBar(title, '#/plan')}
      <div class="page"><div class="card loading">
        <div class="spinner"></div>
        <p><b>Ich zeichne deinen Garten …</b></p>
        <p class="muted">${w.photos.length} Fotos werden ausgewertet. Das kann ein bis zwei Minuten dauern – bitte die App so lange offen lassen.</p>
      </div></div>`;
  }
  const step = WALK_STEPS[w.step];
  const last = w.step === WALK_STEPS.length - 1;
  const stepPhotos = w.photos.map((p, i) => ({ ...p, i })).filter((p) => p.step === step.title);
  const enough = w.photos.length >= 3;
  return `${appBar(title, '#/plan')}
    <div class="page has-bottom-bar">
      <div class="steps">${WALK_STEPS.map((s, i) => `<span class="${i < w.step ? 'done' : i === w.step ? 'now' : ''}"></span>`).join('')}</div>
      <p class="step-count">Schritt ${w.step + 1} von ${WALK_STEPS.length} · ${w.photos.length} ${w.photos.length === 1 ? 'Foto' : 'Fotos'} insgesamt</p>
      <div class="card step-card">
        <div class="step-icon">${step.icon}</div>
        <h2>${step.title}</h2>
        <p>${step.text}</p>
        <p class="muted small">💡 ${step.tip}</p>
      </div>
      ${w.error ? `<div class="card error"><p>${esc(w.error)}</p></div>` : ''}
      ${last ? `
        <form class="card desc" data-form="walk-desc">
          <div class="ask-row">
            <textarea name="desc" rows="4" data-input="walk-desc" placeholder="Wie liegt alles? (freiwillig)">${esc(w.desc)}</textarea>
            ${micButton('desc')}
          </div>
        </form>
        <button class="btn primary big" data-action="walk-create" ${enough ? '' : 'disabled'}>🗺️ ${w.update ? 'Plan ergänzen' : 'Gartenplan zeichnen'}</button>
        ${enough ? '' : '<p class="muted small center">Dafür sind mindestens 3 Fotos nötig. Geh zurück und mach noch ein paar.</p>'}`
      : `
        ${stepPhotos.length
          ? `<div class="thumbs">${stepPhotos.map((p) => `
              <div class="thumb"><img src="${p.thumb}" alt=""><button class="x" data-action="walk-remove" data-i="${p.i}" aria-label="Foto entfernen">×</button></div>`).join('')}</div>`
          : '<p class="muted">Noch keine Fotos in diesem Schritt.</p>'}
        <button class="btn secondary wide" data-action="walk-gallery">${ICON.image}<span>Fotos aus der Galerie</span></button>`}
      <div class="step-nav">
        ${w.step > 0 ? '<button class="btn secondary" data-action="walk-prev">← Zurück</button>' : '<span></span>'}
        ${last ? '' : `<button class="btn primary" data-action="walk-next">${stepPhotos.length ? 'Weiter →' : 'Überspringen →'}</button>`}
      </div>
    </div>
    ${last ? '' : `
    <div class="bottom-bar">
      <button class="btn primary big" data-action="walk-camera">${ICON.camera}<span>Foto machen</span></button>
    </div>`}`;
}

async function onWalkPhotos(e) {
  const w = (state.walk ||= newWalk(false));
  const step = WALK_STEPS[w.step].title;
  w.error = null;
  for (const file of Array.from(e.target.files)) {
    if (w.photos.length >= MAX_WALK_PHOTOS) {
      w.error = `Mehr als ${MAX_WALK_PHOTOS} Fotos gehen nicht auf einmal.`;
      break;
    }
    try {
      w.photos.push({ ...(await prepareImage(file, { max: 1024, quality: 0.72 })), step });
    } catch { /* unlesbares Foto überspringen */ }
  }
  rerenderIf('plan');
}
planCamInput.addEventListener('change', onWalkPhotos);
planGalleryInput.addEventListener('change', onWalkPhotos);

async function createFromWalk() {
  const w = state.walk;
  if (!w || w.photos.length < 3) return;
  w.status = 'loading';
  w.error = null;
  rerenderIf('plan');
  try {
    const old = w.update ? await loadPlan() : null;
    const res = await ai.planGarden(w.photos.map((p) => ({ photo: p.photo, step: p.step })), w.desc.trim(), old);
    const plan = mergePlan(old, res);
    if (!plan.areas.length && !plan.items.length) throw new Error('Aus den Fotos konnte ich keinen Plan zeichnen. Versuch es mit mehr Fotos aus verschiedenen Richtungen.');
    // Gespeicherte Pflanzen mit passenden Punkten verbinden (Lage bleibt „vermutet“, bis es bestätigt wird)
    const linked = new Set(plan.items.map((i) => i.plantId).filter(Boolean));
    for (const p of await db.getPlants()) {
      if (linked.has(p.id)) continue;
      const m = matchItems(plan, p.name)[0];
      if (m) { m.plantId = p.id; linked.add(p.id); }
    }
    await savePlan(plan);
    state.walk = null;
    state.sel = null;
    location.hash = '#/plan';
  } catch (e) {
    w.status = 'idle';
    w.error = e.message;
    rerenderIf('plan');
  }
}

// ---------- Plan-Ansicht ----------
const planMap = () => mapSvg(state.plan, state.planPlants, {
  selected: state.sel,
  mode: state.planMode,
  labels: state.labels,
  measure: state.measure,
  highlight: state.placing?.suggestions || [],
});

function redraw(withPanel = false) {
  const map = document.getElementById('map');
  if (map) map.innerHTML = planMap();
  if (withPanel) {
    const panel = document.getElementById('panel');
    if (panel) panel.innerHTML = panelHtml();
  }
}

export async function viewPlan() {
  const plan = await loadPlan();
  state.plan = plan;
  if (!plan) {
    return `${appBar('Gartenplan')}
      <div class="page"><div class="empty-state">
        <div class="empty-icon">🗺️</div>
        <p><b>Noch kein Gartenplan.</b></p>
        <p>Ich führe dich Schritt für Schritt durch den Garten. Aus deinen Fotos zeichne ich dann einen Plan mit Gebäuden, Wegen, Bäumen und Pflanzen.</p>
        <button class="btn primary" data-action="walk-start" data-mode="new">Rundgang starten</button>
      </div></div>`;
  }
  state.planPlants = await db.getPlants();
  const exists = (s) => s && ({ area: plan.areas, item: plan.items, weg: plan.wege }[s.kind] || []).some((x) => x.id === s.id);
  if (!exists(state.sel)) state.sel = null;
  const mode = state.planMode;
  const tools = {
    view: `<button class="btn secondary" data-action="plan-mode" data-mode="edit">Verschieben</button>
           <button class="btn secondary" data-action="plan-mode" data-mode="measure">Messen</button>
           <button class="btn secondary ${state.labels ? 'on' : ''}" data-action="labels">Namen</button>`,
    edit: `<button class="btn primary" data-action="plan-mode" data-mode="view">✓ Fertig</button>
           <button class="btn secondary" data-action="add" data-what="area">+ Fläche</button>
           <button class="btn secondary" data-action="add" data-what="baum">+ Baum</button>
           <button class="btn secondary" data-action="add" data-what="pflanze">+ Pflanze</button>`,
    measure: '<button class="btn primary" data-action="plan-mode" data-mode="view">✓ Fertig</button>',
    place: '',
  }[mode];
  return `${appBar('Gartenplan')}
    <div class="page">
      ${banner()}
      <div class="card map-card" id="map">${planMap()}</div>
      ${tools ? `<div class="map-tools">${tools}</div>` : ''}
      <div id="panel">${panelHtml()}</div>
      ${mode === 'view' ? `
      <form class="card" data-form="plan-size">
        <h3>📏 Gartengröße</h3>
        <p class="muted small">Miss mit Maßband oder Zollstock die Außenkanten ab. Breite = im Plan von links nach rechts, Tiefe = von oben nach unten. Danach kannst du auch Gebäude und Beete in Metern eintragen.</p>
        <div class="two">
          <label>Breite (m)<input name="w" inputmode="decimal" value="${fmtNum(plan.size?.w)}" placeholder="z. B. 45"></label>
          <label>Tiefe (m)<input name="h" inputmode="decimal" value="${fmtNum(plan.size?.h)}" placeholder="z. B. 30"></label>
        </div>
        <button class="btn secondary wide" type="submit">Übernehmen</button>
      </form>
      ${plan.beschreibung ? `
      <div class="card">
        <h3>Über deinen Garten</h3>
        <p>${esc(plan.beschreibung)}</p>
        ${plan.hinweis ? `<p class="muted small">${esc(plan.hinweis)}</p>` : ''}
      </div>` : ''}
      <div class="card">
        <h3>Plan verbessern</h3>
        <p class="muted small">Neue Ecke fotografiert, etwas gepflanzt oder gefällt? Mach einen kurzen Rundgang – ich ergänze den Plan. Was du selbst verschoben, bestätigt oder vermessen hast, bleibt so.</p>
        <button class="btn primary wide" data-action="walk-start" data-mode="update">📷 Plan mit neuen Fotos ergänzen</button>
        <button class="btn danger small wide" data-action="walk-start" data-mode="new">Komplett neu zeichnen</button>
      </div>` : ''}
    </div>`;
}

function banner() {
  const mode = state.planMode;
  if (mode === 'place' && state.placing) {
    const p = state.placing;
    const sugg = p.suggestions.map((id) => state.plan.items.find((i) => i.id === id)).filter(Boolean);
    return `<div class="banner place">
      <b>Wo steht „${esc(p.name)}“?</b>
      <p>Tippe im Plan auf die Stelle.</p>
      ${sugg.length ? `<p class="small">Oder ist es ${sugg.length === 1 ? 'dieser blinkende Punkt' : 'einer dieser blinkenden Punkte'}?</p>
        ${sugg.map((i) => `<button class="btn list" data-action="place-pick" data-id="${i.id}">✓ ${esc(i.name)} <span class="muted small">· ${esc(nearestAreaName(state.plan, i.x, i.y))}</span></button>`).join('')}` : ''}
      <button class="btn small" data-action="place-skip">Später</button>
    </div>`;
  }
  if (mode === 'edit') return '<p class="edit-hint">Flächen, Bäume und Pflanzen mit dem Finger verschieben. Am weißen Punkt ziehen ändert die Größe einer Fläche.</p>';
  if (mode === 'measure') {
    return state.plan.size
      ? '<p class="edit-hint">Tippe zwei Stellen im Plan an – ich zeige dir den Abstand in Metern.</p>'
      : '<p class="edit-hint">Zum Messen bitte zuerst unten die Gartengröße eintragen.</p>';
  }
  return '';
}

function panelHtml() {
  const s = state.sel;
  const plan = state.plan;
  if (!s) {
    return `<div class="legend">
      <span><i class="dot tree"></i> Baum</span>
      <span><i class="dot ok"></i> Pflanze (bestätigt)</span>
      <span><i class="dot guess"></i> vermutet</span>
    </div>
    <p class="muted center small">Tippe auf etwas im Plan, um es anzusehen.</p>`;
  }
  if (s.kind === 'area') return areaPanel(plan.areas.find((a) => a.id === s.id));
  if (s.kind === 'item') return itemPanel(plan.items.find((i) => i.id === s.id));
  if (s.kind === 'weg') return wegPanel(plan.wege.find((w) => w.id === s.id));
  return '';
}

function areaPanel(a) {
  if (!a) return '';
  const plan = state.plan;
  const t = AREA_TYPES[a.typ] || AREA_TYPES.sonstiges;
  const inside = plan.items.filter((i) => i.x >= a.x && i.x <= a.x + a.w && i.y >= a.y && i.y <= a.y + a.h);
  const options = Object.entries(AREA_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.typ ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  return `
    <div class="card panel">
      <div class="area-head">
        <span class="area-icon" style="background:${t.fill}">${t.icon}</span>
        <div><h3 id="sel-title">${esc(a.name)}</h3><p class="muted small">${t.label}${plan.size ? ` · ${a.m ? '' : 'ca. '}${meters(plan, a.w)} × ${meters(plan, a.h)}` : ''}</p></div>
      </div>
      ${a.notiz ? `<p>${esc(a.notiz)}</p>` : ''}
      ${inside.length ? `<p class="small"><b>Hier:</b> ${inside.map((i) => esc(i.name)).join(', ')}</p>` : ''}
      ${a.pflanzen?.length ? `<p class="muted small">Auf den Fotos erkannt: ${esc(a.pflanzen.join(', '))}</p>` : ''}
      ${plan.size ? `
        <form class="measure-form" data-form="area-m" data-id="${a.id}">
          <p><b>📏 Echte Maße</b> <span class="muted small">${a.m ? '(vermessen ✓)' : '(abmessen und eintragen)'}</span></p>
          <div class="two">
            <label>Breite (m)<input name="w" inputmode="decimal" value="${fmtNum(a.m?.w)}"></label>
            <label>Tiefe (m)<input name="h" inputmode="decimal" value="${fmtNum(a.m?.h)}"></label>
          </div>
          <button class="btn secondary wide" type="submit">Maße übernehmen</button>
        </form>`
      : '<p class="muted small">📏 Trag unten erst die Gartengröße ein – dann kannst du hier die echten Maße angeben.</p>'}
      <details>
        <summary>✏️ Fläche ändern</summary>
        <form data-form="edit-area" data-id="${a.id}">
          <label>Name<input name="name" value="${esc(a.name)}"></label>
          <label>Art<select name="typ">${options}</select></label>
          <label>Notiz<input name="notiz" value="${esc(a.notiz || '')}" placeholder="z. B. Halbschatten, sehr nass"></label>
          <p class="saved" hidden>✓ Gespeichert</p>
        </form>
        <button class="btn danger small" data-action="delete-el" data-kind="area" data-id="${a.id}">Fläche löschen</button>
      </details>
    </div>`;
}

function itemPanel(i) {
  if (!i) return '';
  const plan = state.plan;
  const art = ITEM_ARTS[i.art] || ITEM_ARTS.pflanze;
  const p = i.plantId ? state.planPlants.find((x) => x.id === i.plantId) : null;
  const confirmed = i.status === 'bestaetigt';
  const options = Object.entries(ITEM_ARTS).map(([k, v]) => `<option value="${k}" ${k === i.art ? 'selected' : ''}>${v.icon} ${v.label}</option>`).join('');
  return `
    <div class="card panel">
      <div class="area-head">
        <span class="area-icon" style="background:var(--leaf)">${art.icon}</span>
        <div><h3 id="sel-title">${esc(i.name)}</h3><p class="muted small">${art.label} · ${esc(nearestAreaName(plan, i.x, i.y))}</p></div>
      </div>
      <p class="chips"><span class="chip ${confirmed ? '' : 'soft'}">${confirmed ? '✓ Lage bestätigt' : 'Lage vermutet'}</span></p>
      ${p ? `
        <a class="mini big" href="#/pflanze/${p.id}">${p.entries[0] ? `<img src="${p.entries[0].thumb}" alt="">` : ''}<span>${healthDot(p.entries[0]?.analysis)} ${esc(p.name)} – Pflegetipps ansehen</span></a>`
      : `<button class="btn primary wide" data-action="item-photo" data-id="${i.id}">${ICON.camera}<span>Diese Pflanze fotografieren</span></button>`}
      ${confirmed ? '' : '<button class="btn secondary wide" data-action="item-confirm" data-id="' + i.id + '">✓ Ja, hier steht sie</button>'}
      <details>
        <summary>✏️ Ändern</summary>
        <form data-form="edit-item" data-id="${i.id}">
          <label>Name<input name="name" value="${esc(i.name)}"></label>
          <label>Art<select name="art">${options}</select></label>
          <p class="saved" hidden>✓ Gespeichert</p>
        </form>
        <p class="muted small">Zum Verschieben oben „✋ Verschieben“ antippen.</p>
        <button class="btn danger small" data-action="delete-el" data-kind="item" data-id="${i.id}">Aus dem Plan löschen</button>
      </details>
    </div>`;
}

function wegPanel(w) {
  if (!w) return '';
  return `
    <div class="card panel">
      <div class="area-head">
        <span class="area-icon" style="background:#efe3c8">🚶</span>
        <div><h3 id="sel-title">${esc(w.name)}</h3><p class="muted small">Weg</p></div>
      </div>
      <details>
        <summary>✏️ Ändern</summary>
        <form data-form="edit-weg" data-id="${w.id}">
          <label>Name<input name="name" value="${esc(w.name)}"></label>
          <p class="saved" hidden>✓ Gespeichert</p>
        </form>
        <button class="btn danger small" data-action="delete-el" data-kind="weg" data-id="${w.id}">Weg löschen</button>
      </details>
    </div>`;
}

// ---------- Pflanze im Plan eintragen ----------
export async function startPlacing(plant) {
  const plan = await loadPlan();
  if (!plan) return false;
  state.placing = { plantId: plant.id, name: plant.name, suggestions: matchItems(plan, plant.name).map((i) => i.id) };
  state.planMode = 'place';
  state.sel = null;
  location.hash = '#/plan';
  return true;
}

async function finishPlacing(item, plant) {
  item.plantId = plant.id;
  item.name = plant.name;
  item.status = 'bestaetigt';
  item.fixed = true;
  await savePlan(state.plan);
  state.placing = null;
  state.planMode = 'view';
  location.hash = '#/pflanze/' + plant.id;
}

// Foto über „Diese Pflanze fotografieren“ → neue Pflanze mit dem Punkt verbinden
export async function linkItem(itemId, plant) {
  const plan = await loadPlan();
  const item = plan?.items.find((i) => i.id === itemId);
  if (!item) return;
  item.plantId = plant.id;
  item.name = plant.name;
  item.status = 'bestaetigt';
  item.fixed = true;
  await savePlan(plan);
}

export async function unlinkPlant(plantId) {
  const plan = await loadPlan();
  if (!plan) return;
  let changed = false;
  for (const i of plan.items.filter((x) => x.plantId === plantId)) { i.plantId = null; changed = true; }
  if (changed) await savePlan(plan);
}

export async function itemForPlant(plantId) {
  const plan = await loadPlan();
  return { plan, item: plan?.items.find((i) => i.plantId === plantId) || null };
}

// ---------- Verschieben mit dem Finger ----------
let drag = null;
function svgPoint(svgEl, e) {
  const pt = svgEl.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

document.addEventListener('pointerdown', (e) => {
  if (state.planMode !== 'edit' || !state.plan) return;
  const svgEl = e.target.closest('svg.map');
  if (!svgEl) return;
  const plan = state.plan;
  const handle = e.target.closest('[data-handle]');
  const itemEl = e.target.closest('[data-item]');
  const wegEl = e.target.closest('[data-weg]');
  const areaEl = e.target.closest('[data-area]');
  let kind;
  let el;
  if (handle) { kind = 'resize'; el = plan.areas.find((a) => a.id === handle.dataset.handle); }
  else if (itemEl) { kind = 'item'; el = plan.items.find((i) => i.id === itemEl.dataset.item); }
  else if (wegEl) { kind = 'weg'; el = plan.wege.find((w) => w.id === wegEl.dataset.weg); }
  else if (areaEl) { kind = 'area'; el = plan.areas.find((a) => a.id === areaEl.dataset.area); }
  if (!el) return;
  e.preventDefault();
  drag = { kind, el, start: svgPoint(svgEl, e), orig: structuredClone(el), moved: false };
  const selKind = kind === 'resize' ? 'area' : kind;
  if (state.sel?.id !== el.id) {
    state.sel = { kind: selKind, id: el.id };
    redraw(true);
  }
});

document.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const svgEl = document.querySelector('svg.map');
  if (!svgEl) return;
  const p = svgPoint(svgEl, e);
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (Math.hypot(dx, dy) > 0.5) drag.moved = true;
  const H = state.plan.height;
  const r = (n) => Math.round(n * 10) / 10;
  const { el, orig } = drag;
  if (drag.kind === 'area') {
    el.x = r(clamp(orig.x + dx, 0, 100 - el.w));
    el.y = r(clamp(orig.y + dy, 0, H - el.h));
  } else if (drag.kind === 'resize') {
    el.w = r(clamp(orig.w + dx, 2, 100 - el.x));
    el.h = r(clamp(orig.h + dy, 2, H - el.y));
  } else if (drag.kind === 'item') {
    el.x = r(clamp(orig.x + dx, 0, 100));
    el.y = r(clamp(orig.y + dy, 0, H));
  } else if (drag.kind === 'weg') {
    el.pts = orig.pts.map(([x, y]) => [r(clamp(x + dx, 0, 100)), r(clamp(y + dy, 0, H))]);
  }
  redraw();
});

async function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return;
  d.el.fixed = true; // selbst korrigiert → Gemini ändert das nicht mehr
  if (d.kind === 'item') d.el.status = 'bestaetigt';
  await savePlan(state.plan);
  redraw(true);
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

// ---------- Klicks ----------
export async function handlePlanClick(e, el, d) {
  const plan = state.plan;
  switch (d.action) {
    case 'walk-start': {
      if (d.mode === 'new' && (await loadPlan()) && !confirm('Den bisherigen Plan verwerfen und komplett neu zeichnen?')) return true;
      state.walk = newWalk(d.mode === 'update');
      location.hash = '#/plan/rundgang';
      return true;
    }
    case 'walk-next': state.walk.step = Math.min(state.walk.step + 1, WALK_STEPS.length - 1); render().then(() => scrollTo(0, 0)); return true;
    case 'walk-prev': state.walk.step = Math.max(state.walk.step - 1, 0); render().then(() => scrollTo(0, 0)); return true;
    case 'walk-camera': planCamInput.value = ''; planCamInput.click(); return true;
    case 'walk-gallery': planGalleryInput.value = ''; planGalleryInput.click(); return true;
    case 'walk-remove': state.walk.photos.splice(+d.i, 1); render(); return true;
    case 'walk-create': createFromWalk(); return true;

    case 'select':
      state.sel = state.sel?.id === d.id ? null : { kind: d.kind, id: d.id };
      redraw(true);
      return true;
    case 'plan-mode':
      state.planMode = d.mode;
      state.measure = [];
      if (d.mode !== 'place') state.placing = null;
      render();
      return true;
    case 'labels':
      state.labels = !state.labels;
      el.classList.toggle('on', state.labels);
      redraw();
      return true;
    case 'add': {
      const what = d.what;
      const label = what === 'area' ? 'Wie heißt die neue Fläche? (z. B. Kräuterbeet, Hühnerstall)' : what === 'baum' ? 'Was für ein Baum? (z. B. Apfelbaum)' : 'Welche Pflanze?';
      const name = prompt(label, '');
      if (!name || !name.trim()) return true;
      const cx = 50;
      const cy = plan.height / 2;
      if (what === 'area') {
        const a = { id: uid(), name: name.trim().slice(0, 40), typ: 'beet', x: 40, y: Math.round(cy - 8), w: 20, h: 16, notiz: '', pflanzen: [], fixed: true };
        plan.areas.push(a);
        state.sel = { kind: 'area', id: a.id };
      } else {
        const i = { id: uid(), name: name.trim().slice(0, 40), art: what, x: cx, y: Math.round(cy), r: ITEM_ARTS[what].r, status: 'bestaetigt', plantId: null, fixed: true };
        plan.items.push(i);
        state.sel = { kind: 'item', id: i.id };
      }
      await savePlan(plan);
      render();
      return true;
    }
    case 'item-confirm': {
      const i = plan.items.find((x) => x.id === d.id);
      i.status = 'bestaetigt';
      i.fixed = true;
      await savePlan(plan);
      redraw(true);
      return true;
    }
    case 'delete-el': {
      const names = { area: 'diese Fläche', item: 'diesen Punkt', weg: 'diesen Weg' };
      if (!confirm(`Möchtest du ${names[d.kind]} aus dem Plan löschen? Gespeicherte Pflanzen bleiben erhalten.`)) return true;
      const key = { area: 'areas', item: 'items', weg: 'wege' }[d.kind];
      plan[key] = plan[key].filter((x) => x.id !== d.id);
      await savePlan(plan);
      state.sel = null;
      render();
      return true;
    }
    case 'map-tap': {
      const svgEl = el.closest('svg.map');
      const p = svgPoint(svgEl, e);
      const pt = [Math.round(clamp(p.x, 0, 100) * 10) / 10, Math.round(clamp(p.y, 0, plan.height) * 10) / 10];
      if (state.planMode === 'measure') {
        state.measure = state.measure.length >= 2 ? [pt] : [...state.measure, pt];
        redraw();
      } else if (state.planMode === 'place' && state.placing) {
        const plant = await db.getPlant(state.placing.plantId);
        let item = plan.items.find((i) => i.plantId === plant.id);
        if (!item) {
          item = { id: uid(), art: 'pflanze', r: ITEM_ARTS.pflanze.r };
          plan.items.push(item);
        }
        item.x = pt[0];
        item.y = pt[1];
        await finishPlacing(item, plant);
      }
      return true;
    }
    case 'place-pick': {
      const plant = await db.getPlant(state.placing.plantId);
      await finishPlacing(plan.items.find((i) => i.id === d.id), plant);
      return true;
    }
    case 'place-skip': {
      const id = state.placing?.plantId;
      state.placing = null;
      state.planMode = 'view';
      location.hash = id ? '#/pflanze/' + id : '#/plan';
      return true;
    }
    case 'goto-item':
      state.sel = { kind: 'item', id: d.id };
      state.planMode = 'view';
      return true; // der Link öffnet den Plan
    case 'plant-place':
      startPlacing(await db.getPlant(d.id));
      return true;
    default:
      return false;
  }
}

// ---------- Formulare ----------
function flash(form) {
  const s = form.querySelector('.saved');
  if (!s) return;
  s.hidden = false;
  setTimeout(() => { s.hidden = true; }, 1500);
}

export async function handlePlanSubmit(form, fd) {
  const plan = state.plan;
  switch (form.dataset.form) {
    case 'plan-size': {
      const w = num(fd.get('w'));
      const h = num(fd.get('h'));
      if (!(w > 0 && h > 0)) { alert('Bitte Breite und Tiefe in Metern eintragen, z. B. 45 und 30.'); return true; }
      setSize(plan, w, h);
      await savePlan(plan);
      render();
      return true;
    }
    case 'area-m': {
      const w = num(fd.get('w'));
      const h = num(fd.get('h'));
      if (!(w > 0 && h > 0)) { alert('Bitte Breite und Tiefe in Metern eintragen.'); return true; }
      setAreaMeters(plan, plan.areas.find((a) => a.id === form.dataset.id), w, h);
      await savePlan(plan);
      render();
      return true;
    }
    case 'walk-desc': return true;
    default: return false;
  }
}

export async function handlePlanChange(e) {
  const form = e.target.closest('form[data-form^="edit-"]');
  if (!form || !state.plan || !['edit-area', 'edit-item', 'edit-weg'].includes(form.dataset.form)) return false;
  const plan = state.plan;
  const fd = new FormData(form);
  const list = { 'edit-area': plan.areas, 'edit-item': plan.items, 'edit-weg': plan.wege }[form.dataset.form];
  const el = list.find((x) => x.id === form.dataset.id);
  el.name = fd.get('name').trim().slice(0, 40) || el.name;
  if (fd.has('typ')) el.typ = fd.get('typ');
  if (fd.has('notiz')) el.notiz = fd.get('notiz').trim();
  if (fd.has('art')) el.art = fd.get('art');
  await savePlan(plan);
  redraw();
  const title = document.getElementById('sel-title');
  if (title) title.textContent = el.name;
  flash(form);
  return true;
}

export function handlePlanInput(e) {
  if (e.target.dataset.input === 'walk-desc' && state.walk) {
    state.walk.desc = e.target.value;
    return true;
  }
  return false;
}
