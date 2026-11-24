// Which graphics card it is, when Windows' ids don't name the model. Rig asks once, the first time the PC shows,
// with the models it knows for the card's chip (only its maker's, where Windows names the maker), and the answer
// can be changed on the card's page. The pick is the person's word, so the card's power plugs then come from it.
import { useEffect, useRef, useState } from "react";
import { cardMakers, gpuChip, gpuModels, gpuPick, resolveBuild, type PC, type PlugKind } from "@rig/core";
import { useModal } from "../../components/modal";
import { useActions, useAppSelector, useUI } from "../../state";

/** "8 + 6-pin PCIe", "16-pin". */
export const layoutName = (power: PlugKind[]) => power.map((k) => k.replace("-pin", "")).join(" + ") + (power.some((k) => k === "16-pin") ? "-pin" : "-pin PCIe");

/** The few things about the PC these need, as plain values so a new reading alone doesn't draw them again. */
interface CardPC { id: string; name: string; picks: PC["picks"]; gpu?: string; vendor?: string; sub?: string; desktop: boolean }

/** What Windows says about the PC's graphics card, as Rig's lists take it. */
export const cardInput = (pc: Pick<CardPC, "gpu" | "vendor" | "sub">) => pc.gpu ? { name: pc.gpu, subsysVendor: pc.vendor, subsysId: pc.sub } : undefined;

const useCardPC = (): CardPC => useAppSelector((c) => ({
  id: c.pc.id, name: c.pc.name, picks: c.pc.picks, gpu: c.pc.parts?.gpu?.name, vendor: c.pc.gpuSubsys?.vendor, sub: c.pc.gpuSubsys?.id, desktop: !!c.pc.board,
}));

/** True when Rig can't name the card and has models to offer for it. */
export function canPick(pc: Pick<CardPC, "gpu" | "vendor" | "sub">) {
  const input = cardInput(pc);
  if (!input || !gpuModels(input).length) return false;
  return resolveBuild({ gpu: input }).gpu?.source !== "detected";
}

/** The "Which card is it?" sheet. first: asked on its own when the PC first shows, so closing it counts as "I'm not sure". */
export function CardPicker({ pc, first, onClose }: { pc: CardPC; first?: boolean; onClose: () => void }) {
  const { client, toast } = useActions();
  const input = cardInput(pc)!;
  const chip = gpuChip(input.name);
  const maker = input.subsysVendor ? cardMakers[input.subsysVendor.toLowerCase()] : undefined;
  const models = gpuModels(input);
  const current = gpuPick(input, pc.picks?.gpu);
  const save = (gpu: string) => {
    onClose();
    client.rename(pc.id, { picks: { ...pc.picks, gpu } }).catch(() => toast("Couldn't save that. Try again."));
  };
  const unsure = () => save(`unsure:${chip}`);
  const dismiss = () => (first ? unsure() : onClose());
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); dismiss(); } };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });
  const box = useRef<HTMLDivElement>(null);
  useModal(box, true);
  return (
    <div className="scrim" ref={box} onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}>
      <div className="sheet gp-pick" role="dialog" aria-modal="true" aria-labelledby="gp-pick-title">
        <div className="sheet-head">
          <span className="label">{pc.name}</span>
          <h2 id="gp-pick-title" className="plain-h">Which {chip ?? "graphics card"} is it?</h2>
          <p className="muted">
            Windows calls it {input.name}{maker ? ` and says ${maker} made it` : ""}, but not which model. Pick yours and Rig shows its power plugs.
            {first ? " You can change it later on the graphics card's page." : ""}
          </p>
        </div>
        <ul className="gp-pick-list" aria-label="Models">
          {models.map((m) => (
            <li key={m.id}>
              <button type="button" className={`gp-pick-row${current === m.id ? " is-on" : ""}`} aria-pressed={current === m.id} onClick={() => save(m.id)}>
                <b>{m.name}</b>
                <span>{m.power?.length ? layoutName(m.power) : "Rig doesn't have its power plugs yet"}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="note faint">The model is on the card's box, or on a sticker on the card.</p>
        <div className="sheet-foot">
          {!first && <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>}
          <button className="btn ghost" type="button" autoFocus onClick={unsure}>I'm not sure</button>
        </div>
      </div>
    </div>
  );
}

/** Asks once which card it is, the first time a desktop PC Rig can't name the card of shows. */
export function CardAsk() {
  const pc = useCardPC();
  const { route } = useUI();
  const [closed, setClosed] = useState<string | null>(null);
  const input = cardInput(pc);
  if (!pc.desktop || !input || closed === pc.id || route === "web" || route === "signin") return null;
  if (gpuPick(input, pc.picks?.gpu) || !canPick(pc)) return null;
  return <CardPicker pc={pc} first onClose={() => setClosed(pc.id)} />;
}

/** The card's model on its page, with a way to pick or change it. */
export function CardModel({ model, source }: { model: string; source: string }) {
  const pc = useCardPC();
  const [open, setOpen] = useState(false);
  const input = cardInput(pc);
  if (!input) return null;
  const pickable = canPick(pc);
  const named = source === "detected" || source === "picked";
  const how = source === "detected" ? "Windows names it" : source === "picked" ? "You picked it" : undefined;
  return (
    <div className="gp-model">
      <div className="gp-model-text">
        <span className="label">{named ? "Model" : "Model not known"}</span>
        <b>{named ? model : `Rig can't tell which ${gpuChip(input.name) ?? "card"} this is`}</b>
        {how && <span className="faint">{how}</span>}
      </div>
      {pickable && <button className="btn ghost sm" type="button" onClick={() => setOpen(true)}>{source === "picked" ? "Change" : "Pick your card"}</button>}
      {open && <CardPicker pc={pc} onClose={() => setOpen(false)} />}
    </div>
  );
}
