import { describe, expect, it } from "vitest";
import { CustomLog, LocalClient, MemoryStore, checkProbe, customRecordings, customTable, probeWhen, scriptHash, type ChatEvent, type ProbeEdit, type RecorderLink } from "../src";
import { SimulatedLink, fixtures } from "../src/demo";
import type { CloudClient } from "../src/cloud";

const NOW = Date.UTC(2026, 10, 18, 12);
const fill = { id: "c-1", by: "chat" as const, now: NOW };

describe("custom log rules", () => {
  it("takes broad kinds and fills in sensible defaults", () => {
    const ok = [
      { kind: "sensor", match: "GPU Hot Spot" },
      { kind: "counter", path: "\\Processor(_Total)\\% Processor Time" },
      { kind: "events", channel: "Microsoft-Windows-Kernel-Power/Thermal-Operational", query: "*[System[EventID=1]]" },
      { kind: "wmi", namespace: "root\\wmi", query: "SELECT * FROM MSAcpi_ThermalZoneTemperature" },
      { kind: "process", name: "game.exe" },
      { kind: "file", path: "C:\\Games\\log.txt", read: "tail" },
      { kind: "folder", path: "C:\\Users\\Public" },
      { kind: "registry", key: "HKCU\\Software\\Rig", value: "x" },
    ];
    for (const source of ok) expect(typeof checkProbe({ label: "x", source }, fill)).toBe("object");
    const p = checkProbe({ label: "Disk", source: { kind: "counter", path: "\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer" } }, fill);
    expect(p).toMatchObject({ id: "c-1", by: "chat", every: 10, createdAt: NOW, expiresAt: NOW + 7 * 864e5 });
  });

  it("refuses commands, network paths, method calls and logs that are too fast for too long", () => {
    const bad: [unknown, RegExp][] = [
      [{ kind: "process", name: "cmd.exe /c del x" }, /program's name/],
      [{ kind: "wmi", query: "EXEC Win32_Process.Create" }, /SELECT/],
      [{ kind: "file", path: "\\\\server\\share\\x" }, /full path/],
      [{ kind: "folder", path: "..\\x" }, /full path/],
      [{ kind: "shell", text: "x" }, /kind must be/],
    ];
    for (const [source, why] of bad) expect(checkProbe({ label: "x", source }, fill)).toMatch(why);
    expect(checkProbe({ label: "x", source: { kind: "sensor", match: "x" }, every: 1, expiresAt: NOW + 3 * 864e5 }, fill)).toMatch(/at most 24 hours/);
    expect(checkProbe({ label: "x", source: { kind: "sensor", match: "x" }, expiresAt: NOW + 40 * 864e5 }, fill)).toMatch(/at most 30 days/);
    expect(checkProbe({ label: "x", source: { kind: "script", text: "Get-Date" }, every: 5 }, fill)).toMatch(/every must be 0 or 30/);
    expect(checkProbe({ label: "x", source: { kind: "script", text: "x".repeat(9000) } }, fill)).toMatch(/at most 8000/);
  });

  it("never keeps a script that does what no approval unlocks, whoever proposed it and however it runs", () => {
    const script = (text: string, shell = "powershell", admin = true) => checkProbe({ label: "Log Defender", source: { kind: "script", shell, admin, text } }, fill);
    const refused = [
      "Get-MpComputerStatus | Out-File C:\\Temp\\d.txt; Remove-Item -LiteralPath 'C:\\ProgramData\\Rig' -Recurse -Force",
      "Get-Date; Remove-Item -LiteralPath 'C:\\ProgramData\\Rig\\Reverts\\firewall-public.json'",
      "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -Name ConsentPromptBehaviorAdmin -Value 0",
      "reg delete HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System /va /f",
    ];
    for (const text of refused) expect(script(text)).toMatch(/^Rig won't keep this script: Rig never/);
    expect(script("sc config RigRecorder start= disabled", "cmd")).toMatch(/^Rig won't keep this script: Rig never/);
    expect(script("Get-MpComputerStatus | Select-Object -Property RealTimeProtectionEnabled")).toMatchObject({ source: { kind: "script" } });
    expect(script("Remove-Item -LiteralPath 'C:\\Temp\\old.log'", "powershell", false)).toMatchObject({ source: { kind: "script" } });
  });

  it("reads a condition back in plain words", () => {
    const p = checkProbe({ label: "x", source: { kind: "sensor", match: "x" }, every: 0, fast: 1, when: { metric: "gpuTemp", op: ">", value: 85 }, expiresAt: NOW + 12 * 3_600_000 }, fill);
    if (typeof p === "string") throw new Error(p);
    expect(probeWhen(p)).toBe("every 1 second while the graphics card's temperature > 85");
    expect(checkProbe({ label: "x", source: { kind: "sensor", match: "x" }, every: 0 }, fill)).toMatch(/only with a condition/);
  });

  it("fingerprints a script the same way the recorder does", async () => {
    // The same hash as ProbeRules.ScriptHash in the helper: SHA-256 of "shell\nadmin|user\ntext".
    const { createHash } = await import("node:crypto");
    expect(await scriptHash({ shell: "powershell", admin: false, text: "Get-Date" })).toBe(createHash("sha256").update("powershell\nuser\nGet-Date").digest("hex"));
    const a = await scriptHash({ shell: "powershell", admin: false, text: "Get-Date" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await scriptHash({ shell: "powershell", admin: true, text: "Get-Date" })).not.toBe(a);
    expect(await scriptHash({ shell: "powershell", admin: false, text: "Get-Date " })).not.toBe(a);
  });
});

describe("custom log data", () => {
  const spec = { id: "c-1", label: "GPU heat", by: "chat", createdAt: NOW, expiresAt: NOW + 864e5, every: 10, source: { kind: "sensor", match: "GPU" } };
  it("turns lines into a table and a recording labelled with who asked", () => {
    const log = new CustomLog();
    log.ingest([
      { k: "probe", t: NOW, id: "c-1", what: "on", spec },
      { k: "p", t: NOW + 10_000, id: "c-1", v: { "GPU Core": 70, "GPU Hot Spot": 82 } },
      { k: "p", t: NOW + 20_000, id: "c-1", when: true, cv: 86 },
      { k: "p", t: NOW + 21_000, id: "c-1", v: { "GPU Core": 75, "GPU Hot Spot": 88 } },
      { k: "p", t: NOW + 22_000, id: "c-1", err: "The sensor went away" },
      { k: "probe", t: NOW + 30_000, id: "c-1", what: "off", why: "stop" },
      "junk", { k: "p", t: NOW },
    ]);
    const e = log.entries.get("c-1")!;
    expect(customTable(e).columns).toEqual(["GPU Core", "GPU Hot Spot"]);
    // The recorder stopping isn't the log ending.
    expect(e.ended).toBeNull();
    const status = [{ id: "c-1", label: "GPU heat", kind: "sensor" as const, by: "chat" as const, createdAt: NOW, expiresAt: NOW + 864e5, every: 10, state: "on" as const }];
    const [r] = customRecordings(log, "pc-1", NOW + 60_000, status);
    expect(r).toMatchObject({ id: "bg-p-c-1", reason: "Custom log: GPU heat", by: "rig", background: true, sampleCount: 2 });
    expect(r.custom).toMatchObject({ active: true, state: "on", total: 2 });
    expect(r.custom!.notes.map((n) => n.text)).toEqual(["The condition was met (86), so it logs more often.", "The sensor went away"]);
    log.ingest([{ k: "probe", t: NOW + 40_000, id: "c-1", what: "off", why: "removed" }]);
    expect(customRecordings(log, "pc-1", NOW + 60_000, [])[0].custom).toMatchObject({ active: false, state: "ended" });
  });

  it("shows event log entries as events", () => {
    const log = new CustomLog();
    log.ingest([
      { k: "probe", t: NOW, id: "c-2", what: "on", spec: { ...spec, id: "c-2", every: 0, source: { kind: "events", channel: "System" } } },
      { k: "p", t: NOW + 1, id: "c-2", e: { log: "System", source: "Kernel-Power", id: 41, level: "error", message: "The system rebooted" } },
    ]);
    const t = customTable(log.entries.get("c-2")!, "events");
    expect(t.columns).toEqual(["Level", "Source", "Event", "Message"]);
    expect(t.rows[0].cells).toEqual(["error", "Kernel-Power", 41, "The system rebooted"]);
  });
});

describe("LocalClient and custom logs from the chat", () => {
  it("sets up what the chat asked for on this PC, never a script, and tells the chat what it keeps", async () => {
    const edits: ProbeEdit[] = [];
    const recorder: RecorderLink = {
      status: async () => ({ supported: true, service: "running", mine: "S-1", probes: { list: [{ id: "c-old", label: "Old", kind: "process", by: "chat", owner: "S-1", createdAt: NOW, expiresAt: NOW + 864e5, every: 10, state: "on" }] } }),
      read: async () => ({ records: [], cursor: null, more: false }),
      set: async () => {},
      probes: async (req) => { edits.push(req); if (req.op === "remove") throw new Error("No such log"); return []; },
      readCustom: async () => ({ records: [], cursor: null, more: false }),
    };
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => NOW });
    let sent: { probes?: unknown } | undefined;
    const add = checkProbe({ label: "Hot", source: { kind: "sensor", match: "GPU" } }, fill);
    const script = checkProbe({ label: "S", source: { kind: "script", text: "Get-Date" } }, { ...fill, id: "c-2" });
    if (typeof add === "string" || typeof script === "string") throw new Error("bad spec");
    const cloud = {
      signedIn: async () => true, sync: async () => ({}), putRecording: async () => {},
      chat: async (_id: string, _h: unknown, onEvent: (e: ChatEvent) => void, _s: unknown, live?: { probes?: unknown }) => {
        sent = live;
        onEvent({ type: "probe", op: "add", probe: add });
        onEvent({ type: "probe", op: "add", probe: script });
        onEvent({ type: "probe", op: "remove", id: "c-old" });
        onEvent({ type: "script", probe: script });
        onEvent({ type: "done" });
      },
    } as unknown as CloudClient;
    const client = new LocalClient({ ...sim, hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), events: async () => [] },
      new MemoryStore(), cloud, { tickMs: 1e9, syncEveryMs: 1e9, now: () => NOW, recorder });
    await client.start();
    const seen: ChatEvent[] = [];
    await client.chat(client.id, [{ id: "1", from: "you", text: "log it" }], (e) => seen.push(e));
    client.stop();
    expect((sent?.probes as { id: string }[]).map((p) => p.id)).toEqual(["c-old"]);
    expect(edits).toEqual([{ op: "add", probe: add }, { op: "remove", id: "c-old" }]);
    const probes = seen.filter((e) => e.type === "probe") as { error?: string }[];
    expect(probes.map((p) => p.error)).toEqual([undefined, "A script runs only once you approve it.", "No such log"]);
    // The script reaches the screen as a proposal, in order, after the changes before it.
    expect(seen.map((e) => e.type)).toEqual(["probe", "probe", "probe", "script", "done"]);
  });
});
