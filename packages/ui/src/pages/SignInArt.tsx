import { useEffect, useState } from "react";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { AsciiField } from "../components/AsciiField";
import { PCPreview } from "../components/PCPreview";
import homeShot from "../assets/signin-home.webp";

/** Preview only: the left half of the sign-in screens in a few looks. Pick one with ?art=studio, night or glimpse. */
type Art = "ascii" | "studio" | "night" | "glimpse";
const arts: Art[] = ["ascii", "studio", "night", "glimpse"];

function pickArt(): Art {
  const v = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("art");
  return arts.includes(v as Art) ? (v as Art) : "ascii";
}

export function SignInArt() {
  const art = pickArt();
  if (art === "studio") return <ArtPC tone="light" />;
  if (art === "night") return <ArtPC tone="dark" />;
  if (art === "glimpse") return <ArtGlimpse />;
  return (
    <div className="signin-art tone-dark">
      <AsciiField fit={{ size: 0.78 }} />
      <Brand />
      <p className="art-note">See inside your PC.</p>
    </div>
  );
}

const Brand = () => <div className="brand"><span className="brand-mark" />Rig</div>;

const Copy = () => (
  <div className="art-copy">
    <h2>See inside your PC.</h2>
    <p>Live temperatures for every part, problems in plain words, and fixes you approve.</p>
  </div>
);

function useDemoPC() {
  const [pc, setPC] = useState<PC | null>(null);
  useEffect(() => {
    let live = true;
    void new DemoClient().machines().then((all) => { if (live) setPC(all.find((p) => p.parts) ?? null); });
    return () => { live = false; };
  }, []);
  return pc;
}

/** The same 3D PC as Home, large and swaying slowly, on a light or graphite stage. */
function ArtPC({ tone }: { tone: "light" | "dark" }) {
  const pc = useDemoPC();
  return (
    <div className={`signin-art art-inset art-pc${tone === "dark" ? " tone-dark" : ""}`}>
      <Brand />
      <div className="art-pc-stage">{pc && <PCPreview pc={pc} className="art-pc-canvas" />}</div>
      <Copy />
    </div>
  );
}

/** A glimpse of Home itself, the first thing they'll see once signed in. */
function ArtGlimpse() {
  return (
    <div className="signin-art art-inset art-glimpse">
      <Brand />
      <Copy />
      <div className="glimpse-frame" aria-hidden="true"><img src={homeShot} alt="" draggable={false} /></div>
    </div>
  );
}
