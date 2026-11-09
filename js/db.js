// Lokale Datenbank im Browser (IndexedDB).
// "plants": Pflanzen mit ihren Einträgen, "photos": die großen Fotos, "meta": z. B. der Gartenplan.
const DB_NAME = 'gartenapp';
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of ['plants', 'photos', 'meta']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export const getPlants = () => run('plants', 'readonly', (s) => s.getAll());
export const getPlant = (id) => run('plants', 'readonly', (s) => s.get(id));
export const putPlant = (p) => run('plants', 'readwrite', (s) => s.put(p));
export const deletePlant = (id) => run('plants', 'readwrite', (s) => s.delete(id));

export const getPhoto = (id) => run('photos', 'readonly', (s) => s.get(id));
export const getPhotos = () => run('photos', 'readonly', (s) => s.getAll());
export const putPhoto = (p) => run('photos', 'readwrite', (s) => s.put(p));
export const deletePhoto = (id) => run('photos', 'readwrite', (s) => s.delete(id));

export const getMeta = (id) => run('meta', 'readonly', (s) => s.get(id));
export const getAllMeta = () => run('meta', 'readonly', (s) => s.getAll());
export const putMeta = (m) => run('meta', 'readwrite', (s) => s.put(m));

// Bittet den Browser, die Daten nicht automatisch zu löschen, wenn Speicher knapp wird.
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* egal */ }
}
