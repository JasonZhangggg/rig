import { useEffect, useRef, useState } from "react";
import { canItRun, machineWord, type GameRequirements, type HardwareFacts, type PartCheck, type RunAnswer } from "@rig/core";
import { useApp, useUI } from "../state";
import { dateText } from "../dateText";
import { Row, RowFigure, Rows } from "./Rows";
import { useModal } from "./modal";

/** The words that open the check, in Ctrl K and on the Games view. */
export const CAN_RUN_ASK = "Can it run a game?";

/**
 * "Can my PC run this game?": the game's requirements, read from its store or publisher page, against the parts Rig
 * read. Rig compares them in its own code (canItRun in @rig/core); reading changes nothing, so nothing here asks for approval.
 */
export function CanItRunSheet() {
  const game = useUI().canRun;
  return game == null ? null : <OpenCanItRun first={game} />;
}

type Look =
  | { step: "ask" }
  | { step: "looking"; game: string }
  | { step: "done"; req: GameRequirements; answer: RunAnswer }
  | { step: "none"; game: string }
  | { step: "error"; message: string };

function OpenCanItRun({ first }: { first: string }) {
  const { pc, client, set, go, ask } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useModal(box, true);
  const close = () => set({ canRun: null });
  const [name, setName] = useState(first);
  const [look, setLook] = useState<Look>({ step: "ask" });
  const [facts, setFacts] = useState<HardwareFacts | null | undefined>(undefined);
  const run = useRef(0);
  const factsNow = useRef(facts);
  factsNow.current = facts;

  useEffect(() => {
    let live = true;
    client.shop(pc.id).then((s) => live && setFacts(s?.facts ?? null), () => live && setFacts(null));
    return () => { live = false; };
  }, [client, pc.id]);

  const check = async (game: string) => {
    const g = game.trim();
    const f = factsNow.current;
    if (!g || !f) return;
    const n = ++run.current;
    if (!client.gameRequirements) { setLook({ step: "error", message: "Rig can't look up games from here. Ask Rig instead." }); return; }
    setLook({ step: "looking", game: g });
    try {
      const req = await client.gameRequirements(g);
      if (n !== run.current) return;
      setLook(req ? { step: "done", req, answer: canItRun(f, req) } : { step: "none", game: g });
    } catch (e) {
      if (n === run.current) setLook({ step: "error", message: e instanceof Error ? e.message : "Rig couldn't look the game up just now. Try again in a minute." });
    }
  };
  // A game named where the check was opened is looked up once Rig has the parts.
  const started = useRef(false);
  useEffect(() => {
    if (facts && first.trim() && !started.current) { started.current = true; void check(first); }
  }, [facts]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const answer = look.step === "done" ? look.answer : null;
  const headline = facts === null ? `Rig hasn't read ${pc.name}'s parts yet`
    : look.step === "looking" ? `Reading ${look.game}'s requirements…`
    : look.step === "none" ? `Rig couldn't find ${look.game}'s requirements`
    : answer ? answer.headline
    : `Which game should Rig check on ${pc.name}?`;
  const word = machineWord(pc.kind);
  const sub = facts === null ? `Open Rig on that ${word} once, and it can compare.`
    : look.step === "none" ? "Check the name, or ask Rig to look further."
    : look.step === "error" ? look.message
    : answer?.sub ?? (look.step === "ask" ? `Rig reads its minimum and recommended specs from the game's store or publisher page and compares them with this ${word}'s parts.` : undefined);
  const gameName = look.step === "done" ? look.req.game : look.step === "looking" || look.step === "none" ? look.game : name.trim();

  return (
    <div className="scrim" ref={box} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sheet cr-sheet" role="dialog" aria-modal="true" aria-labelledby="cr-title" aria-busy={look.step === "looking" || facts === undefined}>
        <div className="sheet-head">
          <span className="label">{pc.name} · {CAN_RUN_ASK}</span>
          <h2 id="cr-title" className="plain-h">{headline}</h2>
          {sub && <p className="muted">{sub}</p>}
        </div>
        <div className="sl-body">
          {facts !== null && (
            <form className="cr-form" role="search" onSubmit={(e) => { e.preventDefault(); void check(name); }}>
              <input ref={field} className="input" type="search" value={name} onChange={(e) => setName(e.target.value)} placeholder="The game's name" aria-label="Game" autoFocus={!first} maxLength={100} />
              <button type="submit" className="btn sm" disabled={!name.trim() || !facts || look.step === "looking"}>Check</button>
            </form>
          )}
          {answer && look.step === "done" && (
            <>
              <Rows label={`How ${pc.name} compares`}>
                {answer.parts.map((p) => (
                  <Row
                    key={p.part} name={p.label} title={p.yours} meta={<>{p.label}<span className={`cr-lv${p.level === "below" ? " look" : ""}`}> · {levelWords(p).filter(Boolean).join(" ")}</span></>}
                    tag={answer.holder === p.part && answer.verdict !== "well" && <span className="chip no-dot">Holds it back</span>}
                    figure={<Level p={p} />}
                    details={<PartDetails p={p} />}
                    action={answer.holder === p.part && answer.upgrade
                      ? <button type="button" className="btn ghost sm" onClick={() => { close(); set({ shopCat: answer.upgrade! }); go("upgrades"); }}>See upgrades</button>
                      : undefined}
                  />
                ))}
              </Rows>
              <p className="sl-note faint">
                From the <a href={look.req.source.url} target="_blank" rel="noreferrer">{look.req.source.label}</a>, read {dateText(new Date(look.req.readAt), { month: "short", day: "numeric", year: "numeric" })}.
                {look.req.demo ? " A sample read for the demo." : ""} Rig compares processors and graphics by broad groups, not exact benchmarks.
              </p>
            </>
          )}
        </div>
        <div className="sheet-foot">
          {facts && gameName && look.step !== "looking" && (
            <button type="button" className="btn ghost" onClick={() => { close(); ask(`Can ${pc.name} run ${gameName}? What settings should I use?`); }}>Ask Rig</button>
          )}
          <button type="button" className="btn ghost" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** How a part did, in two words: "Meets" "recommended". */
function levelWords(p: PartCheck): [string, string] {
  if (p.level === "below") return ["Below", "minimum"];
  if (p.level === "unknown") return p.underRecommended ? ["Below", "recommended"] : ["Not compared", ""];
  return ["Meets", p.level === "recommended" ? "recommended" : "minimum"];
}

/** How a part did, on the right of its row. On a phone it moves into the grey line, so Details can stay beside it. */
function Level({ p }: { p: PartCheck }) {
  const [value, word] = levelWords(p);
  return <RowFigure value={value} word={word || "see details"} look={p.level === "below"} />;
}

function PartDetails({ p }: { p: PartCheck }) {
  return (
    <>
      {p.why && <p>{p.why}</p>}
      <dl className="cr-need">
        {p.minimum !== undefined && <><dt>Minimum</dt><dd>{p.minimum}</dd></>}
        {p.recommended !== undefined && <><dt>Recommended</dt><dd>{p.recommended}</dd></>}
      </dl>
    </>
  );
}
