// "Is it my PC or my internet?": a dialog that runs the connection check on the on-screen PC and says, in one line,
// what's to blame, then at most three findings, each with what to do next and a question for Ask Rig. It only reads.
// Opened from Ctrl K and the Ask page's starters, through `ui.netCheck`.
import { useEffect, useRef, useState } from "react";
import { networkAnswer, type NetworkAnswer, type NetworkCheckReply } from "@rig/core";
import { useActions, useAppSelector, useMachineWord, useUI } from "../state";
import { useModal } from "./modal";
import { Row, Rows } from "./Rows";

/** The check's question, with the machine's own noun: "Is it my laptop or my internet?" on a laptop. */
export const netCheckQuestion = (word: string) => `Is it my ${word} or my internet?`;

export function NetCheck() {
  return useUI().netCheck ? <OpenNetCheck /> : null;
}

type Shown =
  | { kind: "checking" }
  | { kind: "answer"; answer: NetworkAnswer }
  | { kind: "unsupported"; reason: Extract<NetworkCheckReply, { kind: "unsupported" }>["reason"] }
  | { kind: "failed"; message: string };

function OpenNetCheck() {
  const { client, set, ask } = useActions();
  const pc = useAppSelector((c) => ({ id: c.pc.id, name: c.pc.name, kind: c.pc.kind }));
  const word = useMachineWord();
  const [shown, setShown] = useState<Shown>({ kind: "checking" });
  const runs = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  useModal(box, true);
  const close = () => set({ netCheck: false });

  const run = () => {
    const n = ++runs.current;
    setShown({ kind: "checking" });
    const check = client.checkNetwork;
    const reply: Promise<NetworkCheckReply> = check ? check.call(client, pc.id) : Promise.resolve({ kind: "unsupported", reason: "elsewhere" });
    reply.then(
      (r) => { if (n === runs.current) setShown(r.kind === "done" ? { kind: "answer", answer: networkAnswer(r.reading, pc.kind) } : { kind: "unsupported", reason: r.reason }); },
      (e) => { if (n === runs.current) setShown({ kind: "failed", message: e instanceof Error ? e.message : "Try again in a moment." }); },
    );
  };
  // Runs when it opens, and again for another PC.
  useEffect(() => { run(); return () => { runs.current++; }; }, [pc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });

  const askAbout = (q: string) => { close(); ask(q); };
  const head = shown.kind === "checking" ? { h: "Checking your connection…", p: `Rig is pinging your router and the internet from ${pc.name}. This takes a few seconds.` }
    : shown.kind === "answer" ? { h: shown.answer.headline, p: shown.answer.sub }
    : shown.kind === "unsupported" ? (shown.reason === "update"
      ? { h: `Update Rig on ${pc.name} to run this check`, p: "This version of Rig's helper can't check the connection yet. Settings, Updates has the newest version." }
      : { h: `Run this check from the Rig app on ${pc.name}`, p: `It pings your router and the internet from the ${word} itself, so it runs in the Rig app there.` })
    : { h: "Rig couldn't check the connection", p: shown.message };

  return (
    <div className="scrim" ref={box} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet net-check" role="dialog" aria-modal="true" aria-labelledby="net-check-h" aria-describedby="net-check-p" aria-busy={shown.kind === "checking"}>
        <div className="sheet-head">
          <span className="label">{pc.name} · {netCheckQuestion(word)}</span>
          <h2 id="net-check-h" className="plain-h" aria-live="polite">{head.h}</h2>
          <p id="net-check-p" className="muted">{head.p}</p>
          {shown.kind === "checking" && <p className="typing" aria-hidden="true"><i /><i /><i /></p>}
        </div>
        {shown.kind === "answer" && (
          <>
            {shown.answer.findings.length > 0 && (
              <div className="net-check-rows">
                <Rows label="What Rig found">
                  {shown.answer.findings.map((f) => (
                    <Row key={f.id} name={f.title} title={f.title} meta={f.next} details={<p>{f.why}</p>}
                      action={<button type="button" className="btn ghost sm" aria-label={`Ask Rig: ${f.ask}`} onClick={() => askAbout(f.ask)}>Ask</button>} />
                  ))}
                </Rows>
              </div>
            )}
            <dl className="net-check-facts" aria-label="What Rig measured">
              {shown.answer.facts.map((f) => (
                <div key={f.label} className={f.look ? "look" : undefined}>
                  <dt>{f.label}</dt>
                  <dd><b className="num">{f.value}</b><span>{f.sub}</span></dd>
                </div>
              ))}
            </dl>
            <p className="note faint">Rig only measured. Nothing on {pc.name} or your router changed.</p>
          </>
        )}
        <div className="sheet-foot">
          {(shown.kind === "answer" || shown.kind === "failed") && <button className="btn ghost" type="button" onClick={run}>Check again</button>}
          <button className="btn" type="button" autoFocus onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}
