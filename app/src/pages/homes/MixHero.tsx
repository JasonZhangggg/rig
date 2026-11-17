import { user } from "../../data";
import { useApp } from "../../state";
import { greeting, issueGo } from "./shared";
import { Arrow, DotDigits, useGrowOnce } from "./pulse-parts";

const Mic = () => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /></svg>;

/** Mix's hero options. All stay monochrome; color lives in the tiles below. */
export function MixHero() {
  const { ui, pc, set, go, ask } = useApp();
  const issues = pc.issues ?? [];
  const open = issues.filter((i) => i.severity === "warn");
  const top = issues.find((i) => i.severity === "warn") ?? issues[0];
  const growDots = useGrowOnce("mix-hero-dots");
  const status = open.length === 0 ? "Nothing needs you." : open.length === 1 ? "One thing needs a look." : `${open.length} things need a look.`;
  const review = top && (
    <button type="button" className="mh-btn primary" onClick={() => issueGo(top, pc, set, go)}>
      Review{open.length > 0 && <em>{open.length}</em>}<Arrow />
    </button>
  );
  const askBtn = <button type="button" className="mh-btn" onClick={() => set({ palette: true })}><Mic />Ask Rig</button>;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  if (ui.hero === "score") {
    return (
      <section className="mh mh-score" aria-label="Summary">
        <div className="mh-score-num">
          <span className="mh-kicker">Health</span>
          <DotDigits value={String(pc.health)} grow={growDots} label={`Health ${pc.health} out of 100`} />
        </div>
        <div className="mh-score-txt">
          <span className="mh-kicker">{today}</span>
          <h1>{greeting()}, {user.name}</h1>
          <p>{pc.name} is running well. {status}</p>
        </div>
        <div className="mh-actions">{review}{askBtn}</div>
      </section>
    );
  }
  if (ui.hero === "statement") {
    return (
      <section className="mh mh-statement" aria-label="Summary">
        <div className="mh-rule"><span>Overview</span><span>{today}</span></div>
        <h1>{pc.name} is running well. <span>{status}</span></h1>
        <div className="mh-side">
          <p>{greeting()}, {user.name}. Rig checked every sensor this morning and keeps an eye on temperatures while you play.</p>
          <div className="mh-actions">{review}{askBtn}</div>
        </div>
      </section>
    );
  }
  const prompts = ["Why is my graphics card hot?", "Is my PC ready for a new game?", "What changed this week?"];
  return (
    <section className="mh mh-ask" aria-label="Ask Rig">
      <div className="mh-ask-top">
        <div>
          <h1>{greeting()}, {user.name}</h1>
          <p>{pc.name} is running well. {status}</p>
        </div>
        {review}
      </div>
      <button type="button" className="mh-askbar" onClick={() => set({ palette: true })}>
        <Mic /><span>Ask anything about {pc.name}</span><kbd>Ctrl K</kbd>
      </button>
      <div className="mh-prompts">
        {prompts.map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}</button>)}
      </div>
    </section>
  );
}
