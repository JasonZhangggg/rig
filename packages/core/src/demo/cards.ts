// One of each approval card for the demo: a command the chat can propose, what
// the helper would say when it previews it, and what comes back when the
// person applies or undoes it. The verdicts come from the same check the app
// runs, so the cards show real parsed commands and tiers.

import { checkStep, nativeOps, type ApplyReply, type Command, type CommandUndo, type HelperStep, type HelperUndo, type NativeOp, type NativeRule, type PreviewReply, type RunResult, type Touch, type UndoReply } from "../change";
import type { Proposal } from "../client";
import type { ScreenLook } from "../screen";
import { recipeCommand, type RecipeStep } from "../shorthand";
import { FIRMWARE_SETTINGS } from "../firmware";

interface DemoBase {
  /** A question that brings this card up in the demo chat. */
  ask: string;
  asks: RegExp;
  /** What Rig says above the card. */
  says: string;
  title: string;
  /** What `read` prints before the change; for a native op, the helper's own read. */
  read: string;
  /** Each touch's value before and after, in the order of the step's touches. */
  values: [before: string | null, after: string | null][];
  after: string;
  alsoChanged?: string[];
  /** The demo rolls this one back when it's applied. */
  rollsBack?: boolean;
  /** Places something else changed after the demo applied this one, so its first undo comes back drifted. */
  drifts?: string[];
  /** Steps Rig offers when the change is refused. */
  steps?: string[];
}

export interface DemoCard extends DemoBase {
  key: "registry" | "firewall" | "uninstall" | "refused" | "rollback" | "recipe" | "storageSense";
  cmd: Command;
  /** The recipe the chat proposes; `cmd` is what it compiles to. */
  recipe?: RecipeStep;
}
/** A native op the demo can show, preview, apply and undo. */
export interface DemoNativeCard extends DemoBase { key: "gpu" | "fileEdit" | "screen" | "firmware" | "chargeLimit" | "restartToFirmware"; op: NativeOp; /** What the helper found in the app's window, for a screen step. */ look?: ScreenLook }
export type AnyDemoCard = DemoCard | DemoNativeCard;

const extensions: RecipeStep = { kind: "recipe", id: "fileExtensions", params: { state: "show" } };
const storageSense: RecipeStep = { kind: "recipe", id: "storageSense", params: { state: "on" } };

const seconds = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";
const secondsPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced";

export const demoCards: DemoCard[] = [
  {
    key: "registry", ask: "Show seconds on the taskbar clock", asks: /taskbar clock|show seconds/,
    says: "Windows can show seconds on the taskbar clock. It's one value in your own settings, and Rig saves the old value first.",
    title: "Show seconds on the taskbar clock",
    cmd: {
      does: "Turns on seconds in the taskbar clock for your Windows account.",
      read: `Get-ItemProperty -Path '${secondsPath}' -Name ShowSecondsInSystemClock`,
      run: `Set-ItemProperty -Path '${secondsPath}' -Name ShowSecondsInSystemClock -Value 1`,
      undo: `Set-ItemProperty -Path '${secondsPath}' -Name ShowSecondsInSystemClock -Value 0`,
      touches: [{ kind: "registry", key: seconds, value: "ShowSecondsInSystemClock" }],
    },
    read: "ShowSecondsInSystemClock : 0", values: [["0", "1"]], after: "ShowSecondsInSystemClock : 1",
  },
  {
    key: "firewall", ask: "Open a port for my Minecraft server", asks: /firewall|minecraft|game server|open a port/,
    says: "Friends can't join because Windows' firewall blocks the port Minecraft listens on. This adds one rule that lets that port in, and nothing else. Undo turns the rule off; it stays in the firewall's list.",
    title: "Let Minecraft's port through the firewall",
    cmd: {
      does: "Lets other devices reach your Minecraft server on port 25565. Undo only turns the rule off.",
      read: "Get-NetFirewallRule -DisplayName 'Minecraft server' | Select-Object DisplayName, Enabled, Direction, Action",
      run: "New-NetFirewallRule -Profile Private -Direction Inbound -Action Allow -Name 'Rig-minecraft' -DisplayName 'Minecraft server' -Protocol TCP -LocalPort 25565",
      undo: "Set-NetFirewallRule -Name 'Rig-minecraft' -Enabled False",
      touches: [{ kind: "firewall", name: "Minecraft server" }],
    },
    read: "No rule with that name.", values: [[null, "On, inbound, TCP 25565, allow"]],
    after: "DisplayName      Enabled Direction Action\n-----------      ------- --------- ------\nMinecraft server    True   Inbound  Allow",
    alsoChanged: ["A new value under HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules"],
    drifts: ["The firewall rule Minecraft server"],
  },
  {
    key: "uninstall", ask: "Uninstall NVIDIA Broadcast", asks: /uninstall|remove .*(app|broadcast)/,
    says: "You don't use NVIDIA Broadcast, and removing it frees about 1.2 GB. Windows can't put an uninstalled app back, so this one asks a little more of you.",
    title: "Uninstall NVIDIA Broadcast",
    cmd: {
      does: "Uninstalls NVIDIA Broadcast with winget.",
      read: "winget list --id 'Nvidia.Broadcast' --exact --source winget",
      run: "winget uninstall --exact --source winget --id 'Nvidia.Broadcast' --silent --accept-source-agreements",
      touches: [{ kind: "other", name: "NVIDIA Broadcast (the app and its settings)" }],
    },
    read: "Name             Id               Version\n-----------------------------------------\nNVIDIA Broadcast Nvidia.Broadcast 2.0.1.25", values: [["Installed, version 2.0.1.25", null]],
    after: "No installed package found matching input criteria.",
  },
  {
    key: "refused", ask: "Stop Defender scanning my games folder", asks: /defender|antivirus|exclusion/,
    says: "I looked at leaving your games folder out of Defender's scans. Rig won't make that change, so here's what happened and what you can do yourself.",
    title: "Leave the games folder out of Defender's scans",
    cmd: {
      does: "Tells Microsoft Defender to skip D:\\Games when it scans.",
      read: "Get-MpPreference | Select-Object ExclusionPath",
      run: "Add-MpPreference -ExclusionPath 'D:\\Games'",
      undo: "Remove-MpPreference -ExclusionPath 'D:\\Games'",
      touches: [{ kind: "other", name: "Defender's list of skipped folders" }],
    },
    read: "", values: [[null, null]], after: "",
    steps: ["Open Windows Security from the Start menu.", "Choose Virus & threat protection, then Manage settings.", "Scroll to Exclusions and choose Add or remove exclusions.", "Add D:\\Games. Anything harmful in that folder won't be caught, so keep only games there."],
  },
  {
    key: "rollback", ask: "Clean up my right-click menu", asks: /right.?click|context menu/,
    says: "Windows 11's short right-click menu can be switched back to the full one with a value in your own settings.",
    title: "Use the full right-click menu",
    cmd: {
      does: "Switches Windows 11 back to the full right-click menu.",
      read: "Get-ItemProperty -Path 'HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32'",
      run: "New-Item -Path 'HKCU:\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32' -Force",
      touches: [{ kind: "registry", key: "HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32" }],
    },
    read: "The key isn't there.", values: [[null, "(Default) is empty"]], after: "(default) :", rollsBack: true,
  },
  {
    key: "recipe", ask: "Show file extensions", asks: /file extension/,
    says: "File Explorer hides extensions like .txt and .exe by default. This is one of Rig's own recipes: one value in your own settings, and Rig saves the old value first.",
    title: "Show file extensions",
    recipe: extensions, cmd: recipeCommand(extensions) as Command,
    read: "1", values: [["1", "0"]], after: "0",
  },
  {
    key: "storageSense", ask: "Let Windows free up space by itself", asks: /storage sense|free up space by itself/,
    says: "Storage Sense is Windows' own cleaner: when the drive runs low it clears temporary files and Recycle Bin items older than 30 days. This is one of Rig's own recipes: one value in your own settings, and Rig saves the old value first.",
    title: "Turn on Storage Sense",
    recipe: storageSense, cmd: recipeCommand(storageSense) as Command,
    read: "0", values: [["0", "1"]], after: "1",
  },
];

const DEMO_LOOK = "5c0ffee05c0ffee05c0ffee05c0ffee0";
const palworld = "C:\\Users\\Sam\\AppData\\Local\\Pal\\Saved\\Config\\Windows\\GameUserSettings.ini";
const ue = "/Script/Engine.GameUserSettings";

export const demoNativeCards: DemoNativeCard[] = [
  {
    key: "gpu", ask: "Turn on low latency mode for Cyberpunk", asks: /low latency|input lag/,
    says: "NVIDIA's low latency mode keeps the CPU from lining up frames ahead of the graphics card, which cuts input lag in Cyberpunk 2077. It's one driver setting for that game, and Rig puts it back exactly on undo.",
    title: "Turn on low latency mode for Cyberpunk 2077",
    op: { name: "gpu", vendor: "nvidia", app: "cyberpunk2077.exe", setting: "lowLatency", value: "on", does: "Turns on low latency mode for Cyberpunk 2077 only." },
    read: "Low latency mode for cyberpunk2077.exe, in NVIDIA's own profile \"Cyberpunk 2077\": Off: the game decides (the driver's default)",
    values: [], after: "Low latency mode for cyberpunk2077.exe, in NVIDIA's own profile \"Cyberpunk 2077\": On: at most one frame waits (set for this game)",
  },
  {
    key: "fileEdit", ask: "Turn off vsync in Palworld's settings file", asks: /settings file|palworld/,
    says: "Palworld keeps vsync and its frame cap in its own settings file. This changes those two values and nothing else, and Rig saves a copy of the file first.",
    title: "Turn off vsync and cap the frame rate in Palworld",
    op: {
      name: "fileEdit", does: "Turns off vsync and caps Palworld at 141 frames a second, just under the screen's 144 Hz.", path: palworld, format: "ini",
      edits: [{ at: [ue, "bUseVSync"], value: "False" }, { at: [ue, "FrameRateLimit"], value: "141.000000" }],
    },
    read: [`${ue} › bUseVSync: True`, `${ue} › FrameRateLimit: 0.000000`, "File fingerprint 3f9a1c07b2e4, 2,184 bytes", "", "Line 14:", "- bUseVSync=True", "+ bUseVSync=False", "Line 22:", "- FrameRateLimit=0.000000", "+ FrameRateLimit=141.000000"].join("\n"),
    values: [["2,184 bytes", "2,190 bytes"]],
    after: [`${ue} › bUseVSync: False`, `${ue} › FrameRateLimit: 141.000000`, "File fingerprint 8c2177d0a51f, 2,190 bytes"].join("\n"),
  },
  {
    key: "screen", ask: "Blacks look grey on my TV", asks: /dynamic range|look(s)? (grey|gray|washed)|washed out/,
    says: "Over HDMI, NVIDIA often sends a limited range of colors, which makes blacks look grey. The switch is only in NVIDIA Control Panel, so Rig would set it there for you. I looked first: it's on Limited now.",
    title: "Use the full range of colors on the TV",
    op: { name: "screen", lookId: DEMO_LOOK, to: "Full", does: "Sets the output dynamic range to Full, so blacks look black." },
    look: { lookId: DEMO_LOOK, path: ["NVIDIA Control Panel", "Change resolution", "Output dynamic range"], value: "Limited", options: ["Limited", "Full"], clean: true, expiresAt: "2099-01-01T00:00:00.000Z" },
    read: "Output dynamic range: Limited", values: [], after: "Output dynamic range: Full",
  },
  {
    key: "firmware", ask: "Turn on virtualization so WSL 2 works", asks: /virtuali[sz]ation|wsl|vt-x/,
    says: "WSL 2 needs the processor's virtualization, and it's off in this PC's firmware. Rig can turn it on through Dell's own firmware tools; it applies the next time the PC restarts.",
    title: "Turn on virtualization",
    op: { name: "firmware", setting: "virtualization", value: "on", does: "Turns on virtualization in firmware so WSL 2 can run." },
    read: "Virtualization (Intel VT-x or AMD-V): Off\nDrive encryption on drive C: off\nMaker: Dell",
    values: [], after: "Virtualization (Intel VT-x or AMD-V): On\nDrive encryption on drive C: off\nMaker: Dell",
  },
  {
    key: "restartToFirmware", ask: "How do I turn on Secure Boot?", asks: /secure boot|firmware setup|bios/,
    says: "This PC's maker doesn't let Windows change Secure Boot, so it's done in firmware setup. Here are the steps from your board's manual.",
    title: "Restart into firmware setup",
    op: { name: "restartToFirmware" },
    read: "Windows can open firmware setup at the next restart.\nDrive encryption on drive C: off",
    values: [], after: "",
    steps: ["Save your work.", "Restart into firmware setup with the button below.", "Open the Boot tab, then Secure Boot.", "Set Secure Boot to Enabled.", "Press F10 to save and restart."],
  },
];

/** Changes the app offers from a page of its own, never from the chat: the battery charge limit on a Dell or HP laptop's Battery life tab. */
export const demoPageCards: DemoNativeCard[] = [
  {
    key: "chargeLimit", ask: "Stop charging at 80%", asks: /(?!)/,
    says: "",
    title: "Stop charging at 80%",
    op: { name: "firmware", setting: "chargeLimit", value: "on", does: FIRMWARE_SETTINGS.chargeLimit.does!.on },
    read: "Battery charge limit: Off\nDrive encryption on drive C: off\nMaker: HP",
    values: [], after: "Battery charge limit: On\nDrive encryption on drive C: off\nMaker: HP",
  },
];

const stepOf = (c: AnyDemoCard): HelperStep => ("cmd" in c ? { kind: "command", cmd: c.cmd } : { kind: "native", op: c.op });
const touchesOf = (c: AnyDemoCard): Touch[] => ("cmd" in c ? c.cmd.touches : (nativeOps[c.op.name] as NativeRule<NativeOp>).touches?.(c.op) ?? []);
const all = (): AnyDemoCard[] => [...demoCards, ...demoNativeCards, ...demoPageCards];

let reads = 0;
const expires = () => new Date(Date.now() + 10 * 60_000).toISOString();

const looksOf = (c: AnyDemoCard) => ("look" in c && c.look ? [c.look] : []);

/** What the helper would answer when it previews this card's command. */
export function demoPreview(c: AnyDemoCard, tainted = false): PreviewReply {
  const verdict = checkStep(stepOf(c), { tainted, looks: looksOf(c) });
  if (verdict.status === "refused") return { outcome: "refused", verdict };
  return { outcome: "ready", nonce: `demo-${c.key}-${++reads}`, expiresAt: expires(), verdict, read: c.read, touches: touchesOf(c).map((touch, i) => ({ touch, value: c.values[i][0] })) };
}

export function demoProposal(c: AnyDemoCard, id = `demo-${c.key}`): Proposal {
  const preview = demoPreview(c);
  const looks = looksOf(c);
  return { id, title: c.title, steps: ["recipe" in c && c.recipe ? c.recipe : stepOf(c)], tier: preview.outcome === "ready" ? preview.verdict.tier : 3, rows: [], status: "waiting", previews: [preview], ...(looks.length ? { looks } : {}) };
}

const result = (c: AnyDemoCard): RunResult => ({
  before: c.read, after: c.after, output: "", alsoChanged: c.alsoChanged ?? [],
  touches: touchesOf(c).map((touch, i) => ({ touch, before: c.values[i][0], after: c.values[i][1] })),
});

const kept = (c: AnyDemoCard) => ({
  id: `undo-${c.key}`, outside: c.alsoChanged ?? [], fingerprint: `demo-${c.key}`,
  restorePoint: { seq: 41, name: `Rig: before "${c.title}"`, at: new Date().toISOString() },
});
export const demoUndoRecord = (c: DemoCard): CommandUndo => ({ kind: "command", script: c.cmd.undo ?? undefined, ...kept(c) });
const undoRecord = (c: AnyDemoCard): HelperUndo => ("cmd" in c ? demoUndoRecord(c) : { kind: "native", ...kept(c) });

/** The step a demo card proposes. */
export const demoStep = stepOf;

/** What the helper would answer when the person applies this card. */
export function demoApply(c: AnyDemoCard): ApplyReply {
  const preview = demoPreview(c);
  if (preview.outcome === "refused") return { outcome: "refused", verdict: preview.verdict };
  if (c.rollsBack) {
    return {
      outcome: "rolledBack", result: result(c),
      sentinels: [{ sentinel: "run", before: "Discord, Steam, OneDrive", after: "Discord, Steam, OneDrive, ctxmenu.exe" }],
    };
  }
  return { outcome: "applied", result: result(c), undo: undoRecord(c) };
}

export function demoUndo(c: AnyDemoCard): UndoReply {
  return { outcome: "undone", printed: c.read, left: c.key === "firewall" ? ["The rule itself. The undo script turns it off, and it stays in the firewall's list."] : [] };
}

export const demoCardFor = (question: string) => all().find((c) => c.asks.test(question.toLowerCase()));
export const demoCardByNonce = (nonce: string) => all().find((c) => nonce.startsWith(`demo-${c.key}-`));
export const demoCardByUndo = (id: string) => all().find((c) => `undo-${c.key}` === id);
/** The demo card that proposes this step. */
export const demoCardByStep = (step: HelperStep) => all().find((c) => (step.kind === "command" ? "cmd" in c && c.cmd.run === step.cmd.run : "op" in c && JSON.stringify(c.op) === JSON.stringify(step.op)));
