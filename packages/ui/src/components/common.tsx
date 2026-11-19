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


/** The mark beside a reading that runs warm, so warm doesn't rest on color alone. */
export const Warm = () => (
  <span className="warm-mark"><svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M5 1.5 9 8.5H1z" fill="currentColor" /></svg><span className="sr-only">, running warm</span></span>
);
