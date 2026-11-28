import { describe, expect, it } from "vitest";
import { buildPC, findings, safetyFindings, safetyRows, safetySummary, type SecurityFacts, type SystemFacts } from "../src";
import { DemoClient, fixtures, freshSecurity } from "../src/demo";

const DAY = 864e5;
const now = Date.UTC(2026, 10, 27, 12, 0);

/** A PC where everything was read and is fine. */
const fine = (): SecurityFacts => ({
  readAt: now,
  antivirus: [{ name: "Microsoft Defender Antivirus", enabled: true, upToDate: true }],
  defender: { realTime: true, signatureAgeDays: 0, quickScanAgeDays: 1, mode: "Normal" },
  firewall: { domain: true, private: true, public: true },
  updates: { lastInstalledAt: now - 3 * DAY, restartPending: false },
  backup: { oneDrive: ["Desktop", "Documents"] },
});

const row = (s: SecurityFacts | undefined, id: string) => safetyRows(s, now).find((r) => r.id === id)!;
const titles = (s: SecurityFacts | undefined) => safetyFindings(s, now).map((f) => f.title);

describe("safe and up to date", () => {
  it("calls a laptop a laptop in what it says and asks", () => {
    const off = { ...fine(), firewall: { domain: true, private: true, public: false } };
    const laptop = safetyRows(off, now, "laptop").find((r) => r.id === "firewall")!;
    expect(laptop.why).toBe("Other devices on public networks can reach this laptop while the firewall is off there.");
    expect(safetyRows(fine(), now, "laptop").map((r) => r.ask)).toContain("Is my laptop up to date with Windows updates?");
    expect(safetyFindings(off, now, "laptop")[0].body).toMatch(/^Other devices there can reach this laptop\./);
    expect(row(off, "firewall").why).toMatch(/reach this PC/);
  });

  it("says what it read when everything is fine, with no chips and no findings", () => {
    const rows = safetyRows(fine(), now);
    expect(rows.map((r) => [r.title, r.line, r.state, r.chip])).toEqual([
      ["Windows updates", "Last update 3 days ago", "ok", undefined],
      ["Virus protection", "Microsoft Defender, on, updated today", "ok", undefined],
      ["Firewall", "On for every network", "ok", undefined],
      ["Backup", "OneDrive keeps Desktop and Documents", "ok", undefined],
    ]);
    expect(safetyFindings(fine(), now)).toEqual([]);
    expect(safetySummary(rows)).toBe("Nothing needs a look");
  });

  it("never says something is fine that wasn't read", () => {
    const rows = safetyRows(undefined, now);
    expect(rows.map((r) => r.state)).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    expect(rows.map((r) => r.line)).toEqual(["Rig couldn't read Windows Update", "Rig couldn't read virus protection", "Rig couldn't read the firewall", "Rig couldn't tell"]);
    expect(safetySummary(rows)).toBe("Not read yet");
    expect(safetyFindings(undefined, now)).toEqual([]);
    // Windows Server has no Security Center, and Defender answered without saying it's on.
    const server = { readAt: now, defender: { signatureAgeDays: 0 } } as SecurityFacts;
    expect(row(server, "antivirus").state).toBe("unknown");
    expect(titles(server)).toEqual([]);
    // A firewall profile that wasn't read isn't counted as on.
    expect(row({ readAt: now, firewall: { public: true } }, "firewall").line).toBe("On for public networks");
  });

  it("flags no antivirus on, with the steps in Windows and a question for the chat", () => {
    const s = { ...fine(), antivirus: [], defender: { realTime: false, mode: "Normal" } };
    expect(row(s, "antivirus")).toMatchObject({ state: "look", chip: "Off", line: "No antivirus found" });
    const [f] = safetyFindings(s, now);
    expect(f).toMatchObject({ category: "Drivers and updates", severity: "bad", title: "No virus protection is on", go: "chat" });
    expect(f.body).toMatch(/Windows Security, Virus & threat protection/);
    expect(f.ask).toMatch(/turn it back on/);
  });

  it("trusts another antivirus that's on, and leaves Defender's own list alone then", () => {
    const s = { ...fine(), antivirus: [{ name: "Norton 360", enabled: true, upToDate: true }, { name: "Microsoft Defender Antivirus", enabled: false }], defender: { realTime: false, signatureAgeDays: 40, mode: "Passive Mode" } };
    expect(row(s, "antivirus")).toMatchObject({ state: "ok", line: "Norton 360, on" });
    expect(titles(s)).toEqual([]);
  });

  it("flags the firewall off on a profile, unless another firewall looks after it", () => {
    const off = { ...fine(), firewall: { domain: true, private: true, public: false } };
    expect(row(off, "firewall")).toMatchObject({ state: "look", chip: "Off", line: "Off on public networks" });
    expect(titles(off)).toEqual(["Windows Firewall is off on public networks"]);
    const covered = { ...fine(), firewall: { ...off.firewall, products: [{ name: "ZoneAlarm", enabled: true }] } };
    expect(row(covered, "firewall").state).toBe("ok");
    expect(titles(covered)).toEqual([]);
  });

  it("flags a restart that has waited more than two days, but not a fresh one", () => {
    const fresh = { ...fine(), updates: { lastInstalledAt: now - DAY, restartPending: true, restartSince: now - DAY } };
    expect(row(fresh, "updates")).toMatchObject({ state: "ok", line: "Last update yesterday · restart waiting" });
    expect(row(fresh, "updates").chip).toBeUndefined();
    expect(titles(fresh)).toEqual([]);
    const old = { ...fine(), updates: { lastInstalledAt: now - 3 * DAY, restartPending: true, restartSince: now - 3 * DAY } };
    expect(row(old, "updates")).toMatchObject({ state: "look", chip: "Restart waiting" });
    expect(titles(old)).toEqual(["Restart to finish a Windows update"]);
    expect(safetyFindings(old, now)[0].body).toMatch(/Update and restart/);
  });

  it("flags no update in 45 days or more", () => {
    expect(titles({ ...fine(), updates: { lastInstalledAt: now - 44 * DAY } })).toEqual([]);
    const s = { ...fine(), updates: { lastInstalledAt: now - 52 * DAY, restartPending: false } };
    expect(row(s, "updates")).toMatchObject({ state: "look", chip: "52 days", line: "Last update 52 days ago" });
    expect(titles(s)).toEqual(["No Windows update in 52 days"]);
  });

  it("flags Defender's virus definitions over a week old", () => {
    expect(titles({ ...fine(), defender: { realTime: true, signatureAgeDays: 7, mode: "Normal" } })).toEqual([]);
    const s = { ...fine(), defender: { realTime: true, signatureAgeDays: 9, mode: "Normal" } };
    expect(row(s, "antivirus")).toMatchObject({ state: "look", chip: "9 days old", line: "Microsoft Defender, on, updated 9 days ago" });
    expect(titles(s)).toEqual(["Virus definitions are 9 days old"]);
  });

  it("says plainly when no backup was found, without calling it a problem", () => {
    const s = { ...fine(), backup: { oneDrive: [] } };
    expect(row(s, "backup")).toMatchObject({ state: "none", line: "No File History or OneDrive folder backup" });
    expect(row(s, "backup").chip).toBeUndefined();
    expect(titles(s)).toEqual([]);
  });

  it("puts the problems in the health score under Drivers and updates", () => {
    const f: SystemFacts = { ...structuredClone(fixtures.atlas.facts), security: { ...fine(), firewall: { domain: true, private: false, public: true } } };
    const inv = structuredClone(fixtures.atlas.inv);
    const fs = findings({ inv, snap: null, facts: f, now });
    expect(fs.find((x) => x.id === "firewall-off")).toMatchObject({ category: "Drivers and updates", weight: 25 });
    const pc = buildPC(inv, null, f);
    expect(pc.breakdown?.find((b) => b.label === "Drivers and updates")?.sev).toBe("bad");
    expect(pc.security?.firewall?.private).toBe(false);
    // An older helper sends no safety readings: nothing changes.
    const { security: _s, ...old } = f;
    expect(findings({ inv, snap: null, facts: old, now }).some((x) => /firewall|virus|update in/i.test(x.title))).toBe(false);
  });
});

describe("the demo's safety readings", () => {
  it("read as a few minutes old: Atlas waits on a restart since yesterday, Pebble's virus definitions are 9 days old", async () => {
    const shifted = freshSecurity(fixtures.atlas.facts, now).security!;
    expect(now - shifted.readAt).toBe(5 * 60_000);
    const demo = new DemoClient();
    const pcs = await demo.machines();
    const atlas = pcs.find((p) => p.id === "demo-atlas")!;
    const pebble = pcs.find((p) => p.id === "demo-pebble")!;
    // A restart waiting a day isn't a problem yet: the line says so, with no chip and nothing added to Home.
    expect(safetyRows(atlas.security).filter((r) => r.state === "look")).toEqual([]);
    expect(safetyRows(atlas.security)[0].line).toBe("Last update yesterday · restart waiting");
    expect(atlas.issues?.some((i) => /restart/i.test(i.title))).toBe(false);
    expect(safetyRows(pebble.security).filter((r) => r.state === "look").map((r) => r.chip)).toEqual(["9 days old"]);
    expect(safetyRows(pebble.security).find((r) => r.id === "backup")!.line).toBe("File History copied 2 days ago");
  });
});
