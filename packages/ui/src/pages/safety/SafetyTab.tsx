// The Safety tab of My PC: Windows updates, virus protection, the firewall and backup, one row each, as the helper last
// read them (packages/core/src/safety.ts). A row needing a look gets a chip; Details says why and what to do in Windows.
// Rig only reads these, so the row's one action asks the chat.

import { memo } from "react";
import { safetyRows, safetySummary } from "@rig/core";
import { Row, Rows } from "../../components/Rows";
import { useActions, useStillPC } from "../../state";
import { ago } from "../games/words";

/** "Nothing needs a look · checked 5 minutes ago". On the website the age is how old the PC's last upload is. */
export function safetyHead(readAt: number | undefined, summary: string, now = Date.now()) {
  return readAt == null ? "Not read yet" : `${summary} · checked ${ago(readAt, now)}`;
}

export const SafetyTab = memo(function SafetyTab() {
  const pc = useStillPC();
  const { ask } = useActions();
  const sec = pc.security;
  const now = Date.now();
  const rows = safetyRows(sec, now);
  return (
    <div className="mt safety">
      <section aria-labelledby="safety-h">
        <div className="safety-top">
          <h2 id="safety-h" className="mt-h">Safe and up to date</h2>
          <span className="faint safety-age">{safetyHead(sec?.readAt, safetySummary(rows), now)}</span>
        </div>
        <Rows label="Safe and up to date">
          {rows.map((r) => (
            <Row key={r.id} name={r.title} title={r.title} meta={r.line}
              tag={r.chip ? <span className="chip warn">{r.chip}</span> : null}
              details={<><p>{r.why}</p>{r.steps && <p>{r.steps}</p>}</>}
              action={<button type="button" className="btn ghost sm" aria-label={`Ask about ${r.title.toLowerCase()}`} onClick={() => ask(r.ask)}>Ask</button>} />
          ))}
        </Rows>
        <p className="faint mt-note">{sec ? "Rig only reads these. It never changes them by itself." : `Rig reads these with the rest of ${pc.name}'s settings, from the Rig app on it.`}</p>
      </section>
    </div>
  );
});
