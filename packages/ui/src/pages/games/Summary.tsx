import { useState, type ReactNode } from "react";
import { HOT_MARGIN, type Game, type GameLibrary, type GameStats } from "@rig/core";
import { useApp, useTempUnit } from "../../state";
import { headroomWords } from "./Library";
import { day, hours, partName, temp, timeRange } from "./words";

const listNames = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The one thing worth knowing about the range: the game that ran closest to the limit, or that every game ran cool. */
export function Lead({ library, when, tuning, onOpen }: { library: GameLibrary; when: string; tuning: (name: string) => Game | undefined; onOpen: (name: string) => void }) {
  const { ask } = useApp();
  const unit = useTempUnit();
  const part = partName(library.subject);
  const limit = temp(library.limit, unit);
  const close = library.games.filter((g) => g.headroom != null && g.headroom <= HOT_MARGIN).sort((a, b) => a.headroom! - b.headroom!);

  if (close.length) {
    const g = close[0], h = g.headroom!;
    const others = close.slice(1).map((o) => o.name);
    const title = h < 0 ? `${g.name} ran over the safe limit` : h === 0 ? `${g.name} reached the safe limit` : `${g.name} came close to the safe limit`;
    const body = [
      `The ${part} peaked at ${temp(g.peak, unit)} against its ${limit} limit.`,
      others.length ? `${listNames(others)} came close too.` : "",
      h < 0 ? "It probably slowed itself down to cool off. Cleaning the dust and checking the fans usually helps." : "Short spikes are fine. If it happens every time, clean the dust and check the fans.",
      tuning(g.name) ? "Rig also has settings to try for it." : "",
    ].filter(Boolean).join(" ");
    return (
      <LeadCard tone="look" tag="Worth a look" title={title} body={body} figure={temp(g.peak, unit)} figureNote={`Hottest in ${g.name}, limit ${limit}`}>
        <button type="button" className="btn primary" onClick={() => onOpen(g.name)}>See {g.name}</button>
        <button type="button" className="btn" onClick={() => ask(`While I play ${g.name}, my ${part} peaks at ${temp(g.peak, unit)} and its safe limit is ${limit}. What should I do?`)}>Ask what to do</button>
      </LeadCard>
    );
  }

  const read = library.games.filter((g): g is GameStats & { peak: number } => g.peak != null);
  const hottest = read.reduce<(typeof read)[number] | null>((a, b) => (!a || b.peak > a.peak ? b : a), null);
  const tuned = library.games.map((g) => tuning(g.name)).find((t) => t?.now && t.tuned);
  const body = [
    hottest ? `The ${part} peaked at ${temp(hottest.peak, unit)} in ${hottest.name}${hottest.headroom != null ? `, ${headroomWords(hottest.headroom, unit)}` : ""}.` : `Rig couldn't read the ${part}'s temperature while you played.`,
    tuned ? `${tuned.name} has settings to try that took it from ${tuned.now!.avg} to ${tuned.tuned!.avg} fps.` : "",
  ].filter(Boolean).join(" ");
  return (
    <LeadCard tone="good" tag="All good" title={hottest ? `Every game ran cool ${when}` : `${hours(library.hours)} of games ${when}`} body={body} figure={hottest ? temp(hottest.peak, unit) : hours(library.hours)} figureNote={hottest ? `Hottest in ${hottest.name}, limit ${limit}` : `Played ${when}`}>
      {tuned && <button type="button" className="btn" onClick={() => onOpen(tuned.name)}>See settings for {tuned.name}</button>}
    </LeadCard>
  );
}

function LeadCard({ tone, tag, title, body, figure, figureNote, children }: { tone: "good" | "look"; tag: string; title: string; body: string; figure: string; figureNote: string; children?: ReactNode }) {
  return (
    <section className={`card pg-lead ${tone}`} aria-labelledby="gm-lead-h">
      <div className="pg-lead-text">
        <span className="pg-lead-tag">{tag}</span>
        <h2 id="gm-lead-h" className="pg-lead-h">{title}</h2>
        <p className="pg-lead-body">{body}</p>
        {children && <div className="gm-actions">{children}</div>}
      </div>
      <p className="pg-lead-fig"><b className="num">{figure}</b><span className="muted">{figureNote}</span></p>
    </section>
  );
}

/** The latest sittings across every game, tucked behind a button. Each opens its game. */
export function RecentSessions({ library, onOpen }: { library: GameLibrary; onOpen: (name: string) => void }) {
  const unit = useTempUnit();
  const [open, setOpen] = useState(false);
  const all = library.games.flatMap((g) => g.sessions.map((s) => ({ s, g })));
  const recent = [...all].sort((a, b) => b.s.to - a.s.to).slice(0, 6);
  return (
    <div className="pg-foot">
      <button type="button" className="btn ghost sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide recent sessions" : "Show recent sessions"}
      </button>
      {open && (
        <ul className="gm-recent" aria-label="Recent sessions">
          {recent.map(({ s, g }) => (
            <li key={`${g.name}-${s.from}`}>
              <button type="button" className="gm-recent-row" onClick={() => onOpen(g.name)}>
                <b className="gm-recent-name">{g.name}</b>
                <span className="muted">{day(s.from)}, {timeRange(s.from, s.to)}</span>
                <span className="num">{hours(s.hours)}</span>
                {s.hot ? <span className="gm-hot">Ran hot, {temp(s.peak, unit)}</span> : <span className="muted">Peak {temp(s.peak, unit)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
