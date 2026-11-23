import { useApp } from "../../state";

// TEMP: ?empty=a|b|c picks a direction while Jason chooses. Removed before merge.
const variant = (() => { try { return new URLSearchParams(location.search).get("empty") ?? "a"; } catch { return "a"; } })();

/** Changes with nothing in it yet: what will show up here, a picture of one, and the way to the first fix.
 *  With fixes waiting above, the Review buttons there are the next step, so this drops its own. */
export function NoChanges({ quiet }: { quiet: boolean }) {
  const { go, pc } = useApp();
  const action = !quiet && <button className="btn primary" type="button" onClick={() => go("chat")}>Ask Rig what to fix</button>;
  const text = (
    <div className="ch-empty-text">
      <h2 className="plain-h" id="ch-empty-h">Every change, with an Undo</h2>
      <p className="muted">Nothing has changed on {pc.name} yet. {quiet ? "Once you say yes to a fix above" : "When you say yes to a fix"}, it shows up here with the old setting saved, so Undo puts it straight back.</p>
    </div>
  );
  if (variant === "b") return (
    <section className={`ch-empty ch-empty-b${quiet ? " quiet" : ""}`} aria-labelledby="ch-empty-h">
      {text}
      <ol className="ch-steps">
        <li>
          <div className="ch-step-art" aria-hidden="true"><span className="ch-pill"><s>60 Hz</s><i>→</i><b>165 Hz</b></span></div>
          <b>Rig shows the change</b><span className="muted">The setting as it is now, and what it would become.</span>
        </li>
        <li>
          <div className="ch-step-art" aria-hidden="true"><span className="ch-fake btn sm primary">Make this change</span></div>
          <b>You say yes</b><span className="muted">Nothing on {pc.name} changes until you do.</span>
        </li>
        <li>
          <div className="ch-step-art" aria-hidden="true"><span className="ch-fake btn sm"><UndoMark />Undo</span></div>
          <b>Undo any time</b><span className="muted">The old value is saved, so it goes straight back.</span>
        </li>
      </ol>
      {action && <div>{action}</div>}
    </section>
  );
  if (variant === "c") return (
    <section className={`ch-empty ch-empty-c${quiet ? " quiet" : ""}`} aria-labelledby="ch-empty-h">
      <div className="ch-empty-side">{text}{action && <div>{action}</div>}</div>
      <div className="ch-ghost-log" aria-hidden="true">
        <p className="ch-day-label">Today<span>Example</span></p>
        <ol className="ch-timeline ch-line">
          <li className="ch-entry"><span className="ch-time num">9:41 PM</span><div className="ch-body"><div className="change-name"><h3>Set the screen to 165 Hz</h3></div><p className="faint ch-meta">By Rig, after you said yes. Old values saved.</p></div><div className="ch-acts"><span className="ch-fake btn sm">Undo</span></div></li>
          <li className="ch-entry sk"><span className="ch-time"><i /></span><div className="ch-body"><i /><i /></div></li>
          <li className="ch-entry sk"><span className="ch-time"><i /></span><div className="ch-body"><i /><i /></div></li>
        </ol>
      </div>
    </section>
  );
  return (
    <section className={`ch-empty ch-empty-a${quiet ? " quiet" : ""}`} aria-labelledby="ch-empty-h">
      <div className="ch-sample" aria-hidden="true">
        <div className="ch-sample-card ch-sample-back" />
        <div className="ch-sample-card">
          <div className="ch-sample-top"><span className="ch-sample-tag">Example</span><span className="num">Today, 9:41 PM</span></div>
          <div className="ch-sample-row">
            <div><b>Set the screen to 165 Hz</b><span>By Rig, after you said yes</span></div>
            <span className="ch-fake btn sm"><UndoMark />Undo</span>
          </div>
          <div className="ch-sample-diff"><span>Refresh rate</span><s>60 Hz</s><i>→</i><b>165 Hz</b></div>
        </div>
      </div>
      {text}
      {action && <div>{action}</div>}
    </section>
  );
}

const UndoMark = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg>
);
