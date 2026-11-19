import { useEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { formatTemp, type PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { StageSlot, getStage } from "../../components/Stage";
import { defaultAppearance } from "../../appearance";
import { sceneThemeFor } from "../../themes";
import "../../styles/pages/signin-options.css";

/* Three ways to fill the left half of the sign-in screens without the character art.
   A prototype for choosing: the one picked replaces SignInArt, the others go. */

const Brand = () => <div className="brand"><span className="brand-mark" />Rig</div>;

/** The made-up demo PC, so the art shows real parts and readings. */
function useDemoPC() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => {
    let live = true;
    new DemoClient().machines().then((all) => { if (live) setPC(all[0] ?? null); });
    return () => { live = false; };
  }, []);
  return pc;
}

/** Option A: the app's own 3D PC, turning slowly, with its parts labeled. */
export function ArtModel() {
  const pc = useDemoPC();
  useEffect(() => { if (pc) getStage().scene.setPC(pc, sceneThemeFor(defaultAppearance)); }, [pc]);
  return (
    <div className="signin-art so-model tone-dark">
      <Brand />
      <div className="so-model-stage">{pc && <StageSlot id="signin-stage" zoom={false} spin interactive={false} />}</div>
      <div className="so-caption">
        <p className="so-head">See inside your PC.</p>
        <p className="so-sub">Every part, how hot it runs, and what to fix.</p>
      </div>
    </div>
  );
}

/** Option B: a slice of Home as it looks on the demo PC, so you see what you get before you sign in. */
export function ArtPreview() {
  const pc = useDemoPC();
  const reads = pc ? Object.values(pc.parts ?? {}).filter((p) => p.temp != null).slice(0, 3) : [];
  const issue = pc?.issues?.find((i) => i.severity === "warn" || i.severity === "bad") ?? pc?.issues?.[0];
  return (
    <div className="signin-art so-preview">
      <Brand />
      {pc && (
        <div className="so-stack" aria-hidden="true">
          <div className="so-card so-status">
            <span className="so-label">{pc.name}</span>
            <b>{pc.summary}</b>
          </div>
          <div className="so-card so-temps">
            {reads.map((p) => <div key={p.type}><span className="so-label">{p.type}</span><b className={p.warn ? "hot" : undefined}>{formatTemp(p.temp!, "c", { mark: "degree" })}</b></div>)}
          </div>
          {issue && (
            <div className="so-card so-issue">
              <i />
              <div><b>{issue.title}</b><span>{issue.body}</span></div>
            </div>
          )}
        </div>
      )}
      <div className="so-caption">
        <p className="so-head">Know what's wrong with your PC.</p>
        <p className="so-sub">Rig reads every part and tells you what to do next.</p>
      </div>
    </div>
  );
}

/** Option C: a thermal picture with no characters: soft heat where the processor and graphics card sit, and a scale. */
export function ArtHeat() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  return (
    <div className="signin-art so-heat tone-dark" onPointerMove={move} onPointerLeave={() => setAt(null)}
      style={{ "--px": `${at?.x ?? 50}%`, "--py": `${at?.y ?? 50}%`, "--po": at ? 1 : 0 } as CSSProperties}>
      <Brand />
      <div className="so-heat-pic" aria-hidden="true">
        <div className="so-tower">
          <span className="so-spot cpu" /><span className="so-spot gpu" /><span className="so-spot psu" />
          <span className="so-tag" style={{ top: "24%", left: "56%" }}>Processor 61°</span>
          <span className="so-tag" style={{ top: "50%", left: "30%" }}>Graphics card 74°</span>
        </div>
        <span className="so-pointer" />
      </div>
      <div className="so-scale" aria-hidden="true"><span>90°</span><i /><span>30°</span></div>
      <div className="so-caption">
        <p className="so-head">See where your PC runs hot.</p>
      </div>
    </div>
  );
}
