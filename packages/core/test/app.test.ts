// The app shorthand: what the card says, the tier the one checker gives what it
// builds, and the plain words when the input can't be used. The rules row it
// relies on is held to the same grammar for a hand-written winget command.

import { describe, expect, it } from "vitest";
import { appCommand, checkScript, checkStep, type Command, type Verdict } from "../src";

const built = (c: Command | string): Command => {
  if (typeof c === "string") throw new Error(c);
  return c;
};
const verdict = (c: Command | string): Verdict => checkStep({ kind: "command", cmd: built(c) });
const firefox = (patch: Record<string, unknown> = {}) => appCommand({ id: "Mozilla.Firefox", action: "install", source: "winget", ...patch });
const LICENCE = "It also accepts the app's licence agreement for you.";

describe("appCommand", () => {
  it("installs an app at tier 2, says it accepts the licence, and undo uninstalls it", () => {
    const c = built(firefox());
    expect(c.does).toBe(`Installs Mozilla.Firefox from winget's community catalog, with winget. ${LICENCE} Undo uninstalls it.`);
    expect(c.run).toContain("winget install --exact --source winget --id 'Mozilla.Firefox' --silent --accept-source-agreements --accept-package-agreements");
    expect(c.undo).toContain("winget uninstall --exact --source winget --id 'Mozilla.Firefox' --silent --accept-source-agreements");
    const v = verdict(c);
    expect(v).toMatchObject({ status: "allowed", tier: 2, admin: false });
    expect(v.commands.map((x) => x.says)).toContain("winget: installs an app from winget's community catalog and accepts its licence agreement for you");
    expect(checkScript(c.read, "read")).toMatchObject({ status: "allowed", tier: 0 });
  });

  it("stops before installing an app that is already there, so undo can't remove one the person had", () => {
    const [look, stop] = built(firefox()).run.split("\n");
    expect(look).toBe("winget list --id 'Mozilla.Firefox' --exact --source winget --accept-source-agreements");
    expect(stop).toBe("if ($LASTEXITCODE -eq 0) { throw 'Mozilla.Firefox is already installed, so there is nothing to install.' }");
  });

  it("updates at tier 2 only when winget can install the version it replaces again", () => {
    const back = built(firefox({ action: "upgrade", from: "127.0.1", version: "128.0.3" }));
    expect(back.does).toBe(`Updates Mozilla.Firefox from winget's community catalog from version 127.0.1 to version 128.0.3, with winget. ${LICENCE} Undo uninstalls it and installs version 127.0.1 again.`);
    expect(back.run).toContain("if ($now -notmatch '(^|\\s)127\\.0\\.1(\\s|$)') { throw");
    expect(back.run).toContain("winget show --id 'Mozilla.Firefox' --exact --source winget --version '127.0.1'");
    expect(back.undo).toContain("winget install --exact --source winget --id 'Mozilla.Firefox' --version '127.0.1'");
    expect(verdict(back)).toMatchObject({ status: "allowed", tier: 2 });

    const newest = built(firefox({ action: "upgrade" }));
    expect(newest.does).toBe(`Updates Mozilla.Firefox from winget's community catalog to its newest version, with winget. ${LICENCE} Rig can't put the old version back, so this always gets Rig's strongest check.`);
    expect(newest.undo).toBeUndefined();
    expect(verdict(newest)).toMatchObject({ status: "allowed", tier: 3 });
  });

  it("uninstalls at tier 3 and says so", () => {
    const c = built(appCommand({ id: "9NBLGGH4NNS1", action: "uninstall", source: "msstore" }));
    expect(c.does).toBe("Uninstalls 9NBLGGH4NNS1 from the Microsoft Store with winget. Rig can't put it back as it was, so this always gets Rig's strongest check.");
    expect(c.does).not.toContain("licence");
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 3 });
  });

  it("refuses what it can't write safely, in plain words", () => {
    expect(firefox({ source: "github" })).toMatch(/^source must be winget/);
    expect(firefox({ id: "Mozilla.Firefox --override /S" })).toMatch(/^id must be the app's winget id/);
    expect(firefox({ id: "Firefox" })).toMatch(/^id must be the app's winget id/);
    expect(firefox({ id: "Mozilla.Fire*" })).toMatch(/^id must be/);
    expect(firefox({ source: "msstore" })).toMatch(/^id must be the app's Microsoft Store id/);
    expect(firefox({ action: "repair" })).toMatch(/^action must be/);
    expect(firefox({ version: "1.0' --override '/S" })).toMatch(/^version must be a version number/);
    expect(firefox({ action: "uninstall", version: "1.0" })).toBe("version is only for install and upgrade");
    expect(appCommand({ id: "9NBLGGH4NNS1", action: "install", source: "msstore", version: "1.0" })).toMatch(/newest version, so leave version out/);
    expect(firefox({ from: "1.0" })).toBe("from is only for upgrade");
  });
});

describe("winget written by hand", () => {
  const install = "winget install --exact --source winget --id Mozilla.Firefox --silent";

  it("takes only the form the shorthand writes", () => {
    expect(checkScript(`${install} --accept-source-agreements`, "run")).toMatchObject({ status: "allowed", tier: 2 });
    for (const extra of ["--override '/S'", "--custom '/S'", "--ignore-security-hash", "--location 'D:Apps'", "--force", "--header 'X: 1'", "--proxy 'http://p.example.com'", "-m 'D:app.yaml'"]) {
      expect(checkScript(`${install} ${extra}`, "run"), extra).toMatchObject({ status: "refused", why: "refused" });
    }
    expect(checkScript("winget install --exact --source contoso --id Mozilla.Firefox", "run").status).toBe("refused");
    expect(checkScript(`${install} --version '1" --override "/S'`, "run")).toMatchObject({ status: "refused", refused: expect.stringContaining("double quote or a backslash") });
  });

  it("is refused beside a command that needs admin rights, because winget runs only as the person", () => {
    const cmd: Command = { does: "Installs Firefox and sets a machine value.", read: "winget list --id Mozilla.Firefox --exact --source winget", run: `${install}; Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Rig' -Name A -Value 1`, undo: "winget uninstall --exact --source winget --id Mozilla.Firefox --silent", touches: [{ kind: "other", name: "Firefox" }] };
    expect(checkStep({ kind: "command", cmd })).toMatchObject({ status: "refused", refused: expect.stringContaining("runs only as you, never with admin rights") });
  });
});
