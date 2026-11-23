import { useState, type PointerEvent } from "react";
import type { DriveFill, DriveMap } from "@rig/core";
import { useApp, useAppSelector, useTemp } from "../../state";
import { ago } from "../games/words";

const size = (gb: number) => (gb >= 1000 ? `${(gb / 1000).toFixed(1)} TB` : `${Math.round(gb).toLocaleString()} GB`);
const mediaName: Record<DriveMap["media"], string> = { nvme: "NVMe SSD", ssd: "SATA SSD", hdd: "Hard drive", unknown: "Drive" };
/** Each share's color, named in full so the stylesheet check can find them. */
const fillClass: Record<DriveFill["kind"] | "used", string> = {
  windows: "f-windows", apps: "f-apps", games: "f-games", files: "f-files", system: "f-system", other: "f-other", free: "f-free", used: "f-used",
};
/** What each share holds, for the line under its name when Rig has nothing more specific. */
const fillNote: Partial<Record<DriveFill["kind"], string>> = {
  other: "Restore points, the recycle bin and folders Windows keeps locked",
  system: "Windows sets these aside for memory and sleep",
};

/** "3,120 hours, about 4 months": hours powered on, with a length people can picture. */
function hoursText(h: number) {
  const days = h / 24;
  const about = days < 60 ? `${Math.round(days)} days` : days < 730 ? `${Math.round(days / 30.4)} months` : `${(days / 365).toFixed(1)} years`;
  return `${h.toLocaleString()} hours, about ${about}`;
}

/**
 * Each drive as a block split by what fills it, biggest first, with its health beside it.
 * Folder sizes come from a scan the helper runs in the background and keeps for a day, so this never waits on the disk.
 */
export function StorageMap() {
  const drives = useAppSelector((c) => c.pc.drives, Object.is);
  const noAdmin = useAppSelector((c) => !!c.pc.issues?.some((i) => i.id === "needs-admin"));
  const { client, pc, toast } = useApp();
  if (!drives?.length) return null;
  const scanning = drives.some((d) => d.scanning);
  const at = drives.map((d) => d.scannedAt).filter(Boolean).sort()[0];
  const measure = client.caps.local && client.measureDrives
    ? () => client.measureDrives!(pc.id).catch((e) => toast(e instanceof Error ? e.message : "Couldn't measure the drives. Try again."))
    : null;
  return (
    <div className="sm-map">
      <div className="sm-head">
        <p className="faint sm-when" aria-live="polite">
          {scanning ? "Measuring folders now. It runs slowly in the background so the PC stays quick." : at ? `Folders measured ${ago(Date.parse(at))}.` : "Rig measures folders on the PC itself."}
        </p>
        {measure && <button className="btn ghost sm" type="button" disabled={scanning} onClick={() => void measure()}>{scanning ? "Measuring…" : "Measure again"}</button>}
      </div>
      <ul className="sm-drives" aria-label="Drives">
        {drives.map((d, i) => <Drive key={`${d.model}-${i}`} d={d} noAdmin={noAdmin} />)}
      </ul>
    </div>
  );
}

function Drive({ d, noAdmin }: { d: DriveMap; noAdmin: boolean }) {
  const temp = useTemp();
  const [lit, setLit] = useState<string | null>(null);
  // Only a mouse lights a share: a tap on a phone would leave it lit.
  const hover = (kind: string) => ({
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType === "mouse") setLit(kind); },
    onPointerLeave: () => setLit(null),
  });
  const total = d.fills.reduce((n, f) => n + f.gb, 0);
  const shares = d.fills.filter((f) => f.kind !== "free");
  const free = d.fills.find((f) => f.kind === "free");
  const unscanned = shares.length === 1 && shares[0].label === "Used";
  const summary = d.fills.map((f) => `${f.label} ${size(f.gb)}`).join(", ");
  return (
    <li className="sm-drive">
      <div className="sm-title">
        <div>
          <h3>{d.model}</h3>
          <p className="faint">{[d.volumes.join(", "), mediaName[d.media], d.sizeGb ? size(d.sizeGb) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`chip ${d.health.sev}`}>{d.health.text}</span>
      </div>

      {total > 0 && (
        <>
          <div className={`sm-block${d.scanning && unscanned ? " is-scanning" : ""}`} role="img" aria-label={`${d.model}: ${summary}`}>
            {d.fills.map((f) => (
              <i key={f.kind + f.label} className={`${fillClass[unscanned && f.kind === "other" ? "used" : f.kind]}${lit === f.kind ? " is-lit" : ""}`}
                style={{ flexGrow: f.gb }} {...hover(f.kind)} />
            ))}
          </div>
          <p className="sm-used"><b className="num">{size(d.usedGb ?? 0)}</b> used<span className="faint"> · {size(free?.gb ?? 0)} free</span></p>
        </>
      )}

      <div className="sm-body">
        {!unscanned && shares.length > 0 && (
          <ul className="sm-fills" aria-label={`What fills ${d.model}`}>
            {shares.map((f) => (
              <li key={f.kind} className={lit === f.kind ? "is-lit" : undefined} {...hover(f.kind)}>
                <i className={fillClass[f.kind]} aria-hidden="true" />
                <span className="sm-fill-name">{f.label}</span>
                <span className="num sm-fill-gb">{size(f.gb)}</span>
                {(f.top?.length || fillNote[f.kind]) && <span className="sm-fill-top">{f.top?.length ? f.top.slice(0, 3).map((t) => t.name).join(", ") + (f.top.length > 3 ? ` and ${f.top.length - 3} more` : "") : fillNote[f.kind]}</span>}
              </li>
            ))}
          </ul>
        )}
        {(d.lifeLeft != null || d.writtenTb != null || d.powerOnHours != null || d.temp != null || d.errors) && (
          <dl className="sm-health" role="group" aria-label={`Health of ${d.model}`}>
            {d.lifeLeft != null && (
              <div className="sm-life">
                <dt>Life left</dt>
                <dd><span className="num">{d.lifeLeft}%</span><span className={`sm-meter${d.health.sev === "ok" ? "" : " is-low"}`} aria-hidden="true"><i style={{ width: `${d.lifeLeft}%` }} /></span></dd>
              </div>
            )}
            {d.writtenTb != null && <div><dt>Written so far</dt><dd className="num">{d.writtenTb.toFixed(1)} TB</dd></div>}
            {d.powerOnHours != null && <div><dt>Powered on</dt><dd className="num">{hoursText(d.powerOnHours)}</dd></div>}
            {d.temp != null && <div><dt>Temperature</dt><dd className="num">{temp(d.temp)}</dd></div>}
            {d.errors ? <div><dt>Errors it couldn't fix</dt><dd className="num">{d.errors.toLocaleString()}</dd></div> : null}
          </dl>
        )}
      </div>
      {d.unknown.length > 0 && (
        <ul className="sm-unknown faint" aria-label={`What Windows doesn't tell Rig about ${d.model}`}>
          {d.unknown.map((u) => <li key={u}>{noAdmin && u.startsWith("Hours powered on") ? "Hours powered on: Rig needs admin rights to read them" : u}</li>)}
        </ul>
      )}
    </li>
  );
}
