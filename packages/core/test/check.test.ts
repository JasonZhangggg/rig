import { describe, expect, it } from "vitest";
import { cardTier, catalog, checkScript, checkStep, commandHash, rulesVersion, stepHash, stepsTitle, type Command, type ScriptUse, type Step, type Verdict } from "../src";
import { canonicalCommand, canonicalStep, type HelperStep, type ScreenLook } from "../src/change";
import vectors from "../src/rules/vectors.json";

interface Expect { refused?: true; why?: string; tier?: number; commands?: string[]; reasons?: string[] }
/** A script vector, with `times` when the script is repeated (joined with "; ") to make a long one. */
interface ScriptVector { script: string; as: ScriptUse; times?: number; expect: Expect; note?: string }
/** A whole step, checked the way the server and the helper check one before showing a card. */
interface StepVector { step: Step; as: "step"; expect: Expect; note?: string }
/** A program's image for a screen step. Only the helper applies these rules, so its self-test runs them. */
interface ScreenVector { image: string; as: "screen" }
const everything = vectors as (ScriptVector | StepVector | ScreenVector)[];
const all = everything.filter((v): v is ScriptVector => v.as !== "step" && v.as !== "screen");
const stepVectors = everything.filter((v): v is StepVector => v.as === "step");
const textOf = (v: ScriptVector) => (v.times ? Array(v.times).fill(v.script).join("; ") : v.script);
const names = (list: { name: string }[]) => list.map((c) => c.name.toLowerCase());

const menuDelay: Command = {
  does: "Makes menus open faster.",
  read: "Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay",
  run: "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 100",
  undo: "Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay -Value 400",
  touches: [{ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "MenuShowDelay" }],
};
const command = (patch: Partial<Command> = {}): Step => ({ kind: "command", cmd: { ...menuDelay, ...patch } });
const gameMode: Step = { kind: "fix", call: { kind: "windows.gameMode", enabled: true } };
const refusal = (s: Step, tainted = false) => {
  const v = checkStep(s, { tainted });
  return v.status === "refused" ? v : null;
};

describe("a command's fingerprint", () => {
  it("is the one the helper works out, and changes with any part", async () => {
    // The helper's self-test holds Command.Hash to the same value for the same command.
    const a = await commandHash(menuDelay);
    expect(a).toBe("684001665991492c95d668bca82a394c0671daabf81b71ae978766d18c07e053");
    expect(await commandHash({ ...menuDelay, undo: undefined })).not.toBe(a);
    expect(await commandHash({ ...menuDelay, run: `${menuDelay.run} ` })).not.toBe(a);
    expect(await commandHash({ ...menuDelay, touches: [{ kind: "registry", key: "HKCU\\Control Panel\\Desktop" }] })).not.toBe(a);
  });
});

describe("a step's fingerprint", () => {
  const native: Step = { kind: "native", op: { name: "selftest", value: "rig", run: true } };

  it("is a command's own for a command, so an older Rig app and this helper agree", async () => {
    expect(await stepHash({ kind: "command", cmd: menuDelay })).toBe(await commandHash(menuDelay));
  });

  it("is the one the helper works out for a native step, and changes with any part", async () => {
    // The helper's self-test holds NativeOpStep.Hash to the same value for the same step.
    const a = await stepHash(native);
    expect(a).toBe("50bcf6ce4cdf697f2b1132c10add612042fab4e88029143c42eed35ed06afbf6");
    expect(await stepHash({ kind: "native", op: { run: true, value: "rig", name: "selftest" } })).toBe(a);
    expect(await stepHash({ kind: "native", op: { name: "selftest", value: "rig" } })).not.toBe(a);
    expect(await stepHash({ kind: "native", op: { name: "selftest", value: "rig " , run: true } })).not.toBe(a);
  });

  it("can't be made the same by moving text between parts", async () => {
    const one = { kind: "native", op: { name: "selftest", value: "a\"b" } } as Step;
    const two = { kind: "native", op: { name: "selftest", value: "a", b: "" } } as unknown as Step;
    expect(await stepHash(one)).not.toBe(await stepHash(two));
  });
});

describe("the shared vectors", () => {
  it("cover reads, changes and undos", () => {
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(new Set(all.map((v) => v.as))).toEqual(new Set(["read", "run", "undo"]));
    expect(stepVectors.length).toBeGreaterThanOrEqual(10);
  });

  const meets = (got: Verdict, e: Expect) => {
    expect(got.rulesVersion).toBe(rulesVersion);
    if (e.refused) {
      expect(got.status).toBe("refused");
      if (got.status === "refused") {
        expect(got.refused.length).toBeGreaterThan(20);
        if (e.why) expect(got.why).toBe(e.why);
      }
    } else {
      expect(got).toMatchObject({ status: "allowed", ...(e.tier === undefined ? {} : { tier: e.tier }) });
    }
    if (e.commands) expect(names(got.commands)).toEqual(e.commands.map((n) => n.toLowerCase()));
    if (e.reasons) {
      const said = got.status === "allowed" ? got.reasons.join(" ").toLowerCase() : "";
      for (const r of e.reasons) expect(said).toContain(r.toLowerCase());
    }
  };

  it.each(all.map((v) => [v.as, v.script.slice(0, 120), v] as const))("%s: %s", (_as, _script, v) => meets(checkScript(textOf(v), v.as), v.expect));

  it.each(stepVectors.map((v) => [v.note ?? "", v.step.kind === "command" ? v.step.cmd.run : "", v] as const))("step (%s): %s", (_note, _run, v) => meets(checkStep(v.step), v.expect));

  it("never lets a read through as anything but tier 0", () => {
    for (const v of all.filter((x) => x.as === "read")) {
      const got = checkScript(textOf(v), "read");
      if (got.status === "allowed") expect(got).toMatchObject({ tier: 0, admin: false });
    }
  });

  it("never rates a change below tier 2", () => {
    for (const v of all.filter((x) => x.as !== "read")) {
      const got = checkScript(textOf(v), v.as);
      if (got.status === "allowed") expect(got.tier).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("what a refusal says", () => {
  it("names the command and why, in plain words", () => {
    expect(checkScript("New-LocalUser -Name helper", "run")).toMatchObject({ status: "refused", why: "never", refused: "Rig won't run New-LocalUser: it adds a Windows account, which could let someone else in." });
    expect(checkScript("cmd /c del C:\\x", "run")).toMatchObject({ why: "refused", refused: "Rig won't run cmd: it starts another shell, and Rig can't check what runs inside it." });
    expect(checkScript("Get-Service -ComputerName srv", "read")).toMatchObject({ why: "refused", refused: "Rig won't run Get-Service: it would act on another computer or as another account." });
    expect(checkScript("Get-Service -RequiredServices", "read")).toMatchObject({ refused: expect.stringContaining("Get-Service with -requiredservices") });
    expect(checkScript("Get-Service | % { $_.Stop() }", "run")).toMatchObject({ refused: expect.stringContaining("calls a method on an object") });
    expect(checkScript("", "run")).toMatchObject({ status: "refused" });
  });

  it("still lists the commands it found", () => {
    const got = checkScript("Get-Service -Name Spooler; iex $x", "run");
    expect(got.status).toBe("refused");
    expect(names(got.commands)).toEqual(["get-service", "invoke-expression"]);
  });
});

describe("checking a step", () => {
  it("gives a fix its tier from the catalog, and every fix is tier 1", () => {
    expect(catalog.map((a) => a.kind)).toEqual(["power.plan", "startup.app", "windows.gameMode", "windows.visualEffects", "power.maxProcessorState", "display.refreshRate", "power.setting"]);
    expect(catalog.map((a) => a.tier)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(checkStep(gameMode)).toMatchObject({ status: "allowed", tier: 1, commands: [] });
    expect(refusal({ kind: "fix", call: { kind: "power.plan", guid: "nope" } })?.refused).toContain("power plan GUID");
  });

  it("rates a registry change with an undo tier 2 and lists its commands in plain words", () => {
    const got = checkStep(command());
    expect(got).toMatchObject({ status: "allowed", tier: 2, admin: false, rulesVersion });
    expect(got.commands).toContainEqual({ name: "Set-ItemProperty", says: "Set-ItemProperty: changes a registry value", tier: 2, script: "run" });
    expect(got.commands[0]).toEqual({ name: "Get-ItemProperty", says: "Get-ItemProperty: reads a registry value or file details", tier: 0, script: "read" });
  });

  it("works out admin from the commands and what they touch", () => {
    expect(checkStep(command({ run: "Set-Service -Name Spooler -StartupType Manual", touches: [{ kind: "service", name: "Spooler" }] }))).toMatchObject({ admin: true });
    expect(checkStep(command({ touches: [{ kind: "registry", key: "HKLM\\SOFTWARE\\Foo" }] }))).toMatchObject({ admin: true });
    expect(checkStep(command({ run: "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Foo' -Name Bar -Value 1" }))).toMatchObject({ admin: true });
  });

  it("refuses a read script that could change something, and says which part", () => {
    expect(refusal(command({ read: "Set-ItemProperty -Path 'HKCU:\\Software\\Foo' -Name Bar -Value 1" }))?.refused).toMatch(/^The read script was refused\. .*Set-ItemProperty/);
    expect(refusal(command({ read: "Get-Service > C:\\out.txt" }))?.refused).toContain("writes its output to a file");
  });

  it("checks the undo script like the change", () => {
    expect(refusal(command({ undo: "Set-MpPreference -ExclusionPath C:\\Games" }))).toMatchObject({ why: "never", refused: expect.stringMatching(/^The undo script was refused\./) });
    expect(checkStep(command({ undo: "Remove-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name MenuShowDelay" }))).toMatchObject({ tier: 3 });
  });

  it("rates a change tier 3 when there is no undo and Rig can't snapshot what it touches", () => {
    const rule = { run: "New-NetFirewallRule -Profile Private -Direction Inbound -Action Allow -DisplayName 'Game' -LocalPort 27015 -Protocol TCP", read: "Get-NetFirewallRule -DisplayName 'Game'" };
    expect(checkStep(command({ ...rule, undo: undefined, touches: [{ kind: "firewall", name: "Game" }] }))).toMatchObject({ tier: 3 });
    expect(checkStep(command({ ...rule, undo: undefined, touches: [] }))).toMatchObject({ tier: 3 });
    expect(checkStep(command({ ...rule, undo: "Remove-NetFirewallRule -DisplayName 'Game'", touches: [{ kind: "firewall", name: "Game" }] }))).toMatchObject({ tier: 3 });
    expect(checkStep(command({ ...rule, undo: "Disable-NetFirewallRule -DisplayName 'Game'", touches: [{ kind: "firewall", name: "Game" }] }))).toMatchObject({ tier: 2, admin: true });
    expect(checkStep(command({ undo: undefined }))).toMatchObject({ tier: 2 });
  });

  it("refuses a never-list place in what it touches, even when the script hides the path", () => {
    const hidden = command({ run: "Set-ItemProperty -Path $k -Name Updater -Value 'C:\\x.exe'", touches: [{ kind: "registry", key: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" }] });
    expect(refusal(hidden)).toMatchObject({ why: "never", refused: expect.stringContaining("Run keys") });
    expect(refusal(command({ touches: [{ kind: "file", path: "C:\\Windows\\System32\\drivers\\etc\\hosts" }] }))).toMatchObject({ why: "never" });
    expect(refusal(command({ touches: [{ kind: "file", path: "\\\\srv\\share\\x" }] }))).not.toBeNull();
    expect(refusal(command({ touches: [{ kind: "registry", key: "Software\\Foo" }] }))).not.toBeNull();
  });

  it("rates a change tier 3 when what it touches lowers one of Windows' protections, and refuses one that hides where it writes", () => {
    const key = "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System";
    const uac = command({ run: `Set-ItemProperty -Path 'HKLM:\\${key.slice(5)}' -Name EnableLUA -Value $v`, touches: [{ kind: "registry", key, value: "EnableLUA" }] });
    expect(checkStep(uac)).toMatchObject({ status: "allowed", tier: 3, admin: true, reasons: expect.arrayContaining([expect.stringContaining("User Account Control")]) });
    expect(refusal(uac, true)).toMatchObject({ why: "tainted" });
    expect(refusal(command({ run: "Set-ItemProperty -Path $k -Name $n -Value 0", touches: uac.kind === "command" ? uac.cmd.touches : [] }))?.refused).toContain("worked out while the script runs");
  });

  it("stores a command the same way however it arrives", () => {
    const got = canonicalCommand({ ...menuDelay, undo: null, touches: [{ kind: "registry", key: "HKEY_CURRENT_USER\\Control Panel\\Desktop\\", value: "MenuShowDelay" }] });
    expect(got).toEqual({ ...menuDelay, undo: undefined, touches: [{ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "MenuShowDelay" }] });
    expect(got).not.toHaveProperty("undo");
    expect(canonicalCommand({ ...menuDelay, touches: [{ kind: "registry", key: "HKCU:\\Control Panel\\Desktop" }] })).toMatchObject({ touches: [{ key: "HKCU\\Control Panel\\Desktop" }] });
    expect(typeof canonicalCommand({ ...menuDelay, touches: [{ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: 5 }] })).toBe("string");
    expect(typeof canonicalCommand({ ...menuDelay, undo: 5 })).toBe("string");
  });

  it("says when a touch isn't written, and needs every write covered when there is no undo", () => {
    const stray = checkStep(command({ undo: undefined, touches: [{ kind: "registry", key: "HKCU\\Software\\Rig" }] }));
    expect(stray).toMatchObject({ status: "allowed", tier: 3, reasons: expect.arrayContaining([expect.stringContaining("doesn't write there"), expect.stringContaining("no undo script")]) });
    expect(checkStep(command({ undo: undefined }))).toMatchObject({ status: "allowed", tier: 2 });
    expect(checkStep(command({ undo: undefined, touches: [{ kind: "registry", key: "HKCU\\Control Panel" }] }))).toMatchObject({ tier: 2 });
  });

  it("says which kind of refusal it is", () => {
    expect(refusal(command({ read: "Get-Service | Stop-Service" }))).toMatchObject({ why: "notRead" });
    expect(refusal(command({ run: "iex $code" }))).toMatchObject({ why: "refused" });
    expect(refusal(command({ run: "$env:Path = 'C:\\x;' + $env:Path" }))).toMatchObject({ why: "refused", refused: expect.stringContaining("$env:Path") });
    expect(refusal(command({ run: "Disable-ComputerRestore -Drive 'C:\\'" }))).toMatchObject({ why: "never" });
  });

  it("refuses a change that can't be undone once the chat has read outside text", () => {
    const wipe = command({ run: "Remove-Item 'C:\\Temp\\old' -Recurse", undo: undefined, touches: [{ kind: "file", path: "C:\\Temp\\old" }] });
    expect(checkStep(wipe)).toMatchObject({ status: "allowed", tier: 3 });
    expect(refusal(wipe, true)).toMatchObject({ why: "tainted", refused: expect.stringContaining("read text from outside") });
    expect(checkStep(command(), { tainted: true })).toMatchObject({ status: "allowed", tier: 2 });
  });

  it("refuses a request with a part missing", () => {
    expect(refusal({ kind: "command", cmd: { ...menuDelay, read: "" } })).not.toBeNull();
    expect(refusal({ kind: "command", cmd: { ...menuDelay, does: " " } })).not.toBeNull();
  });
});

describe("checking a change in an app's window", () => {
  const lookId = "0123456789abcdef0123456789abcdef";
  const look: ScreenLook = { lookId, path: ["Manage 3D settings", "Low Latency Mode"], value: "Off", options: ["Off", "On", "Ultra"], clean: true };
  const slider: ScreenLook = { lookId, path: ["Brightness"], value: "40", range: { min: 0, max: 100 }, clean: false };
  const screen = (patch: Record<string, unknown> = {}) => ({ kind: "native", op: { name: "screen", lookId, to: "Ultra", does: "Turns on low latency mode.", ...patch } }) as unknown as Step;

  it("is always the strongest card, and never needs admin rights", () => {
    expect(checkStep(screen(), { tainted: false, looks: [look] })).toMatchObject({ status: "allowed", tier: 3, admin: false });
    expect(checkStep(screen({ tier: 1 }), { tainted: false, looks: [look] })).toMatchObject({ tier: 3 });
    expect(stepsTitle([screen()])).toBe("Turns on low latency mode");
  });

  it("is refused without the look it came from", () => {
    expect(refusal(screen())?.refused).toMatch(/hasn't looked/);
    expect(checkStep(screen({ lookId: "f".repeat(32) }), { tainted: false, looks: [look] })).toMatchObject({ status: "refused" });
  });

  it("is refused when the new value isn't one the app offers", () => {
    const at = (s: Step, l: ScreenLook) => checkStep(s, { tainted: false, looks: [l] });
    expect(at(screen({ to: "Maximum" }), look)).toMatchObject({ status: "refused", refused: "The app doesn't offer that value for this setting." });
    expect(at(screen({ to: "on" }), look).status).toBe("refused");
    expect(at(screen({ to: "Off" }), look)).toMatchObject({ status: "refused", refused: "The setting already has that value." });
    expect(at(screen({ to: "75" }), slider).status).toBe("allowed");
    expect(at(screen({ to: "12.5" }), slider).status).toBe("allowed");
    for (const to of ["101", "-1", "1e2", "0x10", " 50", "50 ", "Infinity", ""]) expect(at(screen({ to }), slider).status, to).toBe("refused");
  });

  it("carries nothing but the look's id, the value and the sentence", async () => {
    const sent = screen({ hops: ["Restore defaults"], app: "C:\\Windows\\regedit.exe", from: "Off", look: { value: "x" } });
    expect(canonicalStep(sent as HelperStep)).toEqual({ kind: "native", op: { name: "screen", lookId, to: "Ultra", does: "Turns on low latency mode." } });
    expect(refusal(screen({ to: "two\nlines" }))?.refused).toMatch(/needs the look/);
    expect(refusal(screen({ to: "caf\u00e9" }))?.refused).toMatch(/needs the look/);
    expect(refusal(screen({ lookId: "../../x" }))?.refused).toMatch(/needs the look/);
  });

  it("in a chat that read outside text, is offered only when the look was clean", () => {
    expect(checkStep(screen(), { tainted: true, looks: [look] }).status).toBe("allowed");
    expect(checkStep(screen(), { tainted: true, looks: [{ ...look, clean: false }] })).toMatchObject({ status: "refused", why: "tainted" });
    expect(cardTier([screen()], { tainted: true, looks: [{ ...look, clean: false }] })).toBe("refused");
  });
});

describe("checking a native step", () => {
  const native = (op: Record<string, unknown>) => ({ kind: "native", op }) as unknown as Step;

  it("takes its tier from Rig's own table and never needs admin rights", () => {
    expect(checkStep(native({ name: "selftest", value: "rig", tier: 0, admin: true }))).toMatchObject({ status: "allowed", tier: 2, admin: false, commands: [] });
    expect(cardTier([gameMode, native({ name: "selftest", value: "rig" })])).toBe(2);
  });

  it("refuses an op Rig doesn't know and one with a part missing", () => {
    expect(refusal(native({ name: "toString" }))?.refused).toBe("This isn't a kind of change Rig makes.");
    expect(refusal(native({ name: "selftest" }))?.refused).toBe("The self-test op needs a short value.");
    expect(cardTier([gameMode, native({ name: "nope" })])).toBe("refused");
  });

  it("has a title for the changes log", () => {
    expect(stepsTitle([native({ name: "selftest", value: "rig" })])).toBe("Ran Rig's self-test change");
    expect(stepsTitle([gameMode, native({ name: "selftest", value: "rig" })])).toBe("2 changes");
  });
});

describe("the card's tier", () => {
  it("is that of its riskiest step", () => {
    expect(cardTier([])).toBe(0);
    expect(cardTier([gameMode])).toBe(1);
    expect(cardTier([gameMode, command()])).toBe(2);
    expect(cardTier([command(), command({ run: "Stop-Process -Name chrome" }), gameMode])).toBe(3);
  });

  it("is refused when any step is", () => {
    expect(cardTier([gameMode, command({ run: "bcdedit /set testsigning on" })])).toBe("refused");
    expect(cardTier([command({ run: "Stop-Process -Name chrome" })], { tainted: true })).toBe("refused");
  });
});
