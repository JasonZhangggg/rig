import { describe, expect, it } from "vitest";
import { buildPC, findings, fixSteps, startupGuide, suggestedOff, titleFor, type SystemFacts } from "../src";
import { DemoClient, fixtures, simulate } from "../src/demo";

const atlas = () => structuredClone(fixtures.atlas.inv);
const facts = (): SystemFacts => structuredClone(fixtures.atlas.facts);
const at3am = Date.UTC(2026, 10, 17, 3, 0);
const app = (name: string, enabled = true) => ({ name, command: `${name}.exe`, enabled, scope: "user" as const });

describe("startup guide", () => {
  it("suggests turning off launchers and chat apps that open fine by hand", () => {
    for (const name of ["Steam", "Discord", "Spotify", "Epic Games Launcher", "EA app", "Ubisoft Connect", "Battle.net", "Skype", "Zoom", "Wallpaper Engine", "Cortana", "Microsoft Edge", "Opera GX Browser", "Adobe Creative Cloud", "AdobeGCInvoker-1.0", "NVIDIA Broadcast", "GeForce Experience", "NVIDIA App", "AMD Software: Adrenalin Edition"]) {
      expect(startupGuide(name)?.suggest, name).toBe("off");
    }
  });

  it("says to keep drivers, sync, security and devices that need it", () => {
    for (const name of ["OneDrive", "Dropbox", "Google Drive", "iCloud", "Logitech G HUB", "Razer Synapse 3", "Corsair iCUE 5 Software", "Realtek HD Audio Universal Service", "RtkAudUService", "SynTPEnh", "ETDCtrl ELAN", "MyASUS", "Armoury Crate", "Lenovo Vantage", "Dell SupportAssist", "HP Wolf Security", "SecurityHealth", "Windows Security notification icon", "Bitdefender Agent", "Malwarebytes Tray", "1Password", "Bitwarden"]) {
      expect(startupGuide(name)?.suggest, name).toBe("keep");
    }
  });

  it("says what a known app is in one short line", () => {
    expect(startupGuide("Steam")).toEqual({ what: "Game store and launcher", suggest: "off" });
    expect(startupGuide("Logitech G HUB")?.what).toBe("Mouse and keyboard buttons and lighting");
    expect(startupGuide("Microsoft Teams")).toEqual({ what: "Chat and meetings for work or school" });
  });

  it("says nothing about an app it doesn't know, rather than guess", () => {
    for (const name of ["Rainmeter", "MyCompanyAgent", "Reset Helper", "Placer", "Wedding planner"]) expect(startupGuide(name), name).toBeNull();
  });

  it("only counts apps that start now", () => {
    expect(suggestedOff([app("Steam"), app("Discord", false), app("OneDrive"), app("Rainmeter")]).map((a) => a.name)).toEqual(["Steam"]);
  });
});

describe("startup apps on the PC view", () => {
  it("carries every startup app without its command", () => {
    const pc = buildPC(atlas(), simulate(atlas(), at3am), facts());
    expect(pc.settings!.startup).toHaveLength(9);
    expect(pc.settings!.startup![0]).toEqual({ name: "Steam", enabled: true, scope: "user" });
    expect(pc.settings!.startup!.find((a) => a.name === "NVIDIA Broadcast")).toEqual({ name: "NVIDIA Broadcast", enabled: false, scope: "machine" });
    expect(JSON.stringify(pc.settings)).not.toContain(".exe");
  });

  it("opens the startup list from the finding, and says how many Rig suggests", () => {
    const f = findings({ inv: atlas(), snap: simulate(atlas(), at3am), facts: facts() }).find((i) => i.id === "startup")!;
    expect(f).toMatchObject({ title: "8 apps start with Windows", action: "Review startup apps", open: "startup" });
    expect(f.body).toMatch(/Rig suggests turning off 5 of them\./);
  });

  it("shows the finding below eight apps when three or more can go", () => {
    const f = facts();
    f.startupApps = [app("Steam"), app("Discord"), app("Spotify"), app("OneDrive")];
    expect(findings({ inv: atlas(), snap: simulate(atlas(), at3am), facts: f }).some((i) => i.id === "startup")).toBe(true);
    f.startupApps = [app("Steam"), app("Discord"), app("OneDrive"), app("Rainmeter"), app("Teams")];
    expect(findings({ inv: atlas(), snap: simulate(atlas(), at3am), facts: f }).some((i) => i.id === "startup")).toBe(false);
  });

  it("titles a batch of startup changes by what they do", () => {
    expect(titleFor([{ kind: "startup.app", name: "Steam", enabled: false }, { kind: "startup.app", name: "Discord", enabled: false }])).toBe("Turned off 2 startup apps");
    expect(titleFor([{ kind: "startup.app", name: "Steam", enabled: true }, { kind: "startup.app", name: "Discord", enabled: true }])).toBe("Turned on 2 startup apps");
    expect(titleFor([{ kind: "startup.app", name: "Steam", enabled: false }, { kind: "startup.app", name: "NVIDIA Broadcast", enabled: true }])).toBe("Changed 2 startup apps");
  });

  it("turns a batch off in the demo, shows it on the view and undoes it", async () => {
    const c = new DemoClient();
    const names = ["Steam", "Discord", "Spotify"];
    const ch = await c.apply("demo-atlas", fixSteps(names.map((name) => ({ kind: "startup.app", name, enabled: false }))), { by: "you" });
    expect(ch.title).toBe("Turned off 3 startup apps");
    expect(ch.diff).toEqual(names.map((n) => [n, "Starts with Windows", "Off"]));
    let pc = (await c.machines())[0];
    expect(pc.settings!.startup!.filter((a) => names.includes(a.name)).every((a) => !a.enabled)).toBe(true);
    expect(pc.settings!.startupOn).toBe(5);
    await c.undo("demo-atlas", ch.id);
    pc = (await c.machines())[0];
    expect(pc.settings!.startup!.filter((a) => names.includes(a.name)).every((a) => a.enabled)).toBe(true);
  });
});
