// Verbindung zur Google Gemini API (kostenloses Kontingent).
// Der Schlüssel liegt nur auf dem Handy und wird direkt an Google geschickt.
import { settings } from './settings.js';
import { AREA_TYPES, ITEM_ARTS, planForPrompt } from './plan.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODEL_LIST_MS = 24 * 60 * 60 * 1000; // Modell-Liste einmal am Tag neu holen
const MAX_TRIES = 6;

export class AiError extends Error {}

// retry = true: mit einem anderen Modell erneut versuchen lohnt sich
function fail(message, retry = false, extra = {}) {
  return Object.assign(new AiError(message), { retry }, extra);
}

async function call(path, body, key = settings.apiKey, timeoutMs = 0) {
  if (!key) throw fail('Es ist noch kein Gemini-Schlüssel eingetragen. Bitte in den Einstellungen hinterlegen.');
  const ctrl = new AbortController();
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  let data;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    if (e.name === 'AbortError') throw fail('Google antwortet gerade nicht.', true, { timeout: true });
    throw fail('Keine Internetverbindung. Bitte später nochmal versuchen.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = data.error?.message || '';
    if (res.status === 429) throw fail('Das kostenlose Kontingent ist gerade aufgebraucht. In ein paar Minuten (oder morgen) geht es weiter.', true, { quota: true });
    if (res.status === 404) throw fail('Modell nicht verfügbar.', true);
    if (res.status === 400 && /api key/i.test(msg)) throw fail('Der Gemini-Schlüssel funktioniert nicht. Bitte in den Einstellungen prüfen.');
    if (res.status === 403) throw fail('Zugriff verweigert – der Gemini-Schlüssel ist ungültig, gesperrt oder für diese Adresse nicht freigegeben.');
    if (res.status === 413 || /too large|payload/i.test(msg)) throw fail('Das waren zu viele Fotos auf einmal. Bitte ein paar entfernen.');
    if (res.status >= 500) throw fail('Google ist gerade überlastet.', true);
    throw fail('Fehler bei der Anfrage: ' + (msg || res.status));
  }
  return data;
}

// Alle passenden Modelle, beste zuerst: Flash (neueste Version zuerst), dann die schnelleren Lite-Modelle.
async function modelList(key = settings.apiKey, fresh = false) {
  const tag = key.slice(-6);
  const cached = settings.getCache('models');
  if (!fresh && cached && cached.tag === tag && Date.now() - cached.at < MODEL_LIST_MS && cached.list.length) return cached.list;
  const data = await call('/models?pageSize=1000', null, key, 15000);
  const names = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  const version = (n) => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)-flash/) || [])[1] || '0');
  const sorted = (re) => names.filter((n) => re.test(n)).sort((a, b) => version(b) - version(a));
  const list = [
    ...sorted(/^gemini-\d+(\.\d+)?-flash$/),
    ...(names.includes('gemini-flash-latest') ? ['gemini-flash-latest'] : []),
    ...sorted(/^gemini-\d+(\.\d+)?-flash-lite$/),
    ...(names.includes('gemini-flash-lite-latest') ? ['gemini-flash-lite-latest'] : []),
  ];
  settings.setCache('models', { at: Date.now(), tag, list });
  return list;
}

// Prüft den Schlüssel und holt die Modell-Liste
export async function pickModel(key = settings.apiKey) {
  const list = await modelList(key, true);
  if (!list.length) throw fail('Mit diesem Schlüssel ist kein passendes Gemini-Modell verfügbar.');
  if (!list.includes(settings.model)) settings.model = list[0];
  return settings.model;
}

// Überlastete Modelle eine Weile überspringen
const BAD_MS = 30 * 60 * 1000;
function badModels() {
  const bad = settings.getCache('badModels') || {};
  const now = Date.now();
  return Object.fromEntries(Object.entries(bad).filter(([, until]) => until > now));
}
function markBad(model) {
  settings.setCache('badModels', { ...badModels(), [model]: Date.now() + BAD_MS });
}

// Fragt Gemini – ist ein Modell überlastet oder antwortet nicht rechtzeitig, kommt automatisch das nächste dran.
// Das zuletzt erfolgreiche Modell wird gemerkt und zuerst probiert.
// „Wenig nachdenken“ (thinkingLevel low) macht die Antwort ein Vielfaches schneller.
async function generate(body, { timeout = 25000, onRetry, thinking = 'low' } = {}) {
  let list = await modelList();
  if (settings.model && !list.includes(settings.model)) list = await modelList(settings.apiKey, true);
  const all = [settings.model, ...list].filter((m, i, a) => m && a.indexOf(m) === i);
  const bad = badModels();
  const fresh = all.filter((m) => !bad[m]);
  const order = [...fresh, ...all.filter((m) => bad[m])].slice(0, MAX_TRIES); // gesperrte nur als letzte Wahl
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    const model = order[i];
    if (i > 0) onRetry?.(i);
    const withThinking = thinking && !settings.getCache('noThinking')?.[model];
    const req = withThinking
      ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingLevel: thinking } } }
      : body;
    try {
      const data = await call(`/models/${model}:generateContent`, req, settings.apiKey, timeout);
      settings.model = model;
      return data;
    } catch (e) {
      // Modell kennt die Denk-Einstellung nicht → merken und ohne sie nochmal
      if (withThinking && !e.retry && /think/i.test(e.message)) {
        settings.setCache('noThinking', { ...(settings.getCache('noThinking') || {}), [model]: true });
        i -= 1;
        continue;
      }
      lastErr = e;
      if (!e.retry) throw e;
      if (!e.quota) markBad(model);
    }
  }
  if (lastErr?.quota) throw lastErr;
  throw fail('Google ist gerade stark ausgelastet. Bitte in ein paar Minuten nochmal versuchen.');
}

function textOf(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  if (!text) throw new AiError('Keine Antwort erhalten. Bitte nochmal versuchen.');
  return text;
}

function parseJson(data) {
  try {
    return JSON.parse(textOf(data));
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError('Die Antwort war unvollständig. Bitte nochmal versuchen.');
  }
}

function imagePart(dataUrl) {
  const [meta, data] = dataUrl.split(',');
  return { inline_data: { mime_type: meta.match(/data:(.*?);/)[1], data } };
}

function context() {
  const d = new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const loc = settings.location?.name;
  return `Heute ist der ${d}.${loc ? ` Der Garten liegt in ${loc}.` : ' Der Garten liegt in Deutschland.'}`;
}

// Systemanweisung mit dem auf dem Gerät gespeicherten Namen
const who = () => settings.name || 'der Gärtnerin bzw. dem Gärtner';
const systemText = () => `Du bist ein erfahrener, freundlicher Gärtner und hilfst ${settings.name ? `${settings.name}, einer Hobbygärtnerin bzw. einem Hobbygärtner,` : 'einer Hobbygärtnerin bzw. einem Hobbygärtner'} mit dem großen Garten. Sprich mit „du“.
Schreibe auf Deutsch, in einfachen, kurzen Sätzen, ohne Fachchinesisch (Fachbegriffe kurz erklären).
Empfiehl bei Krankheiten und Schädlingen immer zuerst biologische Hausmittel, chemische Mittel nur als letzte Möglichkeit.
Berücksichtige die Jahreszeit. Sei ehrlich, wenn du dir unsicher bist.`;

const S = { type: 'STRING' };
const N = { type: 'NUMBER' };

// ---------- Einzelne Pflanze ----------
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    pflanze_erkannt: { type: 'BOOLEAN', description: 'Ist überhaupt eine Pflanze auf dem Foto?' },
    name: { type: 'STRING', description: 'Deutscher Name der Pflanze' },
    botanisch: { type: 'STRING', description: 'Botanischer Name' },
    sicherheit: { type: 'STRING', enum: ['hoch', 'mittel', 'niedrig'] },
    alternativen: { type: 'ARRAY', items: S, description: 'Andere mögliche Pflanzen, falls unsicher' },
    stadium: { type: 'STRING', description: 'Wachstumsstadium, z. B. Austrieb, Blüte, Fruchtbildung, Ruhephase' },
    zustand: { type: 'STRING', enum: ['gesund', 'leichte Probleme', 'krank'] },
    zustand_text: { type: 'STRING', description: 'Ein Satz zum Gesundheitszustand und zur Form (Wuchs, Schnitt)' },
    steckbrief: {
      type: 'OBJECT',
      description: 'Allgemeine Eigenschaften der Pflanze',
      properties: {
        kurz: { type: 'STRING', description: 'Ein bis zwei Sätze: Was ist das für eine Pflanze? (z. B. mehrjährige Staude, Obstgehölz)' },
        bluetezeit: { type: 'STRING', description: 'Monate und Blütenfarbe, z. B. „Juni bis August, rosa“' },
        fruechte: { type: 'STRING', description: 'Wann Früchte/Ernte – oder „trägt keine essbaren Früchte“' },
        aussaat: { type: 'STRING', description: 'Wann und wie aussäen bzw. pflanzen' },
        vermehrung: { type: 'STRING', description: 'Wie man Ableger/Stecklinge zieht oder teilt – kurze Anleitung in 2–3 Schritten' },
        wuchs: { type: 'STRING', description: 'Höhe, Breite, ein- oder mehrjährig, winterhart?' },
      },
      required: ['kurz', 'bluetezeit', 'fruechte', 'aussaat', 'vermehrung', 'wuchs'],
    },
    probleme: {
      type: 'ARRAY',
      description: 'Nur echte, auf dem Foto erkennbare Probleme. Bei einer gesunden Pflanze leer lassen.',
      items: {
        type: 'OBJECT',
        properties: { name: S, anzeichen: S, bio: { type: 'STRING', description: 'Biologische Behandlung / Hausmittel' }, sonst: { type: 'STRING', description: 'Weitere Maßnahmen, falls Bio nicht hilft' } },
        required: ['name', 'anzeichen', 'bio', 'sonst'],
      },
    },
    jetzt_tun: { type: 'ARRAY', items: S, description: 'Ein bis vier konkrete Dinge, die jetzt zu tun sind' },
    pflege: {
      type: 'OBJECT',
      properties: { giessen: S, standort: S, duengen: S, schnitt: S, winter: S },
      required: ['giessen', 'standort', 'duengen', 'schnitt', 'winter'],
    },
    frostempfindlich: { type: 'BOOLEAN' },
    giftig: { type: 'STRING', description: 'Giftig für Menschen/Haustiere? Kurz.' },
  },
  required: ['pflanze_erkannt', 'name', 'botanisch', 'sicherheit', 'stadium', 'zustand', 'zustand_text', 'steckbrief', 'probleme', 'jetzt_tun', 'pflege', 'frostempfindlich', 'giftig'],
};

export async function analyze(photo, knownPlant, { onRetry } = {}) {
  const hint = knownPlant
    ? `\nHinweis: Das ist vermutlich meine Pflanze „${knownPlant.name}“${knownPlant.botanisch ? ` (${knownPlant.botanisch})` : ''}. Prüfe das trotzdem kurz.`
    : '';
  const data = await generate({
    systemInstruction: { parts: [{ text: systemText() }] },
    contents: [{
      role: 'user',
      parts: [imagePart(photo), { text: `${context()}${hint}\nWelche Pflanze ist das? Gib mir einen Steckbrief (Blütezeit, Früchte, Aussaat, Vermehrung über Ableger/Stecklinge, Wuchs).
Prüfe außerdem das Foto genau auf Krankheiten, Schädlinge und schlechte Form (z. B. verkahlt, zu dicht, falsch geschnitten).
Nur wenn wirklich etwas zu sehen ist: Problem mit Behandlung nennen. Ist die Pflanze gesund, „gesund“ angeben und keine Probleme erfinden.` }],
    }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.3 },
  }, { timeout: 25000, onRetry });
  return parseJson(data);
}

// ---------- Gartenplan aus einem Rundgang ----------
const PLAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    beschreibung: { type: 'STRING', description: 'Zwei bis drei Sätze, wie der Garten aufgebaut ist' },
    flaechen: {
      type: 'ARRAY',
      description: 'Gebäude, Stallungen, Rasen, Wiesen, Beete, Terrassen, Teiche … als Rechtecke',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'Nur bei bestehenden Flächen: deren id' },
          name: { type: 'STRING', description: 'Verständlicher Name, z. B. „Hühnerstall“, „Wiese hinter dem Stall“' },
          typ: { type: 'STRING', enum: Object.keys(AREA_TYPES) },
          x: N, y: N, w: N, h: N,
          pflanzen: { type: 'ARRAY', items: S, description: 'Erkennbare Pflanzen auf dieser Fläche' },
        },
        required: ['name', 'typ', 'x', 'y', 'w', 'h'],
      },
    },
    wege: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: S,
          name: S,
          punkte: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: N, y: N }, required: ['x', 'y'] } },
        },
        required: ['name', 'punkte'],
      },
    },
    objekte: {
      type: 'ARRAY',
      description: 'Einzelne Bäume, Sträucher und Pflanzen als Punkte',
      items: {
        type: 'OBJECT',
        properties: {
          id: S,
          name: { type: 'STRING', description: 'Deutscher Pflanzenname, z. B. „Apfelbaum“, „Flieder“, „Pfingstrose“' },
          art: { type: 'STRING', enum: Object.keys(ITEM_ARTS) },
          x: N, y: N,
          groesse: { type: 'NUMBER', description: 'Kronen-Radius in Einheiten (Baum ca. 3–8, Strauch 1.5–3, Pflanze 1–1.5)' },
        },
        required: ['name', 'art', 'x', 'y'],
      },
    },
    hinweis: { type: 'STRING', description: 'Was am Plan unsicher ist' },
  },
  required: ['beschreibung', 'flaechen', 'wege', 'objekte'],
};

// photos: [{ photo, step }] · plan: bestehender Plan oder null · description: Beschreibung des Gartens
export async function planGarden(photos, description, plan, { onRetry } = {}) {
  const H = plan?.height || 100;
  const size = plan?.size ? `Der Garten ist etwa ${plan.size.w} m breit und ${plan.size.h} m tief (100 Einheiten = ${plan.size.w} m).` : '';
  const parts = [];
  photos.forEach((p, i) => {
    parts.push({ text: `Foto ${i + 1} – ${p.step}:` });
    parts.push(imagePart(p.photo));
  });
  const update = plan && (plan.areas.length || plan.items.length)
    ? `\nEs gibt schon einen Plan. Ergänze und verbessere ihn mit den neuen Fotos:
${planForPrompt(plan)}
- Gib ALLE Elemente zurück, die es weiterhin gibt. Bestehende Elemente behalten ihre id.
- Elemente mit "fest": true hat ${who()} selbst bestätigt oder vermessen: Lage und Größe NICHT ändern, sie dienen dir als sichere Orientierung.
- Neue Elemente bekommen keine id.`
    : '';
  const prompt = `Das sind ${photos.length} Fotos von einem Rundgang durch meinen Garten. Er ist eher naturbelassen und gemischt – keine ordentlichen Reihen, sondern viele verschiedene Pflanzen, ein paar Bäume, Wege und Gebäude wie Wohnhaus und Stallungen.
${description ? `Meine Beschreibung: „${description}“\n` : ''}${size}
Zeichne daraus einen schematischen Lageplan von oben:
- Koordinaten: x von 0 (links) bis 100 (rechts), y von 0 (oben) bis ${H} (unten). Oben ist Norden, falls erkennbar oder beschrieben – sonst liegt das Wohnhaus oben.
- Flächen sind Rechtecke (x, y = linke obere Ecke, w = Breite, h = Höhe): Gebäude (haus, stall, schuppen, gewaechshaus), Rasen, Wiesen, Hof/Terrasse, Teich, Kompost, Hecken und klar abgegrenzte Beete. Rasen/Wiese dürfen große Teile füllen; Gebäude sollen sich nicht überlappen.
- Wege als Linien mit 2 bis 6 Punkten.
- Jeden erkennbaren Baum und Strauch einzeln als Objekt. Auffällige einzelne Pflanzen oder Pflanzengruppen (z. B. „Rosen“, „Pfingstrosen“, „Rhabarber“) ebenfalls als Objekt an ihrer ungefähren Stelle.
- Nutze die Reihenfolge der Fotos und die Schritte, um die Lage zueinander abzuleiten. Wenn du etwas nicht sicher verorten kannst, schätze vernünftig und erwähne es im Hinweis.
Es muss nicht maßstabsgetreu sein, aber die Lage zueinander soll stimmen.${update}`;
  parts.push({ text: `${context()}\n${prompt}` });
  const data = await generate({
    systemInstruction: { parts: [{ text: systemText() }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: PLAN_SCHEMA, temperature: 0.3 },
  }, { timeout: 90000, onRetry });
  return parseJson(data);
}

// ---------- Rückfrage zu einem Foto ----------
// history = [{ role: 'user' | 'model', text }]
export async function ask(photo, analysis, history, question) {
  const contents = [
    {
      role: 'user',
      parts: [imagePart(photo), { text: `${context()}\nDas ist meine Pflanze. Deine bisherige Einschätzung: ${JSON.stringify(analysis)}` }],
    },
    { role: 'model', parts: [{ text: 'Alles klar, ich habe mir das Foto angesehen. Was möchtest du wissen?' }] },
    ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    { role: 'user', parts: [{ text: question }] },
  ];
  const data = await generate({
    systemInstruction: { parts: [{ text: systemText() + '\nAntworte kurz (höchstens etwa 120 Wörter). Einfache Aufzählungen mit "- " sind erlaubt.' }] },
    contents,
    generationConfig: { temperature: 0.5 },
  }, { timeout: 20000 });
  return textOf(data).trim();
}
