import { describe, expect, it } from "vitest";
import { demoCatalog, type Shop } from "@rig/core";
import { bestBuyFeed } from "../src/retail";
import type { Fetch } from "../src/manuals";
import { setup, syncPayload } from "./helpers";

const noWait = async () => {};

// A stand-in for Best Buy's Products API: a few real-looking listings, plus decoys.
const listings = [
  { sku: 1, name: "CORSAIR - VENGEANCE 32GB (2PK x 16GB) 6000MHz DDR5 C30 DIMM Desktop Memory - Black", manufacturer: "CORSAIR", salePrice: 107.99, onlineAvailability: true, url: "https://www.bestbuy.com/site/1.p", image: "https://pisces.bbystatic.com/image2/1.jpg" },
  { sku: 2, name: "CORSAIR - VENGEANCE 64GB (2PK x 32GB) 6000MHz DDR5 C30 DIMM Desktop Memory - Black", manufacturer: "CORSAIR", salePrice: 194.99, onlineAvailability: false, url: "https://www.bestbuy.com/site/2.p", image: "https://evil.example.com/2.jpg" },
  { sku: 3, name: "NVIDIA - GeForce RTX 5070 Ti 16GB GDDR7 Graphics Card", manufacturer: "NVIDIA", salePrice: 749.99, onlineAvailability: true, url: "https://www.bestbuy.com/site/3.p", image: "https://pisces.bbystatic.com/image2/3.jpg" },
  { sku: 4, name: "Samsung - 990 PRO 2TB Internal SSD PCIe Gen 4x4 NVMe", manufacturer: "Samsung", salePrice: 169.99, onlineAvailability: true, url: "https://bestbuy.com.example.net/4", image: "https://pisces.bbystatic.com/image2/4.jpg" },
];

function standIn() {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    calls.push(url);
    const terms = [...decodeURIComponent(url).matchAll(/search=([^&)]+)/g)].map((m) => m[1]);
    const products = listings.filter((p) => terms.every((t) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(t) || p.manufacturer.toLowerCase().includes(t)));
    return Response.json({ products });
  };
  return { fetch, calls };
}

describe("Best Buy feed", () => {
  it("finds the same part, never a bigger kit or another variant, and keeps only Best Buy links and photos", async () => {
    const { fetch } = standIn();
    const feed = bestBuyFeed("k", fetch, noWait);
    const now = new Date("2026-11-19T12:00:00Z");
    await feed.get(now).refresh;
    const { hits } = feed.get(now);
    expect(hits.get("m-vengeance-32")).toMatchObject({ shop: "Best Buy", price: 107.99, inStock: true, url: "https://www.bestbuy.com/site/1.p", image: "https://pisces.bbystatic.com/image2/1.jpg" });
    // The photo isn't on Best Buy's image host, so the listing comes without it.
    expect(hits.get("m-vengeance-64")).toMatchObject({ price: 194.99, inStock: false });
    expect(hits.get("m-vengeance-64")!.image).toBeUndefined();
    // A 5070 Ti listing is not a 5070.
    expect(hits.get("g-5070ti")).toMatchObject({ price: 749.99 });
    expect(hits.get("g-5070")).toBeUndefined();
    // A link that only looks like Best Buy's is refused.
    expect(hits.get("s-990pro-2")).toBeUndefined();
  });

  it("asks once per part, then again only after 12 hours", async () => {
    const { fetch, calls } = standIn();
    const feed = bestBuyFeed("secret-key", fetch, noWait);
    const t0 = new Date("2026-11-19T12:00:00Z");
    await feed.get(t0).refresh;
    expect(calls).toHaveLength(demoCatalog.length);
    expect(calls.every((u) => u.startsWith("https://api.bestbuy.com/v1/products(search="))).toBe(true);
    expect(feed.get(new Date(t0.getTime() + 11 * 3_600_000)).refresh).toBeUndefined();
    const later = new Date(t0.getTime() + 12 * 3_600_000);
    expect(feed.get(later).hits.size).toBe(0);
    await feed.get(later).refresh;
    expect(calls).toHaveLength(demoCatalog.length * 2);
  });

  it("keeps going when Best Buy fails, and tries again in an hour", async () => {
    let fail = true;
    const { fetch: ok } = standIn();
    const fetch: Fetch = async (u, i) => (fail ? new Response("busy", { status: 403 }) : ok(u, i));
    const feed = bestBuyFeed("k", fetch, noWait);
    const t0 = new Date("2026-11-19T12:00:00Z");
    await feed.get(t0).refresh;
    expect(feed.get(t0).hits.size).toBe(0);
    fail = false;
    const t1 = new Date(t0.getTime() + 3_600_000);
    await feed.get(t1).refresh;
    expect(feed.get(t1).hits.has("m-vengeance-32")).toBe(true);
  });
});

describe("the Upgrades route with a Best Buy key", () => {
  it("adds Best Buy's listings, leaves the rest as demo, and never sends the key to the app", async () => {
    const { fetch } = standIn();
    const { call, signUp } = await setup({ BESTBUY_API_KEY: "secret-key" }, undefined, fetch, noWait);
    const cookie = await signUp("ana@example.com");
    const s = await syncPayload();
    await call(`/api/machines/${s.inventory.machine.id}/sync`, { method: "PUT", json: s, cookie });
    const res = await call(`/api/machines/${s.inventory.machine.id}/shop`, { cookie });
    const text = await res.text();
    expect(text).not.toContain("secret-key");
    const shop = JSON.parse(text) as Shop;
    expect(shop.retailFrom).toBe("Best Buy");
    expect(shop.demo).toBe(true);
    expect(shop.items.find((i) => i.id === "m-vengeance-32")!.retail).toMatchObject({ price: 107.99 });
    expect(shop.items.find((i) => i.id === "f-nfa12")!.retail).toBeUndefined();
  });

  it("without a key, asks Best Buy nothing", async () => {
    const { fetch, calls } = standIn();
    const { call, signUp } = await setup({}, undefined, fetch, noWait);
    const cookie = await signUp("bo@example.com");
    const s = await syncPayload();
    await call(`/api/machines/${s.inventory.machine.id}/sync`, { method: "PUT", json: s, cookie });
    const shop = await (await call(`/api/machines/${s.inventory.machine.id}/shop`, { cookie })).json() as Shop;
    expect(shop.retailFrom).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
