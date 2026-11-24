// One of each approval card for the demo: a command the chat can propose, what
// the helper would say when it previews it, and what comes back when the
// person applies or undoes it. The verdicts come from the same check the app
// runs, so the cards show real parsed commands and tiers.

import { checkStep, type ApplyReply, type Command, type CommandUndo, type PreviewReply, type RunResult, type Touch, type UndoReply } from "../change";
import type { Proposal } from "../client";

export interface DemoCard {
  key: "registry" | "firewall" | "uninstall" | "refused" | "rollback";
  /** A question that brings this card up in the demo chat. */
  ask: string;
  asks: RegExp;
  /** What Rig says above the card. */
  says: string;
  title: string;
  cmd: Command;
  /** What `read` prints before the change. */
  read: string;
  /** Each touch's value before and after, in the order of `cmd.touches`. */
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
];

const step = (c: DemoCard) => ({ kind: "command" as const, cmd: c.cmd });
let reads = 0;
const expires = () => new Date(Date.now() + 10 * 60_000).toISOString();

/** What the helper would answer when it previews this card's command. */
export function demoPreview(c: DemoCard, tainted = false): PreviewReply {
  const verdict = checkStep(step(c), { tainted });
  if (verdict.status === "refused") return { outcome: "refused", verdict };
  return { outcome: "ready", nonce: `demo-${c.key}-${++reads}`, expiresAt: expires(), verdict, read: c.read, touches: c.cmd.touches.map((touch, i) => ({ touch, value: c.values[i][0] })) };
}

export function demoProposal(c: DemoCard, id = `demo-${c.key}`): Proposal {
  const preview = demoPreview(c);
  return { id, title: c.title, steps: [step(c)], tier: preview.outcome === "ready" ? preview.verdict.tier : 3, rows: [], status: "waiting", previews: [preview] };
}

const result = (c: DemoCard): RunResult => ({
  before: c.read, after: c.after, output: "", alsoChanged: c.alsoChanged ?? [],
  touches: c.cmd.touches.map((touch: Touch, i) => ({ touch, before: c.values[i][0], after: c.values[i][1] })),
});

export const demoUndoRecord = (c: DemoCard): CommandUndo => ({
  kind: "command", id: `undo-${c.key}`, script: c.cmd.undo ?? undefined, outside: c.alsoChanged ?? [], fingerprint: `demo-${c.key}`,
  restorePoint: { seq: 41, name: `Rig: before "${c.title}"`, at: new Date().toISOString() },
});

/** What the helper would answer when the person applies this card. */
export function demoApply(c: DemoCard): ApplyReply {
  const preview = demoPreview(c);
  if (preview.outcome === "refused") return { outcome: "refused", verdict: preview.verdict };
  if (c.rollsBack) {
    return {
      outcome: "rolledBack", result: result(c),
      sentinels: [{ sentinel: "run", before: "Discord, Steam, OneDrive", after: "Discord, Steam, OneDrive, ctxmenu.exe" }],
    };
  }
  return { outcome: "applied", result: result(c), undo: demoUndoRecord(c) };
}

export function demoUndo(c: DemoCard): UndoReply {
  return { outcome: "undone", printed: c.read, left: c.key === "firewall" ? ["The rule itself. The undo script turns it off, and it stays in the firewall's list."] : [] };
}

export const demoCardFor = (question: string) => demoCards.find((c) => c.asks.test(question.toLowerCase()));
export const demoCardByNonce = (nonce: string) => demoCards.find((c) => nonce.startsWith(`demo-${c.key}-`));
export const demoCardByUndo = (id: string) => demoCards.find((c) => `undo-${c.key}` === id);
