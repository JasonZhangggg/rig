import { afterEach, describe, expect, it, vi } from "vitest";

/** Just enough of IndexedDB for the manual cache: one store, counting how often a whole file is read. */
function fakeIndexedDb() {
  const files = new Map<IDBValidKey, unknown>();
  const reads = { files: 0 };
  const request = <T>(result: () => T) => {
    const req = {} as IDBRequest<T> & { onsuccess?: () => void };
    queueMicrotask(() => { (req as { result: T }).result = result(); req.onsuccess?.(); });
    return req;
  };
  const store = {
    get: (k: IDBValidKey) => request(() => { reads.files++; return files.get(k); }),
    getKey: (k: IDBValidKey) => request(() => (files.has(k) ? k : undefined)),
    put: (v: unknown, k: IDBValidKey) => request(() => { files.set(k, v); return k; }),
    delete: (k: IDBValidKey) => request(() => { files.delete(k); return undefined; }),
  };
  const db = { transaction: () => ({ objectStore: () => store }) };
  const open = () => {
    const req = { result: db } as unknown as IDBOpenDBRequest & { onsuccess?: () => void };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };
  return { idb: { open } as unknown as IDBFactory, reads };
}

describe("manual files kept on this device", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("checks a file is there without loading it, and doesn't hold files in memory once saved", async () => {
    const { idb, reads } = fakeIndexedDb();
    vi.stubGlobal("indexedDB", idb);
    const cache = await import("../src/manuals/cache");
    const pdf = new ArrayBuffer(8);
    await cache.putCopy("m1", pdf);
    expect(await cache.hasCopy("m1")).toBe(true);
    expect(await cache.hasCopy("m2")).toBe(false);
    expect(reads.files).toBe(0);
    // Opening it reads it from the device each time instead of keeping a copy.
    expect(await cache.getCopy("m1")).toBe(pdf);
    expect(reads.files).toBe(1);
    await cache.getCopy("m1");
    expect(reads.files).toBe(2);
    await cache.dropCopy("m1");
    expect(await cache.hasCopy("m1")).toBe(false);
  });

  it("keeps files in memory where the device can't store them", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const cache = await import("../src/manuals/cache");
    const pdf = new ArrayBuffer(8);
    await cache.putCopy("m1", pdf);
    expect(await cache.hasCopy("m1")).toBe(true);
    expect(await cache.getCopy("m1")).toBe(pdf);
  });
});
