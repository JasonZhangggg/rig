import { useApp } from "../../state";

/** Changes with nothing in it yet: a picture of one change as it will look, what the page is for, and the way to the first fix.
 *  With fixes waiting above, their Review buttons are the next step, so this drops its own. */
export function NoChanges({ quiet }: { quiet: boolean }) {
  const { go, pc } = useApp();
  return (
    <section className="ch-empty" aria-labelledby="ch-empty-h">
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
      <div className="ch-empty-text">
        <h2 className="plain-h" id="ch-empty-h">Every change, with an Undo</h2>
        <p className="muted">Nothing has changed on {pc.name} yet. {quiet ? "Once you say yes to a fix above" : "When you say yes to a fix"}, it shows up here with the old setting saved, so Undo puts it straight back.</p>
      </div>
      {!quiet && <button className="btn primary" type="button" onClick={() => go("chat")}>Ask Rig what to fix</button>}
    </section>
  );
}

const UndoMark = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 3.5 2.5 6.5l3 3" /><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7" /></svg>
);
