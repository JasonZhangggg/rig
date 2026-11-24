// The firewall, policy, device and driver shorthands: what the card says, the
// tier the one checker gives what they build, and the plain words when the
// input can't be used. The shared vectors hold one of each as the helper sees it.

import { describe, expect, it } from "vitest";
import { checkStep, deviceCommand, driverCommand, firewallCommand, policyCommand, type Command, type Verdict } from "../src";
import vectors from "../src/rules/vectors.json";

const built = (c: Command | string): Command => {
  if (typeof c === "string") throw new Error(c);
  return c;
};
const verdict = (c: Command | string): Verdict => checkStep({ kind: "command", cmd: built(c) });
const rule = (patch: Record<string, unknown> = {}) => firewallCommand({ add: { name: "Minecraft server", direction: "inbound", action: "allow", protocol: "tcp", ports: [25565], ...patch } });

describe("firewallCommand", () => {
  it("adds a rule named for Rig that lets one port in from private networks, and undo deletes just that rule", () => {
    const c = built(rule());
    expect(c.does).toBe("Adds a firewall rule, Minecraft server (Rig), that lets other computers on private networks (like your home's) connect to TCP port 25565. Undo deletes the rule.");
    const name = c.touches[0].kind === "firewall" ? c.touches[0].name : "";
    expect(name).toMatch(/^Rig-[0-9a-f]{8}$/);
    expect(c.run).toContain(`New-NetFirewallRule -Profile Private -Direction Inbound -Action Allow -Name '${name}' -DisplayName 'Minecraft server (Rig)' -Protocol TCP -LocalPort 25565`);
    expect(c.undo).toBe(`Remove-NetFirewallRule -Name '${name}'`);
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 2, admin: true });
    expect(built(rule()).touches).toEqual(c.touches);
  });

  it("stops before changing anything when Rig already added the same rule", () => {
    const c = built(rule());
    expect(c.run.split("\n")[0]).toMatch(/^if \(Get-NetFirewallRule -Name 'Rig-[0-9a-f]{8}' -ErrorAction SilentlyContinue\) \{ throw 'Rig already added this rule, so there is nothing to change.' \}$/);
  });

  it("says a rule for public networks always gets the strongest check, and the checker agrees", () => {
    const c = built(rule({ profile: "public", protocol: "udp", ports: [27015, 27016] }));
    expect(c.does).toContain("UDP ports 27015, 27016");
    expect(c.does).toContain("so this always gets Rig's strongest check");
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 3 });
  });

  it("lets one program in, and blocks or lets out without the inbound limits", () => {
    expect(verdict(rule({ protocol: undefined, ports: undefined, program: "C:\\Games\\Server\\server.exe" }))).toMatchObject({ status: "allowed", tier: 2 });
    const block = built(rule({ name: "No file sharing", action: "block", ports: [445], profile: "public" }));
    expect(block.does).toBe("Adds a firewall rule, No file sharing (Rig), that stops other computers on public networks (like a café's Wi-Fi) connecting to TCP port 445. Undo deletes the rule.");
    expect(verdict(block)).toMatchObject({ status: "allowed", tier: 2 });
    const out = built(firewallCommand({ add: { name: "Quiet app", direction: "outbound", action: "block", program: "C:\\Program Files\\App\\app.exe" } }));
    expect(out.does).toContain("stops C:\\Program Files\\App\\app.exe connecting out on private networks");
    expect(out.run).toContain("-Direction Outbound -Action Block");
    expect(verdict(out)).toMatchObject({ status: "allowed", tier: 2 });
  });

  it("refuses what would open the PC, in plain words", () => {
    expect(rule({ ports: [3389] })).toBe("Rig never opens the ports Windows uses for remote access or file sharing (22, 135, 139, 445, 3389, 5985, 5986)");
    expect(rule({ ports: undefined, protocol: undefined })).toMatch(/needs a program or ports/);
    expect(rule({ ports: [25565], protocol: undefined })).toMatch(/needs a protocol/);
    expect(rule({ ports: [0] })).toMatch(/1 to 65535/);
    expect(rule({ ports: "27000-27100" })).toMatch(/doesn't take ranges/);
    expect(rule({ profile: "any" })).toMatch(/profile must be/);
    expect(rule({ direction: "both" })).toMatch(/direction must be/);
    expect(rule({ program: "C:\\Games\\*.exe" })).toMatch(/program must be/);
    expect(rule({ program: "..\\server.exe" })).toMatch(/program must be/);
    for (const program of ["C:\\Windows\\System32\\svchost.exe", "C:\\WINDOWS\\system32\\spoolsv.exe", "D:\\Tools\\svchost.exe"]) {
      expect(rule({ ports: undefined, protocol: undefined, program }), program).toMatch(/^Rig won't let connections in to a program in the Windows folder/);
    }
    for (const name of ["Game-2", "Any", "0day", "Gam\u0435", "a*b", ""]) expect(rule({ name }), name).toMatch(/name must be/);
    expect(firewallCommand({ add: {}, rule: "x", enabled: true })).toMatch(/either add/);
  });

  it("turns an existing rule on or off only when it isn't already, and undo turns it back", () => {
    const on = built(firewallCommand({ rule: "CoreNet-ICMP6-DU-In", enabled: true }));
    expect(on).toMatchObject({ does: "Turns on the firewall rule CoreNet-ICMP6-DU-In. Undo turns it off again.", undo: "Disable-NetFirewallRule -Name 'CoreNet-ICMP6-DU-In'" });
    expect(on.run).toContain("Where-Object -Property Enabled -EQ -Value 'True') { throw 'This firewall rule is already on.' }");
    expect(verdict(on)).toMatchObject({ status: "allowed", tier: 2 });
    expect(verdict(firewallCommand({ rule: "MDNS-In-UDP", enabled: false }))).toMatchObject({ status: "allowed", tier: 2 });
    expect(firewallCommand({ rule: "CoreNet-*", enabled: true })).toMatch(/no wildcards/);
  });

  it("never turns on Remote Desktop, file sharing or remote management", () => {
    for (const name of ["RemoteDesktop-UserMode-In-TCP", "FPS-SMB-In-TCP", "WINRM-HTTP-In-TCP", "WMI-WINMGMT-In-TCP", "OpenSSH-Server-In-TCP", "RemoteAssistance-In-TCP-EdgeScope"]) {
      expect(verdict(firewallCommand({ rule: name, enabled: true })), name).toMatchObject({ status: "refused", why: "never" });
    }
  });
});

describe("policyCommand", () => {
  const gameDvr = { scope: "machine", key: "Microsoft\\Windows\\GameDVR", name: "AllowGameDVR", type: "dword", value: 0 };

  it("sets one value under Software\\Policies, stopping first on a PC a work or school manages", () => {
    const c = built(policyCommand(gameDvr));
    expect(c.does).toBe("Sets the policy AllowGameDVR in HKLM\\Software\\Policies\\Microsoft\\Windows\\GameDVR to 0. It applies to everyone who uses this PC, and some policies only take effect after a restart.");
    const lines = c.run.split("\n");
    expect(lines[0]).toContain("Win32_ComputerSystem -Filter 'PartOfDomain = TRUE') { throw 'This PC is managed by a work or school");
    expect(lines[1]).toContain("HKLM:\\SOFTWARE\\Microsoft\\Enrollments");
    expect(lines.at(-1)).toBe("Set-ItemProperty -LiteralPath 'HKLM:\\Software\\Policies\\Microsoft\\Windows\\GameDVR' -Name 'AllowGameDVR' -Type DWord -Value 0");
    expect(c.run).not.toMatch(/gpupdate/i);
    expect(c.touches).toEqual([{ kind: "registry", key: "HKLM\\Software\\Policies\\Microsoft\\Windows\\GameDVR", value: "AllowGameDVR" }]);
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 2, admin: true });
  });

  it("needs admin rights for this account's policies too, since Windows keeps them admin-only", () => {
    const c = built(policyCommand({ ...gameDvr, scope: "user", key: "Software\\Policies\\Microsoft\\Windows\\Explorer", name: "DisableSearchBoxSuggestions", value: 1 }));
    expect(c.does).toContain("HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer");
    expect(c.does).toContain("It applies to your Windows account");
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 2, admin: true });
  });

  it("refuses keys outside Software\\Policies and odd scopes, in plain words", () => {
    expect(policyCommand({ ...gameDvr, key: "HKLM\\SOFTWARE\\Microsoft\\Windows" })).toMatch(/part under Software\\Policies/);
    expect(policyCommand({ ...gameDvr, key: "Software\\Policies" })).toMatch(/name a key under/);
    expect(policyCommand({ ...gameDvr, key: "Microsoft\\..\\..\\Run" })).toMatch(/key must be/);
    expect(policyCommand({ ...gameDvr, scope: "everyone" })).toMatch(/scope must be/);
    expect(policyCommand({ ...gameDvr, value: -1 })).toMatch(/0 to 4294967295/);
  });

  it("is held to the never list and the protections like any registry value", () => {
    expect(verdict(policyCommand({ ...gameDvr, key: "Microsoft\\Windows NT\\Terminal Services", name: "fDenyTSConnections" }))).toMatchObject({ status: "refused", why: "never" });
    expect(verdict(policyCommand({ ...gameDvr, key: "Microsoft\\Windows\\System\\Scripts\\Startup", name: "x", type: "string", value: "C:\\x.cmd" }))).toMatchObject({ status: "refused", why: "never" });
    expect(verdict(policyCommand({ ...gameDvr, key: "Microsoft\\Windows Defender", name: "DisableAntiSpyware", value: 1 }))).toMatchObject({ status: "allowed", tier: 3 });
    expect(verdict(policyCommand({ ...gameDvr, key: "Microsoft\\WindowsFirewall\\StandardProfile", name: "EnableFirewall", value: 0 }))).toMatchObject({ status: "allowed", tier: 3 });
  });
});

describe("deviceCommand", () => {
  const mouse = "USB\\VID_046D&PID_C52B\\5&1A2B3C&0&2";

  it("turns a device off only when it's on and isn't one Windows needs, at tier 3, and undo turns it on", () => {
    const c = built(deviceCommand({ instanceId: mouse, enabled: false }));
    expect(c.does).toBe(`Turns off the device ${mouse} until it's turned back on. Undo turns it on again. Rig can't tell from the command alone whether Windows needs a device, so this always gets Rig's strongest check.`);
    expect(c.read).toBe(`Get-PnpDevice -InstanceId '${mouse}' | Format-List -Property FriendlyName, Class, Status, Problem, InstanceId`);
    expect(c.run).toContain("if ($d.ConfigManagerErrorCode -eq 22) { throw 'This device is already turned off.' }");
    expect(c.run).toContain("if ($d.Class -in @('System', 'DiskDrive', 'SCSIAdapter', 'HDC', 'Volume', 'Processor', 'Computer')) { throw");
    expect(c.run).toContain("if ($d.Class -in @('Display', 'Keyboard', 'Mouse') -and -not (Get-PnpDevice -Class $d.Class -PresentOnly -Status OK");
    expect(c.run.split("\n").at(-1)).toBe(`Disable-PnpDevice -InstanceId '${mouse}' -Confirm:$false`);
    expect(c.undo).toBe(`Enable-PnpDevice -InstanceId '${mouse}' -Confirm:$false`);
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 3, admin: true });
  });

  it("turns a device on only when it's off, and undo turns it off, so it is tier 3 too", () => {
    const c = built(deviceCommand({ instanceId: "PCI\\VEN_8086&DEV_2723&SUBSYS_00848086&REV_1A\\4&2C2A1E8D&0&00E3", enabled: true }));
    expect(c.run).toContain("if ($d.ConfigManagerErrorCode -ne 22) { throw 'This device isn''t turned off, so there is nothing to turn on.' }");
    expect(c.undo).toMatch(/^Disable-PnpDevice -InstanceId 'PCI\\/);
    expect(c.does).toContain("turning a device off always gets Rig's strongest check, so this does too");
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 3 });
  });

  it("refuses ids it can't pass as plain text, and parts Windows always needs", () => {
    for (const instanceId of ["USB\\*", "USB\\VID_1\u2019", "Mouse", "\\\\pc\\USB\\x", " USB\\x", ""]) expect(deviceCommand({ instanceId, enabled: false }), instanceId).toMatch(/instanceId must be/);
    expect(deviceCommand({ instanceId: mouse, enabled: "no" })).toMatch(/enabled must be/);
    for (const instanceId of ["ACPI\\PNP0303\\4&1", "ACPI_HAL\\PNP0C08\\0", "ROOT\\volmgr\\0000", "STORAGE\\VOLUME\\{0}#0000", "SCSI\\Disk&Ven_NVMe\\5&1"]) {
      expect(verdict(deviceCommand({ instanceId, enabled: false })), instanceId).toMatchObject({ status: "refused", refused: expect.stringContaining("a part Windows needs to run") });
    }
  });
});

describe("driverCommand", () => {
  const realtek = { inf: "C:\\Drivers\\Realtek\\rt640x64.inf", catalog: "C:\\Drivers\\Realtek\\rt640x64.cat" };

  it("installs a signed driver from this PC, says it is always tier 3, and the checker agrees", () => {
    const c = built(driverCommand(realtek));
    expect(c.does).toBe("Installs the driver C:\\Drivers\\Realtek\\rt640x64.inf with Windows' pnputil, after checking its catalog is validly signed. A driver runs inside Windows and Rig can't promise to take it back, so this always gets Rig's strongest check.");
    expect(c.run).toContain("pnputil /add-driver 'C:\\Drivers\\Realtek\\rt640x64.inf' /install");
    expect(c.run.split("\n")[0]).toContain("Where-Object -Property Status -NE -Value 'Valid') { throw");
    expect(c.undo).toBeUndefined();
    expect(c.touches.slice(0, 2)).toEqual([{ kind: "file", path: realtek.inf }, { kind: "file", path: realtek.catalog }]);
    expect(verdict(c)).toMatchObject({ status: "allowed", tier: 3, admin: true });
  });

  it("shows who signed it and both files' fingerprints, in a read that only looks", () => {
    const c = built(driverCommand(realtek));
    expect(c.read).toContain("Get-FileHash -LiteralPath 'C:\\Drivers\\Realtek\\rt640x64.inf' -Algorithm SHA256");
    expect(c.read).toContain("Get-FileHash -LiteralPath 'C:\\Drivers\\Realtek\\rt640x64.cat' -Algorithm SHA256");
    expect(c.read).toContain("Select-Object -ExpandProperty SignerCertificate | Format-List -Property Subject, Issuer, NotAfter, Thumbprint");
    const v = verdict(c);
    expect(v.commands.filter((x) => x.script === "read").every((x) => x.tier === 0)).toBe(true);
  });

  it("takes only one named .inf and its catalog beside it, already on this PC", () => {
    expect(driverCommand({ ...realtek, inf: "C:\\Drivers\\Realtek\\*.inf" })).toMatch(/inf must be/);
    expect(driverCommand({ ...realtek, inf: "https://example.com/x.inf" })).toMatch(/inf must be/);
    expect(driverCommand({ ...realtek, inf: "\\\\server\\share\\x.inf" })).toMatch(/inf must be/);
    expect(driverCommand({ ...realtek, inf: "C:\\Drivers\\RTL~1\\x.inf" })).toMatch(/inf must be/);
    expect(driverCommand({ ...realtek, inf: "C:\\Drivers\\Realtek\\rt640x64.exe" })).toMatch(/inf must be/);
    expect(driverCommand({ ...realtek, catalog: undefined })).toMatch(/catalog must be/);
    expect(driverCommand({ ...realtek, catalog: "C:\\Other\\rt640x64.cat" })).toMatch(/same folder/);
  });
});

describe("the shorthand vectors", () => {
  const builders: Record<string, (raw: unknown) => Command | string> = { firewall: firewallCommand, policy: policyCommand, device: deviceCommand, driver: driverCommand };
  const ones = (vectors as { shorthand?: Record<string, unknown>; step?: { cmd: Command } }[]).filter((v) => v.shorthand);

  it("are what each shorthand writes now, so the helper's selftest checks the real scripts", () => {
    expect(new Set(ones.flatMap((v) => Object.keys(v.shorthand!)))).toEqual(new Set(Object.keys(builders)));
    for (const v of ones) {
      const [name, input] = Object.entries(v.shorthand!)[0];
      expect(builders[name](input), name).toEqual(v.step!.cmd);
    }
  });
});
