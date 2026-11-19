// Real listings for the Upgrades tab from Best Buy's Products API, when the
// server has a key (BESTBUY_API_KEY). Each part in Rig's catalog is looked up
// by its maker and model, and a listing counts only when its name holds the
// same model and size (sameRetailPart), so a part never shows another part's
// photo or price. Without a key nothing here runs and every price stays demo.
//
// Best Buy's API terms: content may be kept at most 72 hours (Rig keeps it 12,
// in memory only), the source has to be named where it shows, and the key may
// not be shared, so it stays on the server and the apps never see it.

import { demoCatalog, retailTerms, sameRetailPart, type Retail, type ShopItem } from "@rig/core";
import type { Fetch } from "./manuals";

const hour = 3_600_000;
const keepMs = 12 * hour;
const retryMs = hour;
/** Best Buy allows 5 calls a second; Rig makes 4, then waits a second. */
const perSecond = 4;
const show = "sku,name,manufacturer,salePrice,onlineAvailability,url,image,largeFrontImage,thumbnailImage";

interface BestBuyProduct {
  sku?: number; name?: string; manufacturer?: string; salePrice?: number; onlineAvailability?: boolean;
  url?: string; image?: string; largeFrontImage?: string; thumbnailImage?: string;
}

const hostIs = (u: unknown, domain: string) => {
  if (typeof u !== "string") return false;
  try { const x = new URL(u); return x.protocol === "https:" && (x.hostname === domain || x.hostname.endsWith(`.${domain}`)); } catch { return false; }
};

export interface RetailFeed {
  from: string;
  /** What's known now, and a refresh to run in the background when some of it is old or missing. */
  get(now: Date): { hits: Map<string, Retail>; refresh?: Promise<void> };
}

export function bestBuyFeed(key: string, fetch: Fetch, wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), items: ShopItem[] = demoCatalog): RetailFeed {
  const cache = new Map<string, { hit: Retail | null; until: number }>();
  let running: Promise<void> | null = null;

  async function look(item: ShopItem, now: Date): Promise<Retail | null> {
    const q = retailTerms(item).search.map((w) => `search=${encodeURIComponent(w)}`).join("&");
    const url = `https://api.bestbuy.com/v1/products(${q})?format=json&pageSize=10&show=${show}&apiKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Best Buy answered ${res.status}`);
    const body = (await res.json()) as { products?: BestBuyProduct[] };
    const p = (body.products ?? []).find((p) => typeof p.name === "string" && typeof p.salePrice === "number" && p.salePrice > 0
      && hostIs(p.url, "bestbuy.com") && sameRetailPart(item, p.name, p.manufacturer));
    if (!p) return null;
    const image = [p.largeFrontImage, p.image, p.thumbnailImage].find((u) => hostIs(u, "bbystatic.com"));
    return { shop: "Best Buy", price: p.salePrice!, inStock: !!p.onlineAvailability, url: p.url!, image, checkedAt: now.toISOString() };
  }

  async function refresh(now: Date) {
    const due = items.filter((i) => (cache.get(i.id)?.until ?? 0) <= now.getTime());
    for (let k = 0; k < due.length; k += perSecond) {
      if (k) await wait(1000);
      await Promise.all(due.slice(k, k + perSecond).map(async (i) => {
        try {
          const hit = await look(i, now);
          cache.set(i.id, { hit, until: now.getTime() + keepMs });
        } catch {
          // Try again in an hour. What was found before stays only while it's fresh.
          const old = cache.get(i.id);
          cache.set(i.id, { hit: old?.hit && Date.parse(old.hit.checkedAt) + keepMs > now.getTime() ? old.hit : null, until: now.getTime() + retryMs });
        }
      }));
    }
  }

  return {
    from: "Best Buy",
    get(now) {
      const hits = new Map<string, Retail>();
      for (const [id, e] of cache) if (e.hit && Date.parse(e.hit.checkedAt) + keepMs > now.getTime()) hits.set(id, e.hit);
      const stale = items.some((i) => (cache.get(i.id)?.until ?? 0) <= now.getTime());
      if (stale && !running) running = refresh(now).finally(() => { running = null; });
      return { hits, refresh: running ?? undefined };
    },
  };
}
