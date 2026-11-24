import { outputKindName, type CardUse, type GpuPorts as Ports, type OutputState } from "@rig/core";
import { gpuStage, useCard, useGpuPointed } from "./gpuStage";

const stateName: Record<OutputState, string> = { used: "in use", free: "free", some: "maybe in use, Windows doesn't say which", unknown: "Rig can't see it" };
const cellState: Record<OutputState, string> = { used: "used", free: "free", some: "some", unknown: "unknown" };

/**
 * The graphics card's outputs and power plugs, with which screen is on which kind of output, from what Windows
 * reports. Pointing at a row lights it on the card; clicking an output or plug zooms the card to it.
 */
export function GpuPorts() {
  const c = useCard();
  const pointed = useGpuPointed();
  if (!c) return <p className="muted">Rig shows the card's outputs once the Rig app on this PC sends its parts.</p>;
  const p = c.shape.ports!;
  const some = c.use.groups.some((g) => g.outputs.some((o) => o.state === "some"));
  return (
    <div className="bu">
      {c.use.elsewhere.length > 0 && (
        <ul className="gp-elsewhere" aria-label="Screens not on the card">
          {c.use.elsewhere.map((e) => <li key={e.name}><b>{e.name}</b><span>{e.note}</span></li>)}
        </ul>
      )}
      <ul className="bu-groups" aria-label="Outputs and power">
        {c.use.groups.map((g) => <Outputs key={g.kind} g={g} pointed={pointed} />)}
        <Power p={p} pointed={pointed} />
      </ul>
      {c.use.unknown && <p className="bu-note">{c.use.unknown}</p>}
      <p className="bu-legend faint" aria-hidden="true"><i className="is-used" />In use<i className="is-free" />Free{some && <><i className="is-some" />One of these</>}</p>
      <p className="faint bu-from">Outputs and plugs: {p.from}</p>
    </div>
  );
}

function Outputs({ g, pointed }: { g: CardUse["groups"][number]; pointed: string | null }) {
  const ids = g.outputs.map((o) => o.id);
  const lit = pointed != null && ids.includes(pointed);
  const used = g.outputs.filter((o) => o.state === "used").length;
  return (
    <li className={`bu-group${lit ? " is-lit" : ""}`} onPointerEnter={() => gpuStage.hover(ids)} onPointerLeave={() => gpuStage.hover([])}>
      <div className="bu-head">
        <h3>{g.title}</h3>
        {g.outputs[0].state === "unknown" ? <span className="bu-count faint">Can't see</span>
          : g.outputs[0].state === "some" ? <span className="num bu-count">{g.screens.length} of {g.outputs.length} in use</span>
          : <span className="num bu-count">{used} of {g.outputs.length} in use</span>}
      </div>
      <div className="bu-cells">
        {g.outputs.map((o) => (
          <button key={o.id} type="button" className={`bu-cell is-${cellState[o.state]}${pointed === o.id ? " is-lit" : ""}`}
            aria-label={`${o.label}: ${stateName[o.state]}${o.screen ? `, ${o.screen}` : ""}. Show on the card`}
            onPointerEnter={() => gpuStage.hover([o.id])} onPointerLeave={() => gpuStage.hover(ids)}
            onFocus={() => gpuStage.hover([o.id])} onBlur={() => gpuStage.hover([])}
            onClick={() => gpuStage.focus(o.id)}>
            {o.label.replace(outputKindName(o.kind), "").trim() || outputKindName(o.kind)}
          </button>
        ))}
      </div>
      {g.screens.length > 0 && <ul className="bu-items gp-screens">{g.screens.map((s) => <li key={s}>{s}</li>)}</ul>}
      <p className="bu-note">{g.note}</p>
    </li>
  );
}

function Power({ p, pointed }: { p: Ports; pointed: string | null }) {
  const ids = p.power.map((x) => x.id);
  const lit = pointed != null && ids.includes(pointed);
  const sixteen = p.power.some((x) => x.kind === "16-pin");
  return (
    <li className={`bu-group${lit ? " is-lit" : ""}`} onPointerEnter={() => gpuStage.hover(ids)} onPointerLeave={() => gpuStage.hover([])}>
      <div className="bu-head"><h3>Power</h3><span className="bu-count faint">Can't see</span></div>
      <div className="bu-cells">
        {p.power.map((x) => (
          <button key={x.id} type="button" className={`bu-cell is-unknown${pointed === x.id ? " is-lit" : ""}`}
            aria-label={`${x.label}: Windows can't see the plug. Show on the card`}
            onPointerEnter={() => gpuStage.hover([x.id])} onPointerLeave={() => gpuStage.hover(ids)}
            onFocus={() => gpuStage.hover([x.id])} onBlur={() => gpuStage.hover([])}
            onClick={() => gpuStage.focus(x.id)}>
            {x.label.replace(" power", "")}
          </button>
        ))}
      </div>
      <p className="bu-note">
        {`Windows can't see power plugs, but the card won't start without ${p.power.length > 1 ? "them" : "it"}.`}
        {sixteen ? " Push the 16-pin plug in until it clicks and no gap shows." : ""}
      </p>
    </li>
  );
}
