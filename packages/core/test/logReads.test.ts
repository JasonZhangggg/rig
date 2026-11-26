// The chat's log reads: what they may look at, how small they stay, and which count as outside text.
// The helper reads the same table (rules/logs.json) and checks each read again (LogReads.cs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOG_RULES, LOG_SOURCES, LOG_TOPICS, checkLogRead, checkRead, logFilesText, logWhat, readTaints, readWhat, topicsText, type PcReadSpec } from "../src";

const read = (raw: Record<string, unknown>) => {
  const r = checkRead({ kind: "log", ...raw });
  if (typeof r === "string") throw new Error(`refused: ${r}`);
  return r;
};
const refused = (raw: Record<string, unknown>) => {
  const r = checkRead({ kind: "log", ...raw });
  if (typeof r !== "string") throw new Error(`allowed: ${JSON.stringify(r)}`);
  return r;
};

describe("log reads", () => {
  it("reads any event log channel, narrowed by source, id, level and text", () => {
    expect(read({ source: "events", channel: "Microsoft-Windows-Windows Defender/Operational", providers: ["Microsoft-Windows-Windows Defender"], ids: [5001, 5007], levels: ["error", "warning", "error"], contains: "real-time", hours: 24, max: 10 }))
      .toEqual({ kind: "log", source: "events", channel: "Microsoft-Windows-Windows Defender/Operational", providers: ["Microsoft-Windows-Windows Defender"], ids: [5001, 5007], levels: ["error", "warning"], contains: "real-time", hours: 24, max: 10 });
    expect(read({ source: "events", channel: " System " })).toEqual({ kind: "log", source: "events", channel: "System" });
    expect(refused({ source: "events" })).toContain("needs channel");
  });

  it("keeps names that could change the query out", () => {
    expect(refused({ source: "events", channel: "System'] or 1=1" })).toContain("needs channel");
    expect(refused({ source: "events", channel: "System", providers: ["Display' or @Name='x"] })).toContain("providers must be");
    expect(refused({ source: "events", channel: "System", ids: [70000] })).toContain("ids must be");
    expect(refused({ source: "events", channel: "System", levels: ["loud"] })).toContain("levels must be");
    expect(refused({ source: "events", channel: "System", contains: "<x>" })).toContain("contains must be plain text");
    expect(refused({ source: "events", channel: "System", contains: "a".repeat(LOG_RULES.limits.containsChars + 1) })).toContain("contains must be");
  });

  it("stays small: a bounded window and count", () => {
    const now = Date.parse("2026-11-26T00:00:00Z");
    expect(refused({ source: "events", channel: "System", hours: LOG_RULES.limits.maxHours + 1 })).toContain("hours must be");
    expect(refused({ source: "events", channel: "System", hours: 0 })).toContain("hours must be");
    expect(refused({ source: "events", channel: "System", max: LOG_RULES.limits.maxEvents + 1 })).toContain("max must be");
    expect(refused({ source: "events", channel: "System", max: 2.5 })).toContain("max must be");
    expect(refused({ source: "events", channel: "System", from: "yesterday" })).toContain("from and to must be times");
    expect(refused({ source: "events", channel: "System", from: "2026-11-25T00:00:00Z", to: "2026-11-24T00:00:00Z" })).toContain("from must be before to");
    expect(checkLogRead({ source: "events", channel: "System", from: "2026-01-01T00:00:00Z" }, now)).toContain("at most 90 days back");
    // from wins over hours, and times come back in UTC.
    expect(checkLogRead({ source: "topic", topic: "firewall", from: "2026-11-25T10:00:00-08:00", hours: 5 }, now)).toEqual({ kind: "log", source: "topic", topic: "firewall", from: "2026-11-25T18:00:00.000Z" });
    expect(read({ source: "vendor", vendor: "nvidia", max: LOG_RULES.limits.maxFiles })).toMatchObject({ max: LOG_RULES.limits.maxFiles });
    expect(refused({ source: "vendor", vendor: "nvidia", max: LOG_RULES.limits.maxFiles + 1 })).toContain("max must be");
    expect(refused({ source: "file", file: "cbs", lines: LOG_RULES.limits.maxLines + 1 })).toContain("lines must be");
  });

  it("reads topics, named files and makers' logs from the table only", () => {
    for (const topic of LOG_TOPICS) expect(read({ source: "topic", topic })).toMatchObject({ topic });
    expect(refused({ source: "topic", topic: "passwords" })).toContain("needs topic");
    expect(read({ source: "file", file: "setupapi", lines: 5 })).toEqual({ kind: "log", source: "file", file: "setupapi", lines: 5 });
    expect(refused({ source: "file", file: "C:\\Windows\\System32\\config\\SAM" })).toContain("needs file");
    expect(read({ source: "vendor", vendor: "dell", file: "C:\\ProgramData\\Dell\\UpdateService\\Log\\Activity.log" })).toMatchObject({ file: "C:\\ProgramData\\Dell\\UpdateService\\Log\\Activity.log" });
    expect(refused({ source: "vendor", vendor: "toshiba" })).toContain("needs vendor");
    for (const file of ["C:\\ProgramData\\NVIDIA Corporation\\..\\Microsoft\\x.log", "C:\\ProgramData\\NVIDIA\\creds.dat", "\\\\server\\share\\x.log", "ProgramData\\x.log", "C:\\ProgramData\\NVIDIA\\a?.log"]) {
      expect(refused({ source: "vendor", vendor: "nvidia", file })).toContain("file must be");
    }
    expect(read({ source: "channels", find: "Kernel" })).toEqual({ kind: "log", source: "channels", find: "Kernel" });
    expect(read({ source: "esrt", hours: 4 })).toEqual({ kind: "log", source: "esrt" });
    expect(refused({ source: "everything" })).toContain("needs a source");
  });

  it("counts every log as outside text except crash stop codes and firmware status", () => {
    const taints = (raw: Record<string, unknown>) => readTaints(read(raw) as PcReadSpec);
    expect(taints({ source: "crashes" })).toBe(false);
    expect(taints({ source: "esrt" })).toBe(false);
    for (const raw of [{ source: "events", channel: "Application" }, { source: "topic", topic: "apps" }, { source: "wer" }, { source: "reliability" }, { source: "file", file: "cbs" }, { source: "vendor", vendor: "hp" }, { source: "channels" }]) {
      expect(taints(raw)).toBe(true);
    }
  });

  it("says what each read looks at", () => {
    expect(readWhat(read({ source: "events", channel: "System" }) as PcReadSpec)).toBe("the System event log");
    expect(logWhat(read({ source: "topic", topic: "firewall" }) as never)).toContain("firewall");
    for (const source of LOG_SOURCES) {
      const raw = { source, channel: "System", topic: "gpu", file: source === "file" ? "cbs" : undefined, vendor: "nvidia" };
      expect(readWhat(read(raw) as PcReadSpec).length).toBeGreaterThan(3);
    }
  });

  it("has a topic for every kind of change Rig makes, with channels the checks take", () => {
    const covered = new Set(Object.values(LOG_RULES.topics).flatMap((t) => t.for));
    for (const kind of ["fix", "recipe", "registry", "service", "firewall", "policy", "device", "driver", "app", "gpu", "fileEdit", "firmware", "protection", "screen", "command"]) expect(covered).toContain(kind);
    for (const [k, t] of Object.entries(LOG_RULES.topics)) {
      expect(t.queries.length, k).toBeGreaterThan(0);
      for (const q of t.queries) expect(checkRead({ kind: "log", source: "events", channel: q.channel, providers: q.providers, ids: q.ids }), `${k}: ${q.channel}`).not.toBeTypeOf("string");
      for (const a of t.also) expect(LOG_SOURCES.some((s) => a.includes(s)) || Object.keys(LOG_RULES.files).some((f) => a.includes(f)), `${k} also: ${a}`).toBe(true);
    }
    expect(topicsText()).toContain("- firewall:");
    expect(logFilesText()).toContain("setupapi");
  });

  it("is embedded in the helper", () => {
    const csproj = readFileSync(new URL("../../../helper/RigHelper/RigHelper.csproj", import.meta.url), "utf8");
    expect(csproj).toContain('packages\\core\\src\\rules\\logs.json" LogicalName="Rig.Rules.logs.json"');
  });
});
