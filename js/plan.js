// Gartenplan: Datenmodell, Maßstab, Zusammenführen mit Gemini-Ergebnissen und Zeichnen als SVG.
//
// Koordinaten: x von 0 bis 100 (Breite), y von 0 bis plan.height (Tiefe).
// Sind die Außenmaße bekannt, entspricht 100 Einheiten der Gartenbreite in Metern.
import { esc, uid, clamp } from './util.js';

export const AREA_TYPES = {
  haus: { label: 'Wohnhaus', icon: '🏠', fill: '#d2c2ae', layer: 3 },
  stall: { label: 'Stall', icon: '🐓', fill: '#c4a484', layer: 3 },
  schuppen: { label: 'Schuppen', icon: '🛖', fill: '#bfae98', layer: 3 },
  gewaechshaus: { label: 'Gewächshaus', icon: '🪟', fill: '#dff1f5', layer: 3 },
  terrasse: { label: 'Terrasse / Hof', icon: '🪑', fill: '#e2dbcc', layer: 2 },
  beet: { label: 'Beet', icon: '🌷', fill: '#e9c9a8', layer: 2 },
  gemuesebeet: { label: 'Gemüsebeet', icon: '🥕', fill: '#c9a07a', layer: 2 },
  teich: { label: 'Teich', icon: '💧', fill: '#a6d2ec', layer: 2 },
  kompost: { label: 'Kompost', icon: '♻️', fill: '#a3815f', layer: 2 },
  hecke: { label: 'Hecke', icon: '🌲', fill: '#5f8f4e', layer: 2 },
  rasen: { label: 'Rasen', icon: '🌱', fill: '#bfe0a6', layer: 0 },
  wiese: { label: 'Wiese / Obstwiese', icon: '🌾', fill: '#d3e6b4', layer: 0 },
  sonstiges: { label: 'Sonstiges', icon: '📍', fill: '#e4dec4', layer: 2 },
};

export const ITEM_ARTS = {
  baum: { label: 'Baum', icon: '🌳', r: 5 },
  strauch: { label: 'Strauch', icon: '🌿', r: 2.6 },
  pflanze: { label: 'Pflanze', icon: '🌼', r: 1.5 },
};

const r1 = (n) => Math.round(n * 10) / 10;

export const emptyPlan = () => ({ id: 'plan', version: 2, height: 100, size: null, areas: [], items: [], wege: [], beschreibung: '', hinweis: '', created: Date.now() });

// Ältere Pläne auf das neue Modell bringen
export function normalizePlan(p) {
  if (!p) return null;
  if (p.version === 2) return p;
  const plan = { ...emptyPlan(), ...p, version: 2, height: 100, size: null, items: [], wege: [] };
  plan.areas = [];
  for (const a of p.areas || []) {
    if (a.typ === 'baum' || a.typ === 'strauch') {
      plan.items.push({ id: a.id, name: a.name, art: a.typ, x: r1(a.x + a.w / 2), y: r1(a.y + a.h / 2), r: r1(Math.max(a.w, a.h) / 2), status: 'vermutet', plantId: null, fixed: false });
    } else {
      plan.areas.push({ ...a, typ: AREA_TYPES[a.typ] ? a.typ : a.typ === 'blumenbeet' ? 'beet' : 'sonstiges' });
    }
  }
  return plan;
}

// ---------- Maßstab ----------
export const unitsPerM = (plan) => (plan.size ? 100 / plan.size.w : null);

export function meters(plan, units) {
  const u = unitsPerM(plan);
  if (!u) return null;
  const m = units / u;
  return m >= 10 ? `${Math.round(m)} m` : `${(Math.round(m * 10) / 10).toString().replace('.', ',')} m`;
}

// Außenmaße setzen: Tiefe ergibt sich im Verhältnis, alles wird senkrecht mitgestreckt
export function setSize(plan, wM, hM) {
  const newH = r1(clamp((100 * hM) / wM, 20, 400));
  const f = newH / plan.height;
  for (const a of plan.areas) { a.y = r1(a.y * f); if (!a.m) a.h = r1(a.h * f); }
  for (const i of plan.items) i.y = r1(i.y * f);
  for (const w of plan.wege) w.pts = w.pts.map(([x, y]) => [x, r1(y * f)]);
  plan.height = newH;
  plan.size = { w: wM, h: hM };
  // Bereits vermessene Flächen behalten ihre echten Maße
  for (const a of plan.areas.filter((x) => x.m)) setAreaMeters(plan, a, a.m.w, a.m.h);
}

export function setAreaMeters(plan, a, wM, hM) {
  const u = unitsPerM(plan);
  if (!u) return;
  a.w = r1(clamp(wM * u, 1, 100));
  a.h = r1(clamp(hM * u, 1, plan.height));
  a.x = r1(clamp(a.x, 0, 100 - a.w));
  a.y = r1(clamp(a.y, 0, plan.height - a.h));
  a.m = { w: wM, h: hM };
  a.fixed = true;
}

// ---------- Gemini-Ergebnis übernehmen ----------
// Bestehende Elemente (gleiche id) werden aktualisiert, außer sie sind fest (selbst bestätigt/vermessen).
export function mergePlan(old, res) {
  const plan = old ? structuredClone(old) : emptyPlan();
  const H = plan.height;
  const upsert = (list, incoming, apply) => {
    for (const src of incoming || []) {
      let dst = src.id ? list.find((e) => e.id === src.id) : null;
      if (!dst) { dst = { id: uid(), fixed: false }; list.push(dst); }
      apply(src, dst);
    }
  };
  upsert(plan.areas, res.flaechen, (s, d) => {
    d.pflanzen = (s.pflanzen || []).slice(0, 20);
    if (d.fixed) return;
    const w = clamp(+s.w || 10, 2, 100);
    const h = clamp(+s.h || 10, 2, H);
    Object.assign(d, {
      name: String(s.name || 'Fläche').slice(0, 40),
      typ: AREA_TYPES[s.typ] ? s.typ : 'sonstiges',
      w: r1(w), h: r1(h),
      x: r1(clamp(+s.x || 0, 0, 100 - w)),
      y: r1(clamp(+s.y || 0, 0, H - h)),
      notiz: d.notiz || s.notiz || '',
    });
  });
  upsert(plan.items, res.objekte, (s, d) => {
    if (d.fixed) return;
    const art = ITEM_ARTS[s.art] ? s.art : 'pflanze';
    Object.assign(d, {
      name: String(s.name || ITEM_ARTS[art].label).slice(0, 40),
      art,
      x: r1(clamp(+s.x || 50, 0, 100)),
      y: r1(clamp(+s.y || H / 2, 0, H)),
      r: r1(clamp(+s.groesse || ITEM_ARTS[art].r, 1, 12)),
      status: d.status || 'vermutet',
      plantId: d.plantId || null,
    });
  });
  upsert(plan.wege, res.wege, (s, d) => {
    if (d.fixed) return;
    const pts = (s.punkte || []).map((p) => [r1(clamp(+p.x || 0, 0, 100)), r1(clamp(+p.y || 0, 0, H))]);
    Object.assign(d, { name: String(s.name || 'Weg').slice(0, 40), pts: pts.length >= 2 ? pts : d.pts || [] });
  });
  plan.wege = plan.wege.filter((w) => w.pts?.length >= 2);
  if (res.beschreibung) plan.beschreibung = res.beschreibung;
  plan.hinweis = res.hinweis || '';
  plan.updated = Date.now();
  return plan;
}

// Vermutete, noch nicht zugeordnete Punkte, die zum Pflanzennamen passen
export function matchItems(plan, name) {
  const n = (name || '').toLowerCase().trim();
  if (!plan || !n) return [];
  const words = n.split(/[\s-]+/).filter((w) => w.length > 3);
  return plan.items.filter((i) => {
    if (i.plantId) return false;
    const q = i.name.toLowerCase();
    return q.includes(n) || n.includes(q) || words.some((w) => q.includes(w));
  });
}

// Für die Gemini-Anfrage: der aktuelle Plan in kompakter Form
export function planForPrompt(plan) {
  return JSON.stringify({
    hoehe: plan.height,
    flaechen: plan.areas.map(({ id, name, typ, x, y, w, h, fixed }) => ({ id, name, typ, x, y, w, h, fest: !!fixed })),
    objekte: plan.items.map(({ id, name, art, x, y, r, fixed }) => ({ id, name, art, x, y, groesse: r, fest: !!fixed })),
    wege: plan.wege.map(({ id, name, pts, fixed }) => ({ id, name, punkte: pts.map(([x, y]) => ({ x, y })), fest: !!fixed })),
  });
}

// ---------- Zeichnen ----------
const HEALTH = { gesund: '#3f9d5a', 'leichte Probleme': '#f0b429', krank: '#d64545' };

function niceScale(plan) {
  const u = unitsPerM(plan);
  const m = [1, 2, 5, 10, 20, 50, 100].find((v) => v * u >= 14) || 100;
  return { m, len: m * u };
}

// opts: selected {kind,id} · mode 'view'|'edit'|'place'|'measure' · interactive · labels · measure [[x,y],..] · highlight [ids]
export function mapSvg(plan, plants, opts = {}) {
  const { selected = null, mode = 'view', interactive = true, labels = false, measure = [], highlight = [] } = opts;
  const H = plan.height;
  const isSel = (kind, id) => selected && selected.kind === kind && selected.id === id;
  const act = (kind, id) => (interactive && mode === 'view' ? `data-action="select" data-kind="${kind}" data-id="${id}"` : '');
  const plantById = Object.fromEntries(plants.map((p) => [p.id, p]));

  const areas = [...plan.areas].sort((a, b) => ((AREA_TYPES[a.typ]?.layer ?? 2) - (AREA_TYPES[b.typ]?.layer ?? 2)) || (b.w * b.h - a.w * a.h));
  const drawArea = (a) => {
    const t = AREA_TYPES[a.typ] || AREA_TYPES.sonstiges;
    const sel = isSel('area', a.id);
    const fs = r1(clamp((a.w * 1.8) / Math.max(4, a.name.length), 2, 3.4));
    const dims = sel && plan.size ? `<text x="${r1(a.x + a.w / 2)}" y="${r1(a.y + a.h / 2 + fs + 0.6)}" font-size="2.2" class="label dims">${meters(plan, a.w)} × ${meters(plan, a.h)}${a.m ? ' ✓' : ''}</text>` : '';
    const building = t.layer === 3 ? ' building' : '';
    return `<g class="area${sel ? ' sel' : ''}${building}" data-area="${a.id}" ${act('area', a.id)}>
      <rect x="${a.x}" y="${a.y}" width="${a.w}" height="${a.h}" rx="${building ? 0.6 : 1.5}" fill="${t.fill}" class="shape"/>
      <text x="${r1(a.x + a.w / 2)}" y="${r1(a.y + a.h / 2)}" font-size="${fs}" class="label">${esc(a.name)}</text>${dims}
    </g>`;
  };
  const lower = areas.filter((a) => (AREA_TYPES[a.typ]?.layer ?? 2) === 0).map(drawArea).join('');
  const upper = areas.filter((a) => (AREA_TYPES[a.typ]?.layer ?? 2) > 0).map(drawArea).join('');

  const wege = plan.wege.map((w) => {
    const pts = w.pts.map((p) => p.join(',')).join(' ');
    const sel = isSel('weg', w.id);
    return `<g class="weg${sel ? ' sel' : ''}" data-weg="${w.id}" ${act('weg', w.id)}>
      <polyline points="${pts}" class="weg-edge"/><polyline points="${pts}" class="weg-fill"/>
    </g>`;
  }).join('');

  // Bäume zuerst (groß), dann Sträucher, dann Pflanzen obendrauf
  const order = { baum: 0, strauch: 1, pflanze: 2 };
  const items = [...plan.items].sort((a, b) => order[a.art] - order[b.art]).map((i) => {
    const p = i.plantId ? plantById[i.plantId] : null;
    const sel = isSel('item', i.id);
    const confirmed = i.status === 'bestaetigt';
    const pulse = highlight.includes(i.id) ? ' pulse' : '';
    let shape;
    if (i.art === 'pflanze') {
      const fill = confirmed ? (HEALTH[p?.entries[0]?.analysis?.zustand] || '#3f9d5a') : '#ffffff';
      shape = `<circle cx="${i.x}" cy="${i.y}" r="${sel ? 2.2 : 1.6}" fill="${fill}" class="plant-dot${confirmed ? '' : ' guess'}"/>`;
    } else {
      const fill = i.art === 'baum' ? '#5f9e4f' : '#8cc46f';
      shape = `<circle cx="${i.x}" cy="${i.y}" r="${i.r}" fill="${fill}" class="crown${confirmed ? '' : ' guess'}"/>`
        + `<circle cx="${i.x}" cy="${i.y}" r="0.8" fill="#6b4f35"/>`;
    }
    const showLabel = labels || sel || i.art === 'baum' || pulse;
    const ly = i.art === 'pflanze' ? i.y - 2.6 : i.y + i.r + 2.2;
    const label = showLabel ? `<text x="${i.x}" y="${r1(ly)}" font-size="2.3" class="label lbl-s">${esc(i.name)}</text>` : '';
    return `<g class="item ${i.art}${sel ? ' sel' : ''}${pulse}" data-item="${i.id}" ${act('item', i.id)}>${shape}${label}</g>`;
  }).join('');

  let handle = '';
  if (mode === 'edit' && selected?.kind === 'area') {
    const a = plan.areas.find((x) => x.id === selected.id);
    if (a && !a.m) handle = `<circle data-handle="${a.id}" cx="${r1(a.x + a.w)}" cy="${r1(a.y + a.h)}" r="2.8" class="handle"/>`;
  }

  let scale = '';
  if (plan.size) {
    const { m, len } = niceScale(plan);
    scale = `<g class="scalebar"><line x1="2" y1="${r1(H - 2)}" x2="${r1(2 + len)}" y2="${r1(H - 2)}"/><line x1="2" y1="${r1(H - 3.2)}" x2="2" y2="${r1(H - 0.8)}"/><line x1="${r1(2 + len)}" y1="${r1(H - 3.2)}" x2="${r1(2 + len)}" y2="${r1(H - 0.8)}"/><text x="${r1(2 + len / 2)}" y="${r1(H - 3.6)}" font-size="2.4" class="label lbl-s">${m} m</text></g>`;
  }

  let ruler = '';
  if (measure.length) {
    const [a, b] = measure;
    ruler = `<g class="ruler"><circle cx="${a[0]}" cy="${a[1]}" r="1.2"/>`;
    if (b) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const txt = meters(plan, d) || `${Math.round(d)} Einheiten`;
      ruler += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/><circle cx="${b[0]}" cy="${b[1]}" r="1.2"/>`
        + `<text x="${r1((a[0] + b[0]) / 2)}" y="${r1((a[1] + b[1]) / 2 - 2)}" font-size="3.2" class="label">${txt}</text>`;
    }
    ruler += '</g>';
  }

  const tap = interactive && (mode === 'place' || mode === 'measure') ? 'data-action="map-tap"' : '';
  return `<svg viewBox="-2 -2 104 ${r1(H + 4)}" class="map mode-${mode}" ${tap} role="img" aria-label="Gartenplan">
    <rect x="-2" y="-2" width="104" height="${r1(H + 4)}" rx="4" class="ground"/>
    ${lower}${wege}${upper}${items}${handle}${scale}${ruler}
  </svg>`;
}
