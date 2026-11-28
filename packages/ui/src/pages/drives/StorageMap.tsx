import { useState, type PointerEvent } from "react";
import { moveOne, roomFor, roomWords, type DriveFill, type DriveMap } from "@rig/core";
import { Row, RowFigure, Rows } from "../../components/Rows";
import { useApp, useAppSelector, useMachineWord, useTemp } from "../../state";
import { ago } from "../games/words";
import { FreeSpace } from "./FreeSpace";

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
  const word = useMachineWord();
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
          {scanning ? `Measuring folders now. It runs slowly in the background so the ${word} stays quick.` : at ? `Folders measured ${ago(Date.parse(at))}.` : `Rig measures folders on the ${word} itself.`}
        </p>
        {measure && <button className="btn ghost sm" type="button" disabled={scanning} onClick={() => void measure()}>{scanning ? "Measuring…" : "Measure again"}</button>}
      </div>
      <ul className="sm-drives" aria-label="Drives">
        {drives.map((d, i) => <Drive key={`${d.model}-${i}`} d={d} all={drives} noAdmin={noAdmin} />)}
      </ul>
      <FreeSpace />
    </div>
  );
}

/** Past this many, the free space stays one block: the boxes would be slivers. */
const MAX_SLOTS = 16;

function Drive({ d, all, noAdmin }: { d: DriveMap; all: DriveMap[]; noAdmin: boolean }) {
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
  const room = d.scanning && unscanned ? null : roomFor(d, all);
  const words = room && roomWords(room);
  const move = room && moveOne(d, all);
  // The free space as one dashed box per game that fits, then what's left over.
  const slots = room && room.count > 0 && room.count <= MAX_SLOTS ? room.count : 0;
  const one = room?.big ? "big game" : "game";
  return (
    <li className="sm-drive">
      <div className="sm-title">
        <div>
          <h3>{d.model}</h3>
          <p className="faint">{[d.volumes.join(", "), mediaName[d.media], d.sizeGb ? size(d.sizeGb) : null].filter(Boolean).join(" · ")}</p>
        </div>
        <span className={`chip ${d.health.sev}`}>{d.health.text}</span>
      </div>

      {words && (
        <p className="sm-room">
          <b>{words.headline}</b>
          <span>{words.detail}</span>
        </p>
      )}

      {total > 0 && (
        <>
          <div className={`sm-block${d.scanning && unscanned ? " is-scanning" : ""}`} role="img" aria-label={`${d.model}: ${summary}`}>
            {d.fills.map((f) => f.kind === "free" && slots ? (
              <Slots key="free" n={slots} gb={room!.ref.gb} spare={room!.spareGb} />
            ) : (
              <i key={f.kind + f.label} className={`${fillClass[unscanned && f.kind === "other" ? "used" : f.kind]}${lit === f.kind ? " is-lit" : ""}`}
                style={{ flexGrow: f.gb }} {...hover(f.kind)}>
                {f.kind !== "free" && !unscanned && <span className="sm-in"><b>{f.label}</b>{size(f.gb)}</span>}
              </i>
            ))}
          </div>
          <p className="sm-used">
            <span><b className="num">{size(d.usedGb ?? 0)}</b> used<span className="faint"> · {size(free?.gb ?? 0)} free</span></span>
            {slots > 0 && <span className="sm-key faint"><i aria-hidden="true" />Room for one more {one}</span>}
          </p>
        </>
      )}

      {move && room && (
        <div className="sm-move">
          <p className="sm-move-label">{room.count === 0 ? "To make room" : "If it fills up"}</p>
          <Rows label={`Move one thing to ${move.to}`}>
            <Row name={move.game.name}
              title={<>Move {move.game.name} to {move.to}</>}
              meta={[size(move.game.gb), move.speed === "slower" ? "most likely loads slower from a hard drive" : move.speed === "faster" ? "most likely loads faster from an SSD" : null].filter(Boolean).join(" · ")}
              figure={move.gain > 0 ? <RowFigure value={`+${move.gain}`} word={move.gain === 1 ? one : `${one}s`} /> : <RowFigure value={`+${size(move.game.gb)}`} word="free" />}
              details={<p>Move it from the launcher it came from, so the game still starts: Steam and the Xbox app have a Move button in the game's own settings. Dragging the folder yourself usually leaves the launcher looking in the old place.</p>} />
          </Rows>
        </div>
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

/** The free space as dashed boxes, one per game of the drive's own size that still fits, then the spare. */
function Slots({ n, gb, spare }: { n: number; gb: number; spare: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => <i key={`slot${i}`} className="f-slot" style={{ flexGrow: gb }} />)}
      {spare > 0 && <i className="f-free" style={{ flexGrow: spare }} />}
    </>
  );
}
