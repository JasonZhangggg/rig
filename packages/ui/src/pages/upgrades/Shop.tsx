// The Upgrades tab of My PC: Rig's pick, then parts of each kind checked
// against the parts Rig read, with prices and a list to build. The prices are
// demo data until Rig has a shop feed, and every price on screen says so.

import { useEffect, useMemo, useState } from "react";
import { categoryState, drawWith, fitOf, gainOf, psuFor, shopCategories, type Fit, type HardwareFacts, type Shop, type ShopCategory, type ShopItem } from "@rig/core";
import { useApp } from "../../state";
import { issueGo } from "../shared";
import { useUpgrades } from "./PCUpgrades";

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

const fitChip: Record<Fit["verdict"], JSX.Element> = {
  fits: <span className="chip ok">Fits</span>,
  check: <span className="chip warn">Check first</span>,
  no: <span className="chip bad">Won't fit</span>,
};

/** The upgrade idea's part as a kind of part on this tab. */
const catOfIdea: Record<string, ShopCategory> = { Memory: "memory", Storage: "storage", Cooling: "fans", Processor: "cpu", "Graphics card": "gpu" };

const closedWord: Partial<Record<ShopCategory, string>> = { memory: "memory", gpu: "graphics", cpu: "processor" };
const andList = (l: string[]) => (l.length < 2 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`);

type Sort = "rig" | "low" | "high";
const verdictRank = { fits: 0, check: 1, no: 2 };

interface Prefs { list: string[]; psuW?: number }

/** The person's list and power supply wattage, kept on this device per PC. */
function usePrefs(pcId: string) {
  const key = `rig.shop.${pcId}`;
  const read = (): Prefs => { try { return { list: [], ...JSON.parse(localStorage.getItem(key) ?? "{}") }; } catch { return { list: [] }; } };
  const [prefs, setPrefs] = useState<Prefs>(read);
  useEffect(() => setPrefs(read()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (p: Prefs) => { setPrefs(p); try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* storage unavailable */ } };
  return {
    prefs,
    toggle: (id: string) => save({ ...prefs, list: prefs.list.includes(id) ? prefs.list.filter((x) => x !== id) : [...prefs.list, id] }),
    clear: () => save({ ...prefs, list: [] }),
    setPsu: (w?: number) => save({ ...prefs, psuW: w }),
  };
}

function useShop() {
  const { pc, client } = useApp();
  const [got, setGot] = useState<{ id: string; shop: Shop | null; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    client.shop(pc.id).then((shop) => live && setGot({ id: pc.id, shop, failed: false }), () => live && setGot({ id: pc.id, shop: null, failed: true }));
    return () => { live = false; };
  }, [client, pc.id]);
  return got?.id === pc.id ? got : null;
}

export function UpgradesTab() {
  const { pc, ui, set } = useApp();
  const got = useShop();
  const ups = useUpgrades();
  const store = usePrefs(pc.id);
  const { prefs } = store;
  if (!got) return <p className="muted" role="status">Looking at what fits {pc.name}…</p>;
  if (!got.shop) return <p className="muted">{got.failed ? "Couldn't load parts just now." : `Rig hasn't read ${pc.name}'s parts yet. Parts that fit show up once it has.`}</p>;
  const { facts, items, demo } = got.shop;
  const states = shopCategories.map((c) => categoryState(c.key, facts, prefs.psuW));
  const open = states.filter((s) => s.open);
  // A laptop's cooler, fans and charger aren't upgrades, so only the parts people expect to swap are named.
  const closed = states.filter((s) => !s.open && closedWord[s.key]);
  const pickCat = ups.pick && catOfIdea[ups.pick.idea.part];
  const cat = ui.shopCat === "list" ? "list" : open.find((s) => s.key === ui.shopCat)?.key ?? pickCat ?? open[0]?.key;
  const listed = prefs.list.map((id) => items.find((i) => i.id === id)).filter((x): x is ShopItem => !!x);
  const total = listed.reduce((n, i) => n + i.offers[0].price, 0);
  const pick = (k: string) => set({ shopCat: k });
  return (
    <div className="shop">
      <Lead facts={facts} onShow={pickCat ? () => pick(pickCat) : undefined} pickText={ups.pick} />
      <div className="shop-grid">
        <nav className="shop-rail" aria-label="Kinds of part">
          <ul>
            {open.map((s) => (
              <li key={s.key}>
                <button type="button" aria-current={cat === s.key ? "true" : undefined} onClick={() => pick(s.key)}>
                  <span className="shop-rail-l">{s.label}</span>
                  <span className="shop-rail-have">{s.have}</span>
                </button>
              </li>
            ))}
          </ul>
          {closed.length > 0 && <p className="faint shop-closed">Built into {pc.name}'s board, so not upgradable: {andList(closed.map((s) => closedWord[s.key]!))}.</p>}
          <button type="button" className="shop-rail-list" aria-current={cat === "list" ? "true" : undefined} onClick={() => pick("list")}>
            <span className="shop-rail-l">Your list</span>
            <span className="shop-rail-have">{listed.length ? `${listed.length} ${listed.length === 1 ? "part" : "parts"}, ${money(total)}` : "Nothing yet"}</span>
          </button>
        </nav>
        <div className="shop-main">
          {cat === "list"
            ? <ListView items={listed} facts={facts} store={store} demo={demo} />
            : cat && <CategoryView key={cat} cat={cat} items={items.filter((i) => i.category === cat)} facts={facts} store={store} demo={demo} />}
        </div>
      </div>
    </div>
  );
}

/** The top of the tab: a free fix before any purchase, and the one upgrade Rig would start with. */
function Lead({ facts, onShow, pickText }: { facts: HardwareFacts; onShow?: () => void; pickText: ReturnType<typeof useUpgrades>["pick"] }) {
  const ctx = useApp();
  const { pc, ask } = ctx;
  const free = pc.issues?.find((i) => i.id.startsWith("hz-") && i.fix);
  if (!pickText && !free) return null;
  return (
    <div className="shop-lead">
      {free && (
        <div className="shop-free">
          <span className="label">Free, before you buy anything</span>
          <b>{free.title}</b>
          <span className="muted">{free.body}</span>
          <div><button type="button" className="btn sm" onClick={() => issueGo(free, pc, ctx)}>{free.action}</button></div>
        </div>
      )}
      {pickText && (
        <div className="shop-pick">
          <span className="label">Rig's pick for {facts.name}</span>
          <b>{pickText.idea.title}</b>
          <span className="muted">{pickText.why}</span>
          <div>
            {onShow ? <button type="button" className="btn primary sm" onClick={onShow}>Show parts that fit</button>
              : <button type="button" className="btn primary sm" onClick={() => ask(`${pickText.idea.title}: what exactly should I buy for ${pc.name}?`)}>Ask what to buy</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function DemoNote() {
  return <p className="shop-demo" role="note"><span className="chip info no-dot">Demo prices</span>Made-up prices from made-up shops, to show how this will work. Rig has no shop feed yet.</p>;
}

type Store = ReturnType<typeof usePrefs>;

function CategoryView({ cat, items, facts, store, demo }: { cat: ShopCategory; items: ShopItem[]; facts: HardwareFacts; store: Store; demo: boolean }) {
  const psuW = store.prefs.psuW;
  const st = categoryState(cat, facts, psuW);
  const [onlyFits, setOnlyFits] = useState(true);
  const [sort, setSort] = useState<Sort>("rig");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(() => {
    const r = items.map((i) => ({ i, fit: fitOf(i, facts, psuW) }));
    const shown = onlyFits ? r.filter((x) => x.fit.verdict !== "no") : r;
    return shown.sort((a, b) => sort === "low" ? a.i.offers[0].price - b.i.offers[0].price
      : sort === "high" ? b.i.offers[0].price - a.i.offers[0].price
      : verdictRank[a.fit.verdict] - verdictRank[b.fit.verdict] || a.i.offers[0].price - b.i.offers[0].price);
  }, [items, facts, psuW, onlyFits, sort]);
  const hidden = items.length - rows.length;
  return (
    <section aria-labelledby="shop-cat-h">
      <div className="shop-cat-head">
        <h2 id="shop-cat-h">{st.label}</h2>
        <p className="muted">{headLine(cat, facts, st.have, st.room)}</p>
      </div>
      {(cat === "psu" || cat === "gpu") && <PsuAsk facts={facts} store={store} />}
      <div className="shop-tools">
        <label className="shop-check"><input type="checkbox" checked={onlyFits} onChange={(e) => setOnlyFits(e.target.checked)} />Only parts that could fit</label>
        <label className="shop-sort">Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="rig">Best fit first</option>
            <option value="low">Lowest price</option>
            <option value="high">Highest price</option>
          </select>
        </label>
      </div>
      {demo && <DemoNote />}
      <ul className="shop-list" aria-label={`${st.label} that could go in ${facts.name}`}>
        {rows.map(({ i, fit }) => (
          <ItemRow key={i.id} item={i} fit={fit} facts={facts} open={openId === i.id} onToggle={() => setOpenId(openId === i.id ? null : i.id)}
            inList={store.prefs.list.includes(i.id)} onList={() => store.toggle(i.id)} demo={demo} />
        ))}
      </ul>
      {hidden > 0 && <button type="button" className="linkish shop-hidden" onClick={() => setOnlyFits(false)}>Show {hidden} that won't fit</button>}
    </section>
  );
}

/** What the PC has of this kind now, or what Rig can't see of it. */
function headLine(cat: ShopCategory, f: HardwareFacts, have: string, room?: string) {
  if (cat === "cooler") return `Windows can't see which cooler ${f.name} has. Rig checks each one fits the ${f.cpu.socket ?? "processor's"} socket, and its size is yours to check.`;
  if (cat === "fans") return `Windows can't see ${f.name}'s free fan mounts, so each fan is yours to check against the case.`;
  if (cat === "psu") return `${f.name} draws about ${f.draw.total} W at full load, estimated from its processor, graphics card and the rest.`;
  return `${f.name} has ${have}${room ? `. ${room}` : ""}.`;
}

/** Windows can't see the power supply, so Rig asks for its wattage once. */
function PsuAsk({ facts, store }: { facts: HardwareFacts; store: Store }) {
  const w = store.prefs.psuW;
  const [val, setVal] = useState(w ? String(w) : "");
  const [editing, setEditing] = useState(!w);
  if (!editing && w) {
    const ok = w >= psuFor(facts.draw.total);
    return (
      <div className="callout shop-psu">
        <span>Your power supply: <b>{w} W</b>. {ok ? `That covers ${facts.name}'s estimated ${facts.draw.total} W.` : `Rig would want ${psuFor(facts.draw.total)} W for ${facts.name}'s estimated ${facts.draw.total} W.`}</span>
        <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Change</button>
      </div>
    );
  }
  const n = Number(val);
  const valid = Number.isFinite(n) && n >= 200 && n <= 2000;
  return (
    <form className="callout shop-psu" onSubmit={(e) => { e.preventDefault(); if (valid) { store.setPsu(Math.round(n)); setEditing(false); } }}>
      <label htmlFor="psu-w">Windows can't see the power supply. What wattage is yours? It's on the label on its side.</label>
      <span className="shop-psu-in">
        <input id="psu-w" className="input" inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d]/g, ""))} placeholder="750" aria-describedby="psu-unit" />
        <span id="psu-unit" className="faint">W</span>
        <button type="submit" className="btn sm" disabled={!valid}>Save</button>
        {w && <button type="button" className="btn ghost sm" onClick={() => { setVal(String(w)); setEditing(false); }}>Cancel</button>}
      </span>
    </form>
  );
}

function ItemRow({ item, fit, facts, open, onToggle, inList, onList, demo }: { item: ShopItem; fit: Fit; facts: HardwareFacts; open: boolean; onToggle: () => void; inList: boolean; onList: () => void; demo: boolean }) {
  const { ask } = useApp();
  // What a part would add means nothing when it can't go in.
  const gain = fit.verdict === "no" ? null : gainOf(item, facts);
  const low = item.offers[0];
  const id = `shop-${item.id}`;
  return (
    <li className={`shop-item${open ? " is-open" : ""}`}>
      <div className="shop-row">
        <button type="button" className="shop-row-main" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span className="shop-name"><b>{item.name}</b><span className="muted">{gain ?? item.spec}</span></span>
          {fitChip[fit.verdict]}
          <span className="shop-price"><b className="num">{money(low.price)}</b><span className="faint">{demo ? "demo price" : low.shop}</span></span>
          <svg className="shop-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button type="button" className="btn sm shop-add" aria-pressed={inList} onClick={onList} disabled={fit.verdict === "no" && !inList} aria-label={inList ? `Remove ${item.name} from your list` : `Add ${item.name} to your list`}>{inList ? "On your list" : "Add"}</button>
      </div>
      {open && (
        <div className="shop-detail" id={id}>
          <div className="shop-fit">
            <p>{fit.why}</p>
            {fit.also.map((a) => <p key={a} className="muted">{a}</p>)}
            {item.category === "cpu" && <p className="faint">With it, {facts.name} would draw about {drawWith(item, facts)} W at full load.</p>}
          </div>
          <div className="shop-cols">
            <div>
              <span className="label">Prices{demo ? " (demo)" : ""}</span>
              <table className="kv shop-offers"><tbody>
                {item.offers.map((o) => <tr key={o.shop}><th>{o.shop}</th><td className="num">{money(o.price)}</td><td className={o.inStock ? "faint" : "faint shop-out"}>{o.inStock ? "In stock" : "Out of stock"}</td></tr>)}
              </tbody></table>
              <PriceHistory points={item.history} demo={demo} />
            </div>
            <div>
              <span className="label">Specs</span>
              <table className="kv"><tbody>{item.specs.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
            </div>
          </div>
          <div className="shop-actions">
            <button type="button" className="btn sm" onClick={() => ask(`Would the ${item.name} be a good upgrade for ${facts.name}? Rig says: ${fit.why}`)}>Ask Rig about it</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Twelve weeks of the lowest price as a line, with the low and high named. */
function PriceHistory({ points, demo }: { points: number[]; demo: boolean }) {
  const lo = Math.min(...points), hi = Math.max(...points);
  const w = 160, h = 36, pad = 3;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2));
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const now = points[points.length - 1];
  const words = `Lowest price over 12 weeks${demo ? " (demo)" : ""}: low ${money(lo)}, high ${money(hi)}, ${money(now)} now.`;
  return (
    <figure className="shop-hist">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={words}>
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(now)} r="2.6" fill="currentColor" />
      </svg>
      <figcaption className="faint">12 weeks: low {money(lo)}, high {money(hi)}{now === lo ? ". Lowest it's been." : ""}</figcaption>
    </figure>
  );
}

function ListView({ items, facts, store, demo }: { items: ShopItem[]; facts: HardwareFacts; store: Store; demo: boolean }) {
  const { ask } = useApp();
  const psuW = store.prefs.psuW;
  if (!items.length) {
    return (
      <section aria-labelledby="shop-list-h">
        <div className="shop-cat-head"><h2 id="shop-list-h">Your list</h2><p className="muted">Add parts from any kind on the left. Rig adds up the price and checks the power.</p></div>
      </section>
    );
  }
  const total = items.reduce((n, i) => n + i.offers[0].price, 0);
  // Power with every processor and graphics card on the list in place, and any power supply on it.
  const gpu = items.find((i) => i.category === "gpu");
  const cpu = items.find((i) => i.category === "cpu");
  const draw = facts.draw.total - (gpu ? facts.draw.gpu - (gpu.watts ?? 0) : 0) - (cpu ? facts.draw.cpu - (cpu.watts ?? 0) : 0);
  const newPsu = items.find((i) => i.category === "psu")?.is.psuW;
  const supply = newPsu ?? psuW;
  const want = psuFor(draw);
  const power = supply == null ? `About ${draw} W at full load. Tell Rig your power supply's wattage under Power supply to check it.`
    : supply >= want ? `About ${draw} W at full load, well within ${newPsu ? "the new" : "your"} ${supply} W supply.`
    : supply >= draw ? `About ${draw} W at full load. ${newPsu ? "The new" : "Your"} ${supply} W supply is tight; Rig would want ${want} W.`
    : `About ${draw} W at full load, more than ${newPsu ? "the new" : "your"} ${supply} W supply gives.`;
  const text = items.map((i) => `${i.name} (${money(i.offers[0].price)})`).join(", ");
  return (
    <section aria-labelledby="shop-list-h">
      <div className="shop-cat-head">
        <h2 id="shop-list-h">Your list</h2>
        <p className="muted">{items.length} {items.length === 1 ? "part" : "parts"} for {facts.name}.</p>
      </div>
      {demo && <DemoNote />}
      <ul className="shop-list shop-mylist" aria-label="Your list">
        {items.map((i) => {
          const fit = fitOf(i, facts, psuW);
          return (
            <li key={i.id} className="shop-item">
              <div className="shop-row">
                <span className="shop-row-main is-static">
                  <span className="shop-name"><b>{i.name}</b><span className="muted">{fit.why}</span></span>
                  {fitChip[fit.verdict]}
                  <span className="shop-price"><b className="num">{money(i.offers[0].price)}</b></span>
                </span>
                <button type="button" className="btn ghost sm" onClick={() => store.toggle(i.id)} aria-label={`Remove ${i.name}`}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="shop-sum">
        <div className="shop-total"><span className="label">Total{demo ? " (demo prices)" : ""}</span><b className="num">{money(total)}</b></div>
        <p className="muted">{power}</p>
        <div className="shop-actions">
          <button type="button" className="btn primary sm" onClick={() => ask(`Check this upgrade list for ${facts.name}: ${text}. Will it all work together, and what order should I install it in?`)}>Ask Rig to check this list</button>
          <button type="button" className="btn ghost sm" onClick={store.clear}>Clear the list</button>
        </div>
      </div>
    </section>
  );
}
