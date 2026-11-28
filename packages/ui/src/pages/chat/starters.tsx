import { machineWord, type ChatMessage, type Issue, type StillPC } from "@rig/core";
import { Icon } from "../../components/common";
import { useActions, useData, useStillPC, useTempText } from "../../state";
import { useManuals } from "../../manuals/useManuals";
import { partIcon } from "../shared";
import { netCheckQuestion } from "../../components/NetCheck";

/** check: opens that check's dialog instead of asking. */
export interface Starter { q: string; why: string; part?: string; topic?: string; check?: "network" }

const askPath = "M4 5h12v8H9l-4 3v-3H4z";

const partOf = (i: Issue) => i.part ?? (i.id.startsWith("vol-") ? "ssd" : undefined);

function generic(pc: StillPC): Starter[] {
  return [
    { q: `Why is ${pc.name} loud?`, why: "Noise usually comes from fans working harder than they need to.", part: "fans" },
    { q: "Why is startup slow?", why: "Apps that start with Windows add up over time.", part: "ssd", topic: "startup" },
    { q: netCheckQuestion(machineWord(pc.kind)), why: `A quick check of ${pc.name}'s connection, your router and the internet.`, part: "network", topic: "network", check: "network" },
    { q: "Can my screen look smoother?", why: "Many screens run slower than they can after a new cable or driver.", part: "gpu" },
    { q: "What should I upgrade first?", why: "See what fits and what you would notice most.", part: "ram" },
  ];
}

/** Questions to start with: open issues that come with a question first, then everyday ones. */
export function useStarters(): Starter[] {
  const pc = useStillPC();
  const inUnit = useTempText();
  const fromIssues = (pc.issues ?? []).filter((i) => i.ask).slice(0, 2)
    .map((i): Starter => ({ q: inUnit(i.ask!), why: inUnit(i.title), part: partOf(i), topic: i.id }));
  // A read board manual answers wiring questions with the page, so one of those starts near the top.
  const { manuals } = useManuals();
  const board = manuals?.find((m) => m.indexed && m.diagrams.some((d) => d.kind === "front-panel"));
  const everyday = generic(pc);
  if (board) everyday.splice(1, 0, { q: "Where do the front panel cables plug in?", why: "Rig answers from your motherboard's manual and says which page.", part: "board", topic: "manual" });
  const all = [...fromIssues, ...everyday.filter((g) => !fromIssues.some((i) => i.topic === g.topic))];
  return all.filter((s, n) => all.findIndex((x) => x.q === s.q) === n);
}

const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9° ]+/g, " ").replace(/\s+/g, " ").trim();

/** Starters not asked yet in this conversation, in those words or a longer version of them. */
export const notAsked = (starters: Starter[], chat: ChatMessage[]) => {
  const asked = chat.filter((m) => m.from === "you").map((m) => plain(m.text));
  return starters.filter((s) => !asked.some((a) => a.includes(plain(s.q))));
};

export function StarterIcon({ part }: { part?: string }) {
  return <span className="starter-ico" aria-hidden="true">{(part && partIcon[part]) || <Icon d={askPath} />}</span>;
}

export function StarterGrid({ starters }: { starters: Starter[] }) {
  const { ask, set } = useActions();
  const data = useData("answering");
  return (
    <ul className="starters" aria-label="Questions to start with">
      {starters.slice(0, 4).map((s) => (
        <li key={s.q}>
          <button type="button" className="starter" disabled={data.answering} onClick={() => (s.check ? set({ netCheck: true }) : ask(s.q))}>
            <StarterIcon part={s.part} />
            <span className="starter-txt"><b>{s.q}</b><span>{s.why}</span></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FollowUps({ starters }: { starters: Starter[] }) {
  const { ask } = useActions();
  if (!starters.length) return null;
  return (
    <div className="followups" aria-label="Ask next">
      {starters.filter((s) => !s.check).slice(0, 3).map((s) => (
        <button key={s.q} type="button" onClick={() => ask(s.q)}>{s.q}</button>
      ))}
    </div>
  );
}
