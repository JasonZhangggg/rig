import { useEffect, useMemo, useRef, useState } from "react";
import { fixSteps, slowOrLoud, type HistoryPoint, type ProcessUse, type SlowLoudAnswer, type SlowLoudStep } from "@rig/core";
import { useApp, useTempText, useUI } from "../state";
import { issueGo } from "../pages/shared";
import { Row, Rows } from "./Rows";
import { useModal } from "./modal";

/** The words that open the check, on Home and in Ctrl K. */
export const SLOW_LOUD_ASK = "Why is it slow or loud?";

/**
 * "Why is my PC slow or loud?", answered from Rig's own readings on the spot: it reads the busiest apps once, then
 * lists what it found, each with its one next step. Reading changes nothing, so nothing here asks for approval;
 * a step that changes the PC opens the usual review.
 */
export function SlowLoudSheet() {
  return useUI().slowLoud ? <OpenSlowLoud /> : null;
}

/** How long the answer may still follow new readings after the apps are read. */
const SETTLE_MS = 2500;

type Read = { processes: ProcessUse[] | null; failed: boolean; history: HistoryPoint[] };

function OpenSlowLoud() {
  const ctx = useApp();
  const { pc, client, set, ask, go, review } = ctx;
  const inUnit = useTempText();
  const box = useRef<HTMLDivElement>(null);
  useModal(box, true);
  const close = () => set({ slowLoud: false });

  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([
      client.processes(pc.id).then((processes) => ({ processes, failed: false }), () => ({ processes: null, failed: true })),
      client.history(pc.id, "24h").catch(() => []),
    ]).then(([apps, history]) => { if (live) setRead({ ...apps, history }); });
    return () => { live = false; };
  }, [client, pc.id]);
  // The answer follows the readings for a moment after the apps come in, so it matches them, then holds still while it's read.
  const fresh = useMemo(() => (read ? slowOrLoud({ pc, history: read.history, processes: read.failed ? undefined : read.processes }) : null), [read, pc]);
  const latest = useRef(fresh);
  latest.current = fresh;
  const [held, setHeld] = useState<SlowLoudAnswer | null>(null);
  useEffect(() => {
    if (!read) return;
    const t = setTimeout(() => setHeld(latest.current), SETTLE_MS);
    return () => clearTimeout(t);
  }, [read]);
  const answer = held ?? fresh;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (s: SlowLoudStep) => {
    close();
    if (s.kind === "issue") issueGo(s.issue.ask ? { ...s.issue, ask: inUnit(s.issue.ask) } : s.issue, pc, ctx);
    else if (s.kind === "fix") void review(fixSteps(s.fix), { by: "you", why: s.why });
    else if (s.kind === "ask") ask(inUnit(s.ask));
    else { if (s.part) set({ selected: s.part, tab: "live" }); go(s.route); }
  };

  const note = read?.failed ? "Rig couldn't read the busiest apps just now, so this is from the readings alone." : answer?.appsNote;
  return (
    <div className="scrim" ref={box} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet sl-sheet" role="dialog" aria-modal="true" aria-labelledby="sl-title" aria-busy={!answer}>
        <div className="sheet-head">
          <span className="label">{pc.name} · {SLOW_LOUD_ASK}</span>
          <h2 id="sl-title" className="plain-h">{answer ? inUnit(answer.headline) : `Checking ${pc.name}…`}</h2>
          {answer?.asOf && <p className="muted">{answer.asOf}</p>}
        </div>
        {answer && (
          <div className="sl-body">
            {answer.causes.length > 0 ? (
              <Rows label="What Rig found">
                {answer.causes.map((c) => (
                  <Row
                    key={c.id} name={c.title} title={inUnit(c.title)}
                    tag={c.likely && <span className="chip no-dot">Likely</span>}
                    meta={c.evidence ? inUnit(c.evidence) : undefined}
                    details={c.why && <p>{inUnit(c.why)}</p>}
                    action={<button type="button" className="btn ghost sm" onClick={() => run(c.step)}>{c.step.label}</button>}
                  />
                ))}
              </Rows>
            ) : (
              <>
                <p className="sl-sub muted">Rig checked:</p>
                <ul className="sl-checked">
                  {answer.checked.map((line) => { const [what, ...rest] = line.split(": "); return <li key={line}><span>{what}</span><b>{inUnit(rest.join(": "))}</b></li>; })}
                </ul>
              </>
            )}
            {note && <p className="sl-note faint">{note}</p>}
          </div>
        )}
        <div className="sheet-foot">
          {answer?.calm && <button type="button" className="btn ghost" onClick={() => { close(); ask(`${pc.name} seems slow or loud, but Rig's readings look normal. What else could it be?`); }}>Ask Rig</button>}
          <button type="button" className="btn ghost" onClick={close} autoFocus>Close</button>
        </div>
      </div>
    </div>
  );
}
