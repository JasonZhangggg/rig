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

