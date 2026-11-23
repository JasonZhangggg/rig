// The copy of each manual's PDF kept on this device, by manual id. A file the
// person added only exists here, so this is where it lives. IndexedDB when the
// browser allows it, otherwise memory for as long as the app is open. Files
// in IndexedDB are read when they're needed and not held in memory: a manual
// can be 60 MB, and a few of them would otherwise stay loaded all day.

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
  return v instanceof ArrayBuffer ? v : null;
}

/** Whether this device has the file, without loading it. */
export async function hasCopy(id: string): Promise<boolean> {
  if (memory.has(id)) return true;
  return (await run<IDBValidKey | undefined>("readonly", (s) => s.getKey(id))) !== undefined;
}

export async function putCopy(id: string, bytes: ArrayBuffer): Promise<void> {
  // Kept in memory only when IndexedDB couldn't take it.
  const saved = await run("readwrite", (s) => s.put(bytes, id));
  if (saved === undefined) memory.set(id, bytes);
  else memory.delete(id);
}

export async function dropCopy(id: string): Promise<void> {
  memory.delete(id);
  await run("readwrite", (s) => s.delete(id));
}

