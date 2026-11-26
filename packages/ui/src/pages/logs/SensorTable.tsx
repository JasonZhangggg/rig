import { useMemo, useState } from "react";
import { findReadings, sensorGroups, type Recorded, type SensorType } from "@rig/core";
import { useTemp } from "../../state";

type Temp = ReturnType<typeof useTemp>;

/** A reading in its unit, the way a hardware monitor shows it. */
export function reading(temp: Temp, type: SensorType, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "–";
  switch (type) {
    case "temperature": return temp(v);
    case "load": case "level": case "control": return `${Math.round(v)}%`;
    case "fan": return `${Math.round(v).toLocaleString("en-US")} rpm`;
    case "clock": return v >= 1000 ? `${(v / 1000).toFixed(2)} GHz` : `${Math.round(v)} MHz`;
    case "power": return `${v.toFixed(1)} W`;
    case "voltage": return `${v.toFixed(3)} V`;
    case "data": return v >= 1000 ? `${(v / 1000).toFixed(1)} TB` : `${v.toFixed(1)} GB`;
    case "throughput": return v >= 1e9 ? `${(v / 1e9).toFixed(2)} GB/s` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB/s` : `${Math.round(v / 1e3)} KB/s`;
    case "current": return `${v.toFixed(2)} A`;
  }
}

/** Each sensor's newest, lowest and highest reading between two times. */
function stats(r: Recorded, from: number, to: number) {
  const out = r.sensors.map(() => ({ last: null as number | null, min: Infinity, max: -Infinity }));
  for (const p of r.points) {
    if (p.t < from || p.t > to) continue;
    p.v.forEach((v, i) => {
      if (v == null) return;
      const s = out[i];
      s.last = v;
      if (v < s.min) s.min = v;
      if (v > s.max) s.max = v;
    });
  }
  return out.map((s) => ({ last: s.last, min: s.last == null ? null : s.min, max: s.last == null ? null : s.max }));
}

/**
 * Every sensor as rows, like a hardware monitor: grouped by part, then by kind, each with its newest reading and its
 * lowest and highest over the stretch. A search narrows it to the sensors that match.
 */
export function SensorTable({ r, from, to, limits, live }: { r: Recorded; from: number; to: number; limits: { cpu?: number; gpu?: number }; live?: boolean }) {
  const temp = useTemp();
  const [query, setQuery] = useState("");
  const all = useMemo(() => stats(r, from, to), [r, from, to]);
  const found = useMemo(() => {
    const list = r.sensors.map((s, i) => ({ ...s, i }));
    return new Set((query.trim() ? findReadings(list, query) : list).map((s) => s.i));
  }, [r.sensors, query]);
  const parts = r.parts.map((p) => ({
    p,
    kinds: sensorGroups.map(([type, title]) => ({ type, title, rows: p.sensors.filter((i) => found.has(i) && r.sensors[i].type === type) })).filter((k) => k.rows.length),
  })).filter((g) => g.kinds.length);
  const shown = parts.reduce((n, g) => n + g.kinds.reduce((m, k) => m + k.rows.length, 0), 0);
  const near = (part: string, type: SensorType, v: number | null) => {
    const limit = part === "gpu" ? limits.gpu : part === "cpu" ? limits.cpu : undefined;
    return type === "temperature" && v != null && limit != null && v >= limit - 6;
  };

  return (
    <div className="st">
      <div className="st-find">
        <input type="search" className="input" placeholder="Find a sensor, like core 3" aria-label="Find a sensor" value={query} onChange={(e) => setQuery(e.target.value)} />
        <span className="faint num" aria-live="polite">{query.trim() ? `${shown} of ${r.sensors.length}` : `${r.sensors.length} sensors`}</span>
      </div>
      {parts.length === 0 ? <p className="muted st-none">No sensor matches “{query.trim()}”. Try a part, like processor, a kind, like voltage, or a sensor, like core 3.</p> : (
        <table className="st-table" aria-label="Every sensor">
          <thead><tr><th scope="col">Sensor</th><th scope="col">{live ? "Now" : "Last"}</th><th scope="col">Lowest</th><th scope="col">Highest</th></tr></thead>
          {parts.map(({ p, kinds }) => (
            <tbody key={p.id} aria-label={p.name}>
              <tr className="st-part"><th scope="rowgroup" colSpan={4}>{p.name}</th></tr>
              {kinds.map((k) => [
                <tr key={k.type} className="st-kind"><th scope="rowgroup" colSpan={4}>{k.title}</th></tr>,
                ...k.rows.map((i) => {
                  const s = r.sensors[i], v = all[i];
                  return (
                    <tr key={s.id}>
                      <th scope="row">{s.name}</th>
                      <td className="num">{reading(temp, s.type, v.last)}</td>
                      <td className="num faint">{reading(temp, s.type, v.min)}</td>
                      <td className={`num${near(p.id, s.type, v.max) ? " look" : " faint"}`}>{reading(temp, s.type, v.max)}</td>
                    </tr>
                  );
                }),
              ])}
            </tbody>
          ))}
        </table>
      )}
    </div>
  );
}
