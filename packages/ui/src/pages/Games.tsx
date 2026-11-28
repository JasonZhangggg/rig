import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gameLibrary, insightContext, type Game, type HistoryPoint, type StillPC } from "@rig/core";
import { useActions, useHistory, useStillPC } from "../state";
import { Detail } from "./games/Detail";
import { Library, type GameSort } from "./games/Library";
import { RecentSessions } from "./games/Summary";
import { partName } from "./games/words";
import { LogsHead } from "./logs/Head";
import { CAN_RUN_ASK } from "../components/CanItRun";

type GameRange = "7d" | "30d";
const rangeWords: Record<GameRange, string> = { "7d": "this week", "30d": "this month" };

/** The games in the history, in the viewer's local time. Null while history loads. */
function useLibrary(pc: StillPC, points: HistoryPoint[] | null) {
  // The PC object is replaced on every live reading, so the memo keys on the fields the library reads.
  const { kind } = pc;
  const cpu = pc.parts?.cpu?.limit, gpu = pc.parts?.gpu?.limit;
  return useMemo(() => (points ? gameLibrary(points, insightContext({ kind, parts: { cpu: { limit: cpu }, gpu: { limit: gpu } } })) : null), [points, kind, cpu, gpu]);
}

/** Frame rates and settings Rig has measured, looked up by game name. */
function useTuning() {
  const { client } = useActions();
  const pc = useStillPC();
  const [games, setGames] = useState<Map<string, Game>>(new Map());
  useEffect(() => {
    let live = true;
    const keep = (list: Game[]) => live && setGames(new Map(list.filter((g) => g.now || g.settings.length).map((g) => [g.name.toLowerCase(), g])));
    client.games(pc.id).then(keep).catch(() => keep([]));
    return () => { live = false; };
  }, [client, pc.id]);
  return (name: string) => games.get(name.toLowerCase());
}

export function Games() {
  const { ask, set } = useActions();
  const pc = useStillPC();
  const [range, setRange] = useState<GameRange>("7d");
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<GameSort>("played");
  const points = useHistory(range);
  const library = useLibrary(pc, points);
  const tuning = useTuning();
  const when = rangeWords[range];
  useEffect(() => setOpen(null), [pc.id]);
  // A game opens at the top; All games goes back to where the list was.
  const listY = useRef<number | null>(null);
  const show = (name: string | null) => {
    if (name) { listY.current = window.scrollY; window.scrollTo(0, 0); }
    setOpen(name);
  };
  useLayoutEffect(() => {
    if (open || listY.current == null) return;
    window.scrollTo(0, listY.current);
    listY.current = null;
  }, [open]);

  const seg = (
    <div className="seg" role="group" aria-label="Range">
      {(["7d", "30d"] as const).map((r) => <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>{r === "7d" ? "Week" : "Month"}</button>)}
    </div>
  );

  const game = open ? library?.games.find((g) => g.name === open) : undefined;
  if (game && library) return <Detail key={`${game.name}-${range}`} game={game} library={library} tuning={tuning(game.name)} when={when} range={seg} onBack={() => show(null)} />;

  const part = library?.games.length ? partName(library.subject) : pc.kind === "tower" && pc.parts?.gpu ? "graphics card" : "processor";
  const recorded = !!points?.length;
  return (
    <div className="page pg-focus">
      <LogsHead sub={`What you played on ${pc.name} and how warm the ${part} ran while you did.`} right={(
        <div className="gm-tools">
          <button type="button" className="btn ghost sm" onClick={() => set({ canRun: "" })}>{CAN_RUN_ASK}</button>
          {seg}
        </div>
      )} />
      {library == null ? <p className="muted" role="status">Loading…</p> : library.games.length ? (
        <>
          <Library library={library} when={when} sort={sort} onSort={setSort} tuned={(name) => !!tuning(name)} onOpen={show}>
            <RecentSessions library={library} onOpen={show} />
          </Library>
        </>
      ) : (
        <section className="card gm-empty">
          <div className="empty">
            <h2 className="plain-h">{!recorded ? "No games recorded yet" : range === "7d" ? "No games this week" : "No games this month"}</h2>
            <p className="muted" style={{ maxWidth: "56ch" }}>
              {recorded && `Rig didn't see a game running on ${pc.name} in the last ${range === "7d" ? 7 : 30} days. `}
              Leave Rig open while you play and each game shows up here with how long you played and how warm {pc.name} ran.
            </p>
            <div className="gm-actions">
              {recorded && range === "7d" && <button className="btn ghost" type="button" onClick={() => setRange("30d")}>Show the month</button>}
              <button className="btn" type="button" onClick={() => ask("What settings should I use for my games?")}>Ask about game settings</button>
            </div>
          </div>
          <div className="gm-empty-list">
            <span className="label">What shows up here</span>
            <ul>
              <li><b>Time played</b><span className="muted">Each game, most played first, with every session.</span></li>
              <li><b>How warm it ran</b><span className="muted">The {part}'s usual and hottest temperature while you played.</span></li>
              <li><b>Close calls</b><span className="muted">Sessions that came near the safe limit, and what to do about it.</span></li>
            </ul>
          </div>
        </section>
      )}
      {library != null && <p className="faint pg-note">Rig reads temperatures only. It never touches the game, so anti-cheat has nothing to flag.</p>}
    </div>
  );
}
