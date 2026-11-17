import type { DiffRow } from "@rig/core";

export const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export const StatusChip = ({ status }: { status: "applied" | "undone" }) =>
  status === "applied" ? <span className="chip ok">Applied</span> : <span className="chip">Undone</span>;

export function DiffTable({ rows }: { rows: DiffRow[] }) {
  return (
    <table className="diff">
      <thead><tr><th>Setting</th><th>Now</th><th className="arrow" /><th>After</th></tr></thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k}><td>{k}</td><td className="before">{a}</td><td className="arrow">→</td><td className="after">{b}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function Ring({ value }: { value: number }) {
  const c = 2 * Math.PI * 32;
  return (
    <svg className="ring" viewBox="0 0 76 76" role="img" aria-label={`Health ${value} out of 100`}>
      <circle cx="38" cy="38" r="32" fill="none" strokeWidth="7" className="track" />
      <circle cx="38" cy="38" r="32" fill="none" strokeWidth="7" className="val" strokeDasharray={`${(c * value) / 100} ${c}`} />
      <text x="38" y="45" textAnchor="middle">{value}</text>
    </svg>
  );
}
