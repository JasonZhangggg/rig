// The registry and service shorthands: what command each one builds, and that
// the command is checked like any other, so the never list, the protections and
// the tiers hold them the same way.

import { describe, expect, it } from "vitest";
import { checkStep, registryCommand, serviceCommand, type Command, type Verdict } from "../src";

const built = (c: Command | string): Command => {
  if (typeof c === "string") throw new Error(c);
  return c;
};
const verdict = (c: Command | string): Verdict => checkStep({ kind: "command", cmd: built(c) });
const reg = (key: string, name: string, type: string, value: unknown) => registryCommand({ key, name, type, value });

describe("registryCommand", () => {
  it("writes one typed value by its literal path, making the key only when it isn't there", () => {
    const c = built(reg("HKCU:\\Control Panel\\Desktop", "MenuShowDelay", "string", "100"));
    expect(c.run).toBe([
      "if (-not (Test-Path -LiteralPath 'HKCU:\\Control Panel\\Desktop')) { New-Item -Path 'HKCU:\\Control Panel\\Desktop' -Force | Out-Null }",
      "Set-ItemProperty -LiteralPath 'HKCU:\\Control Panel\\Desktop' -Name 'MenuShowDelay' -Type String -Value '100'",
    ].join("\n"));
    expect(c.read).toBe("Get-ItemPropertyValue -LiteralPath 'HKCU:\\Control Panel\\Desktop' -Name 'MenuShowDelay'");
    expect(c.touches).toEqual([{ kind: "registry", key: "HKCU\\Control Panel\\Desktop", value: "MenuShowDelay" }]);
    expect(c.undo).toBeUndefined();
    expect(c.does).toBe("Sets MenuShowDelay in HKCU\\Control Panel\\Desktop to \"100\".");
  });

  it("writes each type the way Windows PowerShell reads it back as the same bits", () => {
    expect(built(reg("HKLM\\SOFTWARE\\Rig", "a", "dword", 2147483647)).run).toContain("-Type DWord -Value 2147483647");
    expect(built(reg("HKLM\\SOFTWARE\\Rig", "a", "dword", 4294967295)).run).toContain("-Type DWord -Value 0xFFFFFFFF");
    expect(built(reg("HKLM\\SOFTWARE\\Rig", "a", "qword", 4294967295)).run).toContain("-Type QWord -Value 4294967295");
    expect(built(reg("HKLM\\SOFTWARE\\Rig", "a", "qword", "18446744073709551615")).run).toContain("-Type QWord -Value 0xFFFFFFFFFFFFFFFF");
    expect(built(reg("HKCU\\Software\\Rig", "a", "expandString", "%USERPROFILE%\\x")).run).toContain("-Type ExpandString -Value '%USERPROFILE%\\x'");
    expect(built(reg("HKCU\\Software\\Rig", "a", "multiString", ["one", "it's"])).run).toContain("-Type MultiString -Value @('one', 'it''s')");
    expect(built(reg("HKCU\\Software\\Rig", "", "string", "x")).run).toContain("-Name '(default)'");
  });

  it("keeps a quote inside a value from ending the text", () => {
    const c = built(reg("HKCU\\Software\\Rig", "it's", "string", "'; Remove-Item C:\\x; '"));
    expect(c.run).toContain("-Name 'it''s' -Type String -Value '''; Remove-Item C:\\x; '''");
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 2 });
    expect(verdict(c).commands.map((x) => x.name)).not.toContain("Remove-Item");
  });

  it("refuses letters outside plain ASCII, control characters and wildcards before building anything", () => {
    expect(reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVer\u017fion\\Run", "x", "string", "y")).toMatch(/plain letters/);
    expect(reg("HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\W\u0131nlogon", "Shell", "string", "y")).toMatch(/plain letters/);
    expect(reg("HKCU\\Software\\Rig", "\u212aey", "string", "y")).toMatch(/plain letters/);
    expect(reg("HKCU\\Software\\Rig", "x", "string", "a\u2019b")).toMatch(/plain letters/);
    expect(reg("HKCU\\Software\\Rig", "x", "string", "a\nb")).toMatch(/plain letters/);
    expect(reg("HKCU\\Software\\Rig", "x", "multiString", ["a", "b\u0000"])).toMatch(/plain letters/);
    expect(reg("HKCU\\Software\\Rig\\*", "x", "dword", 1)).toMatch(/no wildcards/);
    expect(reg("HKCU\\Software\\Rig", "x[1]", "dword", 1)).toMatch(/no wildcards/);
  });

  it("refuses values that don't fit their type, binary, and keys it can't name exactly", () => {
    expect(reg("HKCU\\Software\\Rig", "x", "binary", "00ff")).toMatch(/type must be/);
    expect(reg("HKCU\\Software\\Rig", "x", "dword", 4294967296)).toMatch(/0 to 4294967295/);
    expect(reg("HKCU\\Software\\Rig", "x", "dword", -1)).toMatch(/0 to 4294967295/);
    expect(reg("HKCU\\Software\\Rig", "x", "dword", "1")).toMatch(/whole number/);
    expect(reg("HKCU\\Software\\Rig", "x", "qword", "18446744073709551616")).toMatch(/18446744073709551615/);
    expect(reg("HKCU\\Software\\Rig", "x", "string", 5)).toMatch(/text/);
    expect(reg("HKCU\\Software\\Rig", "x", "multiString", ["a", ""])).toMatch(/no empty lines/);
    for (const key of ["HKCR\\.txt", "HKU\\S-1-5-18\\Software", "HKCU", "HKCU\\", "HKCU\\Software\\..\\x", "\\\\server\\HKLM\\x", "Software\\Rig"]) {
      expect(reg(key, "x", "dword", 1), key).toMatch(/key must be/);
    }
  });

  it("is tier 2, with admin for the whole PC's settings, and the snapshot is its undo", () => {
    expect(verdict(reg("HKCU\\Control Panel\\Desktop", "MenuShowDelay", "string", "100"))).toMatchObject({ status: "allowed", tier: 2, admin: false });
    expect(verdict(reg("HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR", "AllowGameDVR", "dword", 0))).toMatchObject({ status: "allowed", tier: 2, admin: true });
  });

  it("is held to the never list and the protections like any command", () => {
    expect(verdict(reg("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "Updater", "string", "C:\\x.exe"))).toMatchObject({ status: "refused", why: "never" });
    expect(verdict(reg("HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows", "Load", "string", "C:\\x.exe"))).toMatchObject({ status: "refused", why: "never" });
    expect(verdict(reg("HKLM\\SYSTEM\\Setup", "CmdLine", "string", "C:\\x.exe"))).toMatchObject({ status: "refused", why: "never" });
    expect(verdict(reg("HKLM\\SYSTEM\\CurrentControlSet\\Services\\Spooler", "ObjectName", "string", "LocalSystem"))).toMatchObject({ status: "refused", why: "never" });
    expect(verdict(reg("HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System", "EnableLUA", "dword", 0))).toMatchObject({ status: "allowed", tier: 3 });
    const services = verdict(reg("HKLM\\SYSTEM\\CurrentControlSet\\Services\\disk", "Start", "dword", 4));
    expect(services).toMatchObject({ status: "allowed", tier: 3 });
    expect(services.status === "allowed" && services.reasons.join(" ")).toContain("Set-Service is the safer way");
  });
});

describe("serviceCommand", () => {
  it("changes how a service starts with Set-Service, or sc.exe when it should wait after startup", () => {
    const off = built(serviceCommand({ name: "SysMain", startType: "disabled" }));
    expect(off).toEqual({
      does: "Makes the SysMain service never start (disabled). It doesn't start or stop it now.",
      read: "Get-Service -Name 'SysMain' | Select-Object -Property Name, DisplayName, Status, StartType",
      run: "Set-Service -Name 'SysMain' -StartupType Disabled",
      touches: [{ kind: "service", name: "SysMain" }],
    });
    expect(built(serviceCommand({ name: "WSearch", startType: "automaticDelayed" })).run).toBe("sc.exe config 'WSearch' start= delayed-auto");
    expect(built(serviceCommand({ name: "MSSQL$SQLEXPRESS", startType: "manual" })).run).toBe("Set-Service -Name 'MSSQL$SQLEXPRESS' -StartupType Manual");
    expect(verdict(serviceCommand({ name: "Spooler", startType: "automatic" }))).toMatchObject({ status: "allowed", tier: 2, admin: true });
  });

  it("refuses names it can't pass as plain text, and odd start types", () => {
    for (const name of ["Spool*", "..\\x", "Print Spooler", "a'b", "Sp\u0131ooler", ""]) expect(serviceCommand({ name, startType: "manual" }), name).toMatch(/service's name/);
    expect(serviceCommand({ name: "Spooler", startType: "boot" })).toMatch(/startType must be/);
  });

  it("makes Windows' protections and the drivers it needs to start tier 3, and refuses turning on Remote Registry", () => {
    for (const name of ["WinDefend", "MDCoreSvc", "webthreatdefsvc", "UsoSvc", "WaaSMedicSvc", "AppIDSvc", "RpcSs", "disk"]) {
      expect(verdict(serviceCommand({ name, startType: "disabled" })), name).toMatchObject({ status: "allowed", tier: 3 });
    }
    for (const startType of ["automatic", "automaticDelayed", "manual"]) {
      expect(verdict(serviceCommand({ name: "RemoteRegistry", startType })), startType).toMatchObject({ status: "refused", refused: expect.stringContaining("Remote Registry") });
    }
    expect(verdict(serviceCommand({ name: "RemoteRegistry", startType: "disabled" }))).toMatchObject({ status: "allowed", tier: 2 });
    expect(verdict(serviceCommand({ name: "TermService", startType: "automatic" }))).toMatchObject({ status: "refused", why: "never" });
  });
});
