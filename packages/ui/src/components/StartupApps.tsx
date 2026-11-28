// Every app that starts with Windows, with a switch each. Flipping switches only drafts: the primary button opens the
// review sheet with those changes, and nothing on the PC changes until the person approves it there.
import { useEffect, useRef, useState } from "react";
import { fixSteps, startupGuide, type ActionCall, type StartupAppView } from "@rig/core";
import { useActions, useAppSelector, useUI } from "../state";
import { Row, Rows } from "./Rows";
import { useModal } from "./modal";

export const STARTUP_QUESTION = "Which of my startup apps can I safely turn off?";

/** Only there while it's open, so it isn't drawn again on every reading while it's closed. */
export function StartupApps() {
  const open = useUI().startupApps;
  const id = useAppSelector((c) => c.pc.id, Object.is);
  return open ? <OpenStartupApps key={id} /> : null;
}

/** The one grey line: what the app is, and whether Rig suggests it, or what will happen once approved. */
function metaFor(a: StartupAppView, on: boolean) {
  const g = startupGuide(a.name);
  const state = on !== a.enabled ? (on ? "On after review" : "Off after review")
    : !a.enabled ? "Turned off"
    : g?.suggest === "off" ? "Fine to turn off"
    : g?.suggest === "keep" ? "Best left on"
    : null;
  const what = g?.what ?? (state ? null : a.scope === "machine" ? "Starts for everyone on this PC" : "Starts when you sign in");
  return [what, state].filter(Boolean).join(" · ");
}

function OpenStartupApps() {
  const { set, review, ask, client } = useActions();
  const ui = useUI();
  const pc = useAppSelector((c) => ({ name: c.pc.name, apps: c.pc.settings?.startup }));
  const apps = pc.apps ?? [];
  const canChange = client.caps.applyChanges;
  // The person's picks, by name. The list keeps the order it opened in, so a row doesn't jump when its switch flips.
  const [want, setWant] = useState<Record<string, boolean>>({});
  const [order] = useState(() => [...apps].sort((a, b) => Number(b.enabled) - Number(a.enabled)).map((a) => a.name));
  const [reading, setReading] = useState(false);
  const place = (name: string) => { const i = order.indexOf(name); return i < 0 ? order.length : i; };
  const list = [...apps].sort((a, b) => place(a.name) - place(b.name));
  const onOf = (a: StartupAppView) => want[a.name] ?? a.enabled;
  const calls: ActionCall[] = list.filter((a) => onOf(a) !== a.enabled).map((a) => ({ kind: "startup.app", name: a.name, enabled: onOf(a) }));
  const suggested = list.filter((a) => onOf(a) && startupGuide(a.name)?.suggest === "off");
  const startsNow = apps.filter((a) => a.enabled).length;

  const close = () => set({ startupApps: false });
  const busy = reading || !!ui.review;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || ui.review || ui.palette) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useModal(box, true);
  // Focus starts on the dialog itself, so a screen reader reads its heading first and no button looks picked.
  useEffect(() => { sheet.current?.focus({ preventScroll: true }); }, []);

  const go = async () => {
    if (!calls.length || busy) return;
    setReading(true);
    try { await review(fixSteps(calls), { by: "you", why: "Picked in the startup apps list." }); } finally { setReading(false); }
  };
  const askRig = () => { close(); ask(STARTUP_QUESTION); };
  const n = calls.length;

  return (
    // Hidden while the review sheet is over it, and back as it was when the sheet closes.
    <div className={`scrim${ui.review ? " su-behind" : ""}`} ref={box} onClick={(e) => { if (e.target === e.currentTarget && !busy) close(); }}>
      <div ref={sheet} tabIndex={-1} className="sheet su-sheet" role="dialog" aria-modal="true" aria-labelledby="su-title">
        <div className="sheet-head">
          <span className="label">{pc.name}</span>
          <h2 id="su-title" className="plain-h">Startup apps</h2>
          <p className="muted">
            {pc.apps
              ? `${startsNow} of ${apps.length} start with Windows. Turning one off doesn't remove it: it still opens when you start it yourself.`
              : `Rig hasn't read which apps start with Windows on ${pc.name} yet.`}
          </p>
          {canChange && suggested.length > 0 && (
            <button className="btn ghost sm su-suggest" type="button" onClick={() => setWant((w) => ({ ...w, ...Object.fromEntries(suggested.map((a) => [a.name, false])) }))}>
              {suggested.length === 1 ? "Turn off the one Rig suggests" : `Turn off the ${suggested.length} Rig suggests`}
            </button>
          )}
        </div>
        {list.length > 0 && (
          <div className="su-list">
            <Rows label="Startup apps">
              {list.map((a) => {
                const on = onOf(a);
                return (
                  <Row key={a.name} name={a.name} title={a.name} meta={metaFor(a, on)}
                    action={<button type="button" className="switch set-toggle" role="switch" aria-checked={on} aria-label={a.name} disabled={!canChange || busy}
                      onClick={() => setWant((w) => ({ ...w, [a.name]: !on }))}><i /></button>} />
                );
              })}
            </Rows>
          </div>
        )}
        <p className="note faint su-note">
          {canChange ? "Nothing changes until you approve the review. You can undo it from Changes." : `Startup apps are changed from the Rig app on ${pc.name}.`}
        </p>
        <div className="sheet-foot">
          <button className="btn ghost su-ask" type="button" onClick={askRig}>Ask Rig about these</button>
          <button className="btn ghost" type="button" onClick={close}>{canChange && n ? "Cancel" : "Close"}</button>
          {canChange && (
            <button className="btn primary" type="button" disabled={!n || busy} onClick={() => void go()}>
              {reading ? "Reading settings…" : n === 0 ? "Review changes" : n === 1 ? "Review 1 change" : `Review ${n} changes`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
