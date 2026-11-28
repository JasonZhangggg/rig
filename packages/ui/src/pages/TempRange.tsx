import { useMemo } from "react";
import { HOT_MARGIN, formatTemp, headroom, standing, tempZones, usualRange, type Part, type RangePart, type Standing, type TempUnit, type UsualRange, type ZoneId } from "@rig/core";
import { useHistory, useTempUnit } from "../state";
import { dateText } from "../dateText";

/** The parts whose history Rig keeps, so a ribbon can show where they usually sit. */
export const rangePart = (id: string): RangePart | null => (id === "gpu" || id === "cpu" ? id : null);

const zoneWords: Record<ZoneId, string> = { cool: "Cool", normal: "Normal", warm: "Warm", near: "Near the limit" };

/** "today", "yesterday" or the weekday, for when this week's hottest moment was. */
function dayWord(t: number, now = new Date()) {
  const d = new Date(t), y = new Date(now);
  y.setDate(y.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  return same(d, now) ? "today" : same(d, y) ? "yesterday" : dateText(d, { weekday: "long" });
}

/** The headline and the line under it: how the temperature now compares with where this part usually sits. */
export function rangeWords(s: Standing, temp: number, limit: number, r: UsualRange | null, unit: TempUnit): { title: string; sub: string } {
  const t = (c: number) => formatTemp(c, unit);
  const span = (lo: number, hi: number) => (lo === hi ? t(lo) : `${formatTemp(lo, unit, { mark: "none" })} to ${t(hi)}`);
  const games = r?.gaming ?? false;
  const b = r?.busy, rest = r?.resting;
  const inGames = games ? "in games" : "when it's busy";
  const both = rest && b ? `It usually rests at ${span(rest.low, rest.high)} and sits at ${span(b.low, b.high)} ${inGames}.` : "";
  switch (s) {
    case "over": return { title: "Over its limit", sub: `It slows itself down from ${t(limit)} to cool off.` };
    case "near": return { title: "Near its limit", sub: `It slows itself down from ${t(limit)}.` };
    case "above": return { title: `Warmer than usual ${games ? "for a game" : "when busy"}`, sub: `It usually sits at ${span(b!.low, b!.high)} ${inGames}.` };
    case "busy": return { title: games ? "Normal for a game" : "Normal for heavy work", sub: `Where it usually sits ${inGames}: ${span(b!.low, b!.high)}.` };
    case "resting": return { title: "Its usual resting temperature", sub: both || `It usually rests at ${span(rest!.low, rest!.high)}.` };
    case "below": return { title: "Cooler than it usually rests", sub: both || `It usually rests at ${span(rest!.low, rest!.high)}.` };
    case "between": return { title: games ? "Between resting and gaming" : "Between resting and busy", sub: both };
    default: {
      const z = tempZones(limit).find((x) => temp < x.to)?.id ?? "near";
      return { title: zoneWords[z], sub: "Rig shows where it usually sits once it has a few hours of readings." };
    }
  }
}

/**
 * A part's temperature on one ribbon from cool to its limit: the plain zones, where it usually sits at rest and in
 * games over the last week, where it is now, and how much room it has before it slows itself down.
 */
export function TempRange({ part, id }: { part: Part & { temp: number; limit: number }; id: RangePart }) {
  const unit = useTempUnit();
  const history = useHistory("7d");
  const range = useMemo(() => (history?.length ? usualRange(history, id) : null), [history, id]);
  const { temp, limit } = part;
  const t = (c: number) => formatTemp(c, unit);
  const deg = (c: number) => formatTemp(Math.abs(c), unit, { delta: true, mark: "degree" });
  const s = standing(temp, limit, range);
  const words = rangeWords(s, temp, limit, range, unit);
  const room = headroom(temp, limit, range)!;
  const hot = s === "over" || s === "near";
  const peak = range?.peak;

  // The ribbon runs from a little under the coolest thing on it to a little past the limit, so the zone past it shows.
  const coolest = Math.min(35, range?.resting?.low ?? 99, temp);
  const lo = Math.floor((coolest - 5) / 10) * 10 - 5;
  const hi = Math.max(limit + 8, Math.ceil(Math.max(temp, peak?.temp ?? 0)) + 3);
  const at = (c: number) => `${((Math.min(hi, Math.max(lo, c)) - lo) / (hi - lo)) * 100}%`;
  const width = (a: number, b: number) => `${((Math.min(hi, b) - Math.max(lo, a)) / (hi - lo)) * 100}%`;
  const zones = tempZones(limit, lo).map((z) => (z.id === "near" ? { ...z, to: hi } : z));
  const ticks: number[] = [];
  for (let c = Math.ceil(lo / 10) * 10; c < hi; c += 10) if (Math.abs(c - limit) > 3) ticks.push(c);

  const nowLeft = at(temp);
  const label = [
    `Now ${t(temp)}.`,
    range?.busy && `Usually ${t(range.busy.low)} to ${t(range.busy.high)} ${range.gaming ? "in games" : "when busy"}.`,
    range?.resting && `Usually ${t(range.resting.low)} to ${t(range.resting.high)} at rest.`,
    `It slows itself down from ${t(limit)}.`,
  ].filter(Boolean).join(" ");

  return (
    <section className={`trange${hot ? " is-hot" : ""}`} aria-label="Temperature">
      <div className="trange-top">
        <div className="trange-now">
          <span className="label">Temperature</span>
          <span key={Math.round(temp)} className="trange-big live-tick">{t(temp)}</span>
        </div>
        <div className={`trange-room${room.degrees < 0 ? " is-over" : ""}`}>
          <p className="trange-fig"><b>{deg(room.degrees)}</b> {room.degrees < 0 ? "over its limit" : "to spare"}</p>
          <p className="trange-why">
            {room.from === "week"
              ? `At this week's hottest, ${dayWord(room.at!)}${room.game ? ` in ${room.game}` : ""}.`
              : "Right now."}{" "}
            It slows itself down from {t(limit)}.
          </p>
        </div>
      </div>

      <div className="trange-head">
        <h2 className="trange-title">{words.title}</h2>
        {words.sub && <p className="trange-sub">{words.sub}</p>}
      </div>

      <div className="trange-ribbon" role="img" aria-label={label}>
        <div className="trange-pin" style={{ left: nowLeft }} aria-hidden="true"><span>Now</span></div>
        <div className="trange-track" aria-hidden="true">
          {range?.resting && <i className="trange-band rest" style={{ left: at(range.resting.low), width: width(range.resting.low, Math.max(range.resting.high, range.resting.low + 1)) }} />}
          {range?.busy && <i className="trange-band busy" style={{ left: at(range.busy.low), width: width(range.busy.low, Math.max(range.busy.high, range.busy.low + 1)) }} />}
          <i className="trange-past" style={{ left: at(limit), width: width(limit, hi) }} />
          {peak && <i className={`trange-peak${peak.temp >= limit - HOT_MARGIN ? " is-hot" : ""}`} style={{ left: at(peak.temp) }} />}
          <i className="trange-mark" style={{ left: nowLeft }} />
        </div>
        <div className="trange-ticks" aria-hidden="true">
          {ticks.map((c) => <span key={c} style={{ left: at(c) }}>{formatTemp(c, unit, { mark: "degree" })}</span>)}
          <span className="is-limit" style={{ left: at(limit) }}>{formatTemp(limit, unit, { mark: "degree" })}</span>
        </div>
        <div className="trange-zones" aria-hidden="true">
          {zones.map((z) => <span key={z.id} className={`trange-zone ${z.id}`} style={{ left: at(z.from), width: width(z.from, z.to) }}>{zoneWords[z.id]}</span>)}
        </div>
      </div>

      {range && (range.busy || range.resting || peak) && (
        <dl className="trange-key">
          {peak && <div><dt><i className={`peak${peak.temp >= limit - HOT_MARGIN ? " is-hot" : ""}`} />Hottest this week</dt><dd>{t(peak.temp)}{peak.at ? `, ${dayWord(peak.at)}` : ""}</dd></div>}
          {range.busy && <div><dt><i className="busy" />{range.gaming ? "Usual in games" : "Usual when busy"}</dt><dd>{formatTemp(range.busy.low, unit, { mark: "none" })} to {t(range.busy.high)}{room.typical != null && room.typical > 0 ? ` · ${deg(room.typical)} to spare` : ""}</dd></div>}
          {range.resting && <div><dt><i className="rest" />Usual at rest</dt><dd>{formatTemp(range.resting.low, unit, { mark: "none" })} to {t(range.resting.high)}</dd></div>}
        </dl>
      )}
    </section>
  );
}
