import { seenLabel } from "@rig/core";
import { useApp, useTemp } from "../../state";
import { partIcon } from "../shared";

interface Pill { key: string; label: string; value: string; look?: boolean }

/** The live readings Rig can see right now, as the chat's context. */
function usePills(): Pill[] {
  const { pc } = useApp();
  const temp = useTemp();
  const pills: Pill[] = [];
  const cpu = pc.parts?.cpu, gpu = pc.parts?.gpu;
  if (cpu?.temp != null) pills.push({ key: "cpu", label: "Processor", value: temp(cpu.temp, { mark: "degree" }), look: cpu.warn });
  if (gpu?.temp != null) pills.push({ key: "gpu", label: "Graphics card", value: temp(gpu.temp, { mark: "degree" }), look: gpu.warn });
  if (pc.fans?.length) {
    const stopped = pc.alerts?.some((a) => a.kind === "fan-stopped");
    pills.push({ key: "fans", label: "Fans", value: stopped ? "one stopped" : "ok", look: stopped });
  }
  return pills;
}

export function ChatBar({ onNew }: { onNew: () => void }) {
  const { pc, data } = useApp();
  const pills = usePills();
  return (
    <header className="chat-bar">
      <div className="chat-id">
        <span className="sh-dot" style={{ background: pc.accent }} aria-hidden="true" />
        <b>{pc.name}</b>
        <span className={`chat-seen${pc.online ? " on" : ""}`}>{seenLabel(pc)}</span>
      </div>
      {pills.length > 0 && (
        <ul className="chat-live" aria-label={pc.online ? "What Rig can see now" : "Last readings"}>
          {pills.map((p) => (
            <li key={p.key} className={p.look ? "look" : undefined}>
              <i aria-hidden="true">{partIcon[p.key]}</i>
              <span className="pill-label">{p.label}</span>
              <b className="num">{p.value}</b>
            </li>
          ))}
        </ul>
      )}
      {data.chat.length > 0 && (
        <button className="btn sm chat-new" type="button" onClick={onNew} disabled={data.answering}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          New chat
        </button>
      )}
    </header>
  );
}
