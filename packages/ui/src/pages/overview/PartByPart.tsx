import type { CSSProperties } from "react";
import { clearlyHeavy, partByPart, sleepWhenSaid, type BatteryView, type HistoryPoint, type PartRow, type PartsView } from "@rig/core";
import { useApp, useTemp } from "../../state";
import { shortType } from "../shared";
import { isPlaceholderName } from "../partNames";
import { useFit } from "./parts";
import { Go, type TileBox } from "./widgets";

/** Each part in plain words, and what it does for the person. */
const PLAIN: Record<string, { label: string; job: string; laptopJob?: string }> = {
  gpu: { label: "Graphics card", job: "Draws every frame of your games" },
  cpu: { label: "Processor", job: "Runs your games and Windows" },
  ram: { label: "Memory", job: "Keeps what's open close at hand" },
  ssd: { label: "Main drive", job: "Holds Windows, your games and files" },
  motherboard: { label: "Motherboard", job: "Connects every part and shares out power" },
  board: { label: "Motherboard", job: "Connects every part and shares out power" },
  fans: { label: "Fans", job: "Move air through the case", laptopJob: "Keep the laptop cool" },
  battery: { label: "Battery", job: "Runs the laptop away from the wall" },
  psu: { label: "Power supply", job: "Turns wall power into what each part needs" },
  case: { label: "Case", job: "Holds every part and guides the air" },
  chassis: { label: "Laptop", job: "Holds every part" },
};

/** What a part does for the person, in the words for this kind of PC. Logs' part rows say it the same way. */
export const partJob = (id: string, laptop: boolean) => (laptop && PLAIN[id]?.laptopJob) || PLAIN[id]?.job || "";

/** What a battery is doing, in a word or two. */
export const batteryWord: Record<NonNullable<BatteryView["state"]>, string> = { discharging: "On battery", charging: "Charging", plugged: "Plugged in" };

/** A model without the chip maker's brand words, which the kind of part already says: "RTX 4070 SUPER", "Ryzen 7 7800X3D". */
const shortModel = (name: string) => name.replace(/\((R|TM)\)/gi, "").replace(/^(NVIDIA|AMD|Intel)\s+/i, "").replace(/^GeForce\s+/i, "").replace(/\s+/g, " ").trim();

const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const count = (n: number) => ["No", "One", "Two", "Three", "Four", "Five"][n] ?? String(n);

/** Where a value sits on its part's own scale, as a share from 0 to 100. */
const at = (r: PartRow, v: number) => Math.max(0, Math.min(100, ((v - r.scale.min) / (r.scale.max - r.scale.min)) * 100));

function useFormat() {
  const temp = useTemp();
  /** A reading with its unit, as a sentence would say it. */
  const said = (r: PartRow, v: number) => (r.unit === "temp" ? temp(v, { mark: "degree" }) : r.unit === "percent" ? `${v}%` : `${v.toLocaleString("en-US")} rpm`);
  /** The figure and its unit apart, so the unit can sit small beside it. */
  const parts = (r: PartRow, v: number): [string, string] => (r.unit === "temp" ? [temp(v, { mark: "degree" }), ""] : r.unit === "percent" ? [String(v), "%"] : [v.toLocaleString("en-US"), "rpm"]);
  const range = (r: PartRow, lo: number, hi: number) => {
    if (lo === hi) return said(r, hi);
    return r.unit === "temp" ? `${temp(lo, { mark: "none" })}–${temp(hi, { mark: "degree" })}` : r.unit === "percent" ? `${lo}–${hi}%` : `${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")} rpm`;
  };
  return { said, parts, range };
}

/** A laptop's graphics chip switched off to save power: no reading now, but nothing wrong. */
export const ASLEEP = "Asleep to save power";

/** How the part is doing now, in a word or two, and rust only when it needs a look. */
function stateOf(r: PartRow, asleep: boolean, battery?: BatteryView): { text: string; look?: boolean } {
  if (asleep) return { text: ASLEEP };
  if (r.id === "battery" && r.state !== "unread") return { text: battery?.state ? batteryWord[battery.state] : "Charge left" };
  switch (r.state) {
    case "unread": return { text: "Rig can't read it" };
    case "slowing": return { text: "Slowing itself down", look: true };
    case "hot": return { text: "Running hot", look: true };
    case "design": return { text: "At its limit, as built" };
    case "above": return { text: r.unit === "percent" ? "Fuller than usual" : r.unit === "rpm" ? "Faster than usual" : "Warmer than usual" };
    default: return { text: "Calm" };
  }
}

/** What the week says about the part: its highest, in rust only when that came close to where it slows down. */
function weekOf(r: PartRow, learning: boolean, said: (r: PartRow, v: number) => string, asleep: boolean, battery?: BatteryView): { text: string; look?: boolean } {
  if (asleep && !r.high) return { text: "It wakes when a game needs it" };
  if (r.state === "unread" && !asleep) return { text: r.id === "case" ? "Nothing in it to read" : "No sensor Windows can read" };
  if (r.id === "battery") {
    // A sleep that used a lot says so before the week's lowest: it's the one thing to look at.
    const now = Date.now(), heavy = clearlyHeavy(battery?.sleeps ?? [], now);
    if (heavy) return { text: `Used ${heavy.used}% asleep ${sleepWhenSaid(heavy, now)}`, look: true };
    if (!r.low) return { text: "Rig is still learning its usual" };
    // The charge is already beside the row, so a low that's the charge now isn't said again.
    if (r.now == null || Math.round(r.low.value) !== Math.round(r.now)) return { text: `Lowest ${said(r, r.low.value)} this week` };
    return { text: steady(r) ? "Held there all week" : "Its lowest this week" };
  }
  if (learning || !r.high) return { text: "Rig is still learning its usual" };
  const { value, at: when, game } = r.high;
  if (r.ranHot) return { text: `Hit ${said(r, value)}${game ? ` in ${game}` : ""}, ${dayFmt.format(when)}`, look: true };
  return { text: `${said(r, value)} at most this week` };
}

/** A battery that sat at the same charge all week, like one held at 80% on the charger. */
const steady = (r: PartRow) => r.usual != null && r.now != null && r.usual.lo === r.usual.hi && Math.round(r.usual.hi) === Math.round(r.now);

/** The sentence over the list: how the PC is now, then what the week held. */
function headline(view: PartsView, name: string, online: boolean, laptop: boolean) {
  const label = (r: PartRow) => PLAIN[r.id]?.label.toLowerCase() ?? r.id;
  const slowing = view.rows.filter((r) => r.state === "slowing"), hot = view.rows.filter((r) => r.state === "hot" || r.state === "slowing");
  const above = view.rows.filter((r) => r.state === "above");
  const design = view.rows.filter((r) => r.state === "design");
  const ranHot = view.rows.filter((r) => r.ranHot);
  const doing = view.busyNow == null ? null : view.busyNow ? "working hard" : "resting";
  let title: string;
  if (!online) title = `${name} is offline, so these are its last readings`;
  else if (hot.length) title = `Right now the ${and(hot.map(label))} ${hot.length > 1 ? "are" : "is"} ${slowing.length === hot.length ? "slowing down to stay safe" : "running hot"}`;
  // Only a processor runs at its limit by design, so there's one at most.
  else if (design.length && !above.length) title = `Right now ${name} is ${doing ?? "on"}, and the ${label(design[0])} is at its limit, as built`;
  else if (above.length) title = `Right now ${name} is ${doing ?? "on"}, and the ${and(above.map(label))} ${above.length > 1 ? "are" : "is"} above usual`;
  else title = doing ? `Right now ${name} is ${doing}, and every part is calm` : `Right now every part of ${name} is calm`;
  const now = !online ? "" : view.busyNow === false ? "Nothing heavy is running." : view.busyNow ? "A game or something heavy is running." : "";
  let week: { text: string; look?: boolean };
  if (!view.usualWhen) week = { text: `Rig learns each part's usual from a few days of using ${laptop ? "the laptop" : name}.` };
  else if (ranHot.length === 1) {
    const game = ranHot[0].high?.game;
    week = { text: `One part ran hot this week: the ${label(ranHot[0])}${game ? `, in ${game}` : ""}.`, look: true };
  } else if (ranHot.length) week = { text: `${count(ranHot.length)} parts ran hot this week: the ${and(ranHot.map(label))}.`, look: true };
  else week = { text: "Nothing ran hot this week." };
  return { title, now, week };
}

function Track({ r, asleep }: { r: PartRow; asleep: boolean }) {
  if ((r.state === "unread" && !asleep) || r.unit == null) return <span className="pbp-track none" aria-hidden="true" />;
  const pos = (v: number) => `${at(r, v)}%`;
  return (
    <span className="pbp-track" aria-hidden="true">
      {r.limit != null && r.limit < r.scale.max && <i className="pbp-zone" style={{ left: pos(r.limit) }} />}
      {r.usual && <i className="pbp-band" style={{ left: pos(r.usual.lo), width: `max(4px, ${at(r, r.usual.hi) - at(r, r.usual.lo)}%)` } as CSSProperties} />}
      {r.high && <i className={`pbp-high${r.ranHot ? " look" : ""}`} style={{ left: pos(r.high.value) }} />}
      {r.now != null && <i className={`pbp-dot${r.state === "hot" || r.state === "slowing" ? " look" : ""}`} style={{ left: pos(r.now) }} />}
    </span>
  );
}

/** Home's PC widget as a calm list: one row per part, with its reading now against its own usual and its limit. */
export function PartByPart({ points, names, box }: { points: HistoryPoint[] | null; names: boolean; box: TileBox }) {
  const { pc, set, go, ask } = useApp();
  const fmt = useFormat();
  const view = partByPart(pc, points ?? []);
  const loading = points == null;
  const laptop = pc.kind === "laptop";
  const head = headline(view, pc.name, pc.online, laptop);
  const [list, fits] = useFit<HTMLUListElement>(view.rows.length, { on: box.cols > 1, reserve: 36, watch: `${names}${loading}` });
  const rest = view.rows.length - fits;
  const open = (id: string) => { set({ selected: id, tab: "live" }); go("pc"); };
  const usualWord = view.usualWhen === "any" ? "Its usual this week" : view.usualWhen === "busy" ? "Its usual when busy" : "Its usual while you play";
  return (
    <section className="f-pbp" aria-labelledby="f-pbp-title">
      <div className="pbp-head">
        <div>
          <div className="f-kicker">{pc.name}, part by part</div>
          <h2 id="f-pbp-title">{head.title}</h2>
          <p>{head.now && <>{head.now} </>}{!loading && <span className={head.week.look ? "look" : undefined}>{head.week.text}</span>}</p>
        </div>
        <button type="button" className="f-link" onClick={() => ask(`What's normal for each part of ${pc.name}, and how close does it get to its limits?`)}>What's normal?<Go /></button>
      </div>
      <div className="pbp-cols" aria-hidden="true"><span>Part, and what it does for you</span><span>Now</span><span>This week</span><span>How it's doing</span></div>
      <ul className="pbp-list" ref={list} aria-label="Parts">
        {view.rows.slice(0, fits).map((r) => {
          const p = pc.parts![r.id];
          const plain = PLAIN[r.id] ?? { label: shortType(p.type), job: "" };
          const model = names && !isPlaceholderName(p.name) ? shortModel(p.model ?? p.name) : null;
          // Asleep, the part keeps its week: the usual band and highest from when it last worked.
          const asleep = r.now == null && !!p.asleep;
          const state = stateOf(r, asleep, pc.battery), week = loading && (r.state !== "unread" || asleep) ? null : weekOf(r, !view.usualWhen, fmt.said, asleep, pc.battery);
          const [num, unit] = r.now != null ? fmt.parts(r, r.now) : ["–", ""];
          return (
            <li key={r.id}>
              <button type="button" className={`pbp-row${r.state === "unread" && !asleep ? " unread" : ""}`} onClick={() => open(r.id)}>
                <span className="pbp-name">
                  <b>{plain.label}{model && <small> {model}</small>}</b>
                  <span>{partJob(r.id, laptop) || plain.job}</span>
                </span>
                <span className="pbp-now">
                  <b>{num}{unit && <small>{unit === "rpm" ? ` ${unit}` : unit}</small>}</b>
                </span>
                <span className="pbp-week">
                  <Track r={r} asleep={asleep} />
                  {r.usual && !(r.id === "battery" && steady(r)) && <span>usual {fmt.range(r, r.usual.lo, r.usual.hi)}</span>}
                </span>
                <span className="pbp-state">
                  <b className={state.look ? "look" : undefined}>{state.text}</b>
                  {week && <span className={week.look ? "look" : undefined}>{week.text}</span>}
                </span>
              </button>
            </li>
          );
        })}
        {rest > 0 && (
          <li data-more="" className="f-more">
            <a className="f-link" href="#pc">{rest === 1 ? "One more part" : `${rest} more parts`}<Go /></a>
          </li>
        )}
      </ul>
      <div className="pbp-key" aria-hidden="true">
        <span><i className="k-now" />Now</span>
        <span><i className="k-high" />Highest this week</span>
        {view.usualWhen && <span><i className="k-band" />{usualWord}</span>}
        <span><i className="k-zone" />Where it slows itself down</span>
        <span className="pbp-scale">Each bar is that part's own scale</span>
      </div>
    </section>
  );
}
