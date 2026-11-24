// Minimal IndexedDB wrapper: one key-value store for the data document,
// one store for attachment blobs and misc handles.

const DB_NAME = 'house-committee';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: 'kv' | 'files', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const kvGet = <T>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key));
export const kvDel = (key: string) => tx('kv', 'readwrite', (s) => s.delete(key));

export const fileGet = (id: string) => tx<Blob | undefined>('files', 'readonly', (s) => s.get(id));
export const fileSet = (id: string, blob: Blob) => tx('files', 'readwrite', (s) => s.put(blob, id));
export const fileDel = (id: string) => tx('files', 'readwrite', (s) => s.delete(id));
export const fileKeys = () => tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys());
export const fileClear = () => tx('files', 'readwrite', (s) => s.clear());

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {
    /* ignore */
  }
}
