import { useState } from "react";
import type { DiffRow, Proposal } from "@rig/core";
import { DiffTable } from "../common";

export interface FixCardProps {
  title: string;
  rows: DiffRow[];
  /** How many fixes the card makes. */
  count: number;
  status: Proposal["status"];
  onReview: () => Promise<void> | void;
  onDecline: () => void;
}

/** Rig's own fixes: the settings that change, as rows. The review sheet is the second look. */
export function FixCard({ title, rows, count, status, onReview, onDecline }: FixCardProps) {
  const [reading, setReading] = useState(false);
  return (
    <div className="proposal">
      <div className="proposal-head">
        <h3>{title}</h3>
        {status === "applied" ? <span className="chip ok">Applied</span> : status === "declined" ? <span className="chip">Not now</span> : <span className="chip info">Waiting for you</span>}
      </div>
      <DiffTable rows={rows} />
      <div className="proposal-foot">
        <span className="faint">{count === 1 ? "1 change" : `${count} changes`} · undo anytime</span>
        {status === "applied" ? <a className="btn ghost sm" href="#changes">View in Changes</a> : status === "declined" ? null : (
          <>
            <button className="btn ghost sm" type="button" disabled={reading} onClick={onDecline}>Not now</button>
            <button className="btn primary sm" type="button" disabled={reading} onClick={() => { setReading(true); void Promise.resolve(onReview()).finally(() => setReading(false)); }}>{reading ? "Reading settings…" : "Review and apply"}</button>
          </>
        )}
      </div>
    </div>
  );
}
