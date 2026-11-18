// The copy of each manual's PDF kept on this device, by manual id. A file the
// person added only exists here, so this is where it lives. IndexedDB when the
// browser allows it, otherwise memory for as long as the app is open.

const DB = "rig-manuals";
const STORE = "files";
const memory = new Map<string, ArrayBuffer>();
let db: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then((d) => new Promise<T | undefined>((resolve) => {
    if (!d) return resolve(undefined);
    try {
      const req = f(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

/** The PDF kept for a manual, or null when this device has none. */
export async function getCopy(id: string): Promise<ArrayBuffer | null> {
  const mem = memory.get(id);
  if (mem) return mem;
  const v = await run<unknown>("readonly", (s) => s.get(id));
  if (v instanceof ArrayBuffer) { memory.set(id, v); return v; }
  return null;
}

export async function putCopy(id: string, bytes: ArrayBuffer): Promise<void> {
  memory.set(id, bytes);
  await run("readwrite", (s) => s.put(bytes, id));
}

export async function dropCopy(id: string): Promise<void> {
  memory.delete(id);
  await run("readwrite", (s) => s.delete(id));
}

/** Whether this device has the file, without loading it. */
export const hasCopyInMemory = (id: string) => memory.has(id);
