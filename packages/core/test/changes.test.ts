import { describe, expect, it } from "vitest";
import { classifyEvent, cleanEvents, describeChange, eventTitle, findings, memoryTest, type PCEvent, type RawEvent } from "../src";
import { fixtures } from "../src/demo";

const NOW = Date.UTC(2026, 10, 20, 12, 0);
const HOUR = 36e5, DAY = 864e5;
const atlas = () => structuredClone(fixtures.atlas.inv);

const ev = (ago: number, source: string, id: number, message = "", level: RawEvent["level"] = "error", log: RawEvent["log"] = "System"): PCEvent =>
  ({ t: NOW - ago, log, source, id, level, message, kind: classifyEvent({ source, id, message }) });
const update = (ago: number, title: string) => ev(ago, "Microsoft-Windows-WindowsUpdateClient", 19, `Installation Successful: Windows successfully installed the following update: ${title}`, "info");
const driver = (ago: number, inf: string, status = "0x0") => ev(ago, "Microsoft-Windows-UserPnp", 20001, `Driver Management concluded the process to install driver ${inf}_amd64_7b1d2d6e7f2c1e6c\\${inf} for Device Instance ID PCI\\VEN_10DE&DEV_2783 with the following status: ${status}.`, "info");
const msi = (ago: number, name: string) => ev(ago, "MsiInstaller", 11707, `Product: ${name} -- Installation completed successfully.`, "info", "Application");
const blueScreen = (ago: number, code = "0x00000116") => [
  ev(ago, "Microsoft-Windows-WER-SystemErrorReporting", 1001, `The computer has rebooted from a bugcheck. The bugcheck was: ${code} (0x0, 0x0).`),
  ev(ago + 30_000, "Microsoft-Windows-Kernel-Power", 41, "", "critical"),
];
const appCrash = (ago: number, app: string, mod: string) =>
  ev(ago, "Application Error", 1000, `Faulting application name: ${app}, version: 1.0.0.0, time stamp: 0x65430000 Faulting module name: ${mod}, version: 32.0.15.6094, time stamp: 0x6700`, "error", "Application");
/** A quiet month of ordinary noise, so Rig knows the log reaches back. */
const backdrop = [ev(28 * DAY, "Service Control Manager", 7000, "A service failed to start.")];
const run = (events: PCEvent[], inv = atlas()) => findings({ inv, snap: null, facts: null, now: NOW, events: [...events, ...backdrop] });
const get = (events: PCEvent[], id: string, inv = atlas()) => run(events, inv).find((f) => f.id === id);

describe("what changed on the PC", () => {
  it("names updates, drivers and apps from Windows' log", () => {
    expect(describeChange(update(0, "2026-11 Cumulative Update for Windows 11 Version 24H2 for x64-based Systems (KB5046617)"))).toMatchObject({ type: "update", what: "Windows update KB5046617", graphics: false });
    expect(describeChange(update(0, "NVIDIA - Display - 32.0.15.6094"))).toMatchObject({ type: "driver", what: "the NVIDIA graphics driver (from Windows Update)", graphics: true });
    expect(describeChange(driver(0, "nv_dispig.inf"))).toMatchObject({ type: "driver", what: "the NVIDIA graphics driver", graphics: true });
    expect(describeChange(driver(0, "u0405151.inf"))).toMatchObject({ what: "the AMD graphics driver", graphics: true });
    expect(describeChange(driver(0, "rt640x64.inf"))).toMatchObject({ what: "a driver (rt640x64)", graphics: false });
    expect(describeChange(driver(0, "nv_dispig.inf", "0xE0000203"))).toBeNull();
    expect(describeChange(msi(0, "Razer Synapse"))).toMatchObject({ type: "app", what: "Razer Synapse" });
  });

  it("lists installs under their own kind, out of the problem highlights", () => {
    const e = driver(0, "nv_dispig.inf");
    expect(e.kind).toBe("change");
    expect(eventTitle(e)).toBe("Installed the NVIDIA graphics driver");
    expect(cleanEvents([{ ...e, kind: undefined }])[0].kind).toBe("change");
  });

  it("reads Windows' memory test verdict", () => {
    const pass = ev(0, "Microsoft-Windows-MemoryDiagnostics-Results", 1101, "The Windows Memory Diagnostic tested the computer's memory and detected no errors", "info");
    const fail = ev(0, "Microsoft-Windows-MemoryDiagnostics-Results", 1102, "The Windows Memory Diagnostic tested the computer's memory and detected hardware errors", "error");
    expect([memoryTest(pass), memoryTest(fail)]).toEqual(["passed", "failed"]);
    expect([pass.kind, fail.kind]).toEqual(["other", "hardware"]);
  });
});

describe("trouble that started after a change", () => {
  it("ties blue screens to the graphics driver installed just before them", () => {
    const f = get([driver(5 * DAY, "nv_dispig.inf"), ...blueScreen(4 * DAY), ...blueScreen(2 * DAY)], "crashes")!;
    expect(f.body).toMatch(/They started a day after the NVIDIA graphics driver was installed on Nov 15\. Going back to the previous driver is a quick test\.$/);
    expect(f.evidence).toContain("First one a day after the NVIDIA graphics driver was installed (Nov 15)");
  });

  it("doesn't blame a change that came after the crashes had started", () => {
    const f = get([...blueScreen(9 * DAY), driver(5 * DAY, "nv_dispig.inf"), ...blueScreen(4 * DAY)], "crashes")!;
    expect(f.body).not.toMatch(/installed/);
  });

  it("doesn't blame a change when the log doesn't reach back a week before it", () => {
    const events = [driver(5 * DAY, "nv_dispig.inf"), ...blueScreen(4 * DAY), ...blueScreen(2 * DAY)];
    const f = findings({ inv: atlas(), snap: null, facts: null, now: NOW, events }).find((x) => x.id === "crashes")!;
    expect(f.body).not.toMatch(/installed/);
  });

  it("points graphics driver resets at a driver update when the card was cool", () => {
    const resets = [1, 2, 3].map((d) => ev(d * DAY, "Display", 4101, "Display driver nvlddmkm stopped responding and has successfully recovered.", "warning"));
    const f = get([update(3 * DAY + 6 * HOUR, "NVIDIA - Display - 32.0.15.6094"), ...resets], "driver-resets")!;
    expect(f.body).toMatch(/They started hours after the NVIDIA graphics driver \(from Windows Update\) was installed/);
    expect(f.confidence).toBe("likely");
  });
});

describe("apps that crash in the same place", () => {
  it("blames the graphics driver when games crash inside its files", () => {
    const f = get([appCrash(1 * DAY, "Cyberpunk2077.exe", "nvwgf2umx.dll"), appCrash(2 * DAY, "eldenring.exe", "nvwgf2umx.dll"), appCrash(3 * DAY, "Cyberpunk2077.exe", "nvwgf2umx.dll")], "app-crash-graphics")!;
    expect(f).toMatchObject({ title: "Games and apps crashed 3 times in the graphics driver", confidence: "likely", part: "gpu" });
    expect(f.evidence).toEqual(["3 app crashes in 14 days inside nvwgf2umx.dll", "Apps: Cyberpunk2077, eldenring"]);
  });

  it("names an overlay that games keep crashing in", () => {
    const f = get([appCrash(1 * DAY, "eldenring.exe", "RTSSHooks64.dll"), appCrash(3 * DAY, "eldenring.exe", "RTSSHooks64.dll")], "app-crash-addon-rtsshooks64.dll")!;
    expect(f.title).toBe("eldenring crashed twice in RivaTuner's on-screen display (part of MSI Afterburner)");
  });

  it("suspects memory when unrelated apps crash inside Windows", () => {
    const events = ["chrome.exe", "explorer.exe", "Discord.exe", "chrome.exe"].map((a, i) => appCrash((i + 1) * DAY, a, "ntdll.dll"));
    expect(get(events, "app-crash-system")!.title).toBe("3 different apps crashed inside Windows itself");
    expect(run(events.slice(0, 3)).map((f) => f.id)).not.toContain("app-crash-system");
  });

  it("leaves an app crashing in its own code alone", () => {
    const events = [1, 2, 3].map((d) => appCrash(d * DAY, "game.exe", "game.exe"));
    expect(run(events).map((f) => f.id).filter((i) => i.startsWith("app-crash"))).toEqual([]);
  });
});

describe("Windows' memory test", () => {
  const result = (ago: number, ok: boolean) => ev(ago, "Microsoft-Windows-MemoryDiagnostics-Results", ok ? 1101 : 1102, `The Windows Memory Diagnostic tested the computer's memory and detected ${ok ? "no errors" : "hardware errors"}`, ok ? "info" : "error");

  it("says plainly when it found errors, and leans the crash diagnosis on it", () => {
    const fs = run([result(6 * DAY, false), ...blueScreen(2 * DAY, "0x0000001A")]);
    expect(fs.find((f) => f.id === "mem-test-failed")).toMatchObject({ severity: "bad", confidence: "sure", part: "ram" });
    expect(fs.find((f) => f.id === "crashes")!.body).toMatch(/memory test found errors, so memory is the likely cause/);
  });

  it("notes a passed test against memory crashes", () => {
    const f = get([result(6 * DAY, true), ...blueScreen(2 * DAY, "0x0000001A")], "crashes")!;
    expect(f.evidence).toContain("Windows Memory Diagnostic on Nov 14: no errors");
    expect(run([result(6 * DAY, true)]).map((x) => x.id)).not.toContain("mem-test-failed");
  });
});
