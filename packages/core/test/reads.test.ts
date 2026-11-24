// What the chat may read on the PC, and which reads count as outside text. The helper runs the same table (rules/reads.json).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkRead, readTaints, registryNever, type PcReadSpec } from "../src";

const read = (raw: Record<string, unknown>) => {
  const r = checkRead(raw);
  if (typeof r === "string") throw new Error(`refused: ${r}`);
  return r;
};
const refused = (raw: Record<string, unknown>) => {
  const r = checkRead(raw);
  if (typeof r !== "string") throw new Error(`allowed: ${JSON.stringify(r)}`);
  return r;
};
const taints = (raw: Record<string, unknown>) => readTaints(read(raw) as PcReadSpec);

describe("CIM reads", () => {
  it("reads only listed classes, in their own namespaces", () => {
    for (const cls of ["Win32_Product", "Win32_PingStatus", "Win32_Environment", "CIM_DataFile", "CIM_Directory", "Win32_UserAccount", "SoftwareLicensingService", "StdRegProv"]) {
      expect(refused({ kind: "cim", class: cls })).toContain(`Rig doesn't read ${cls}`);
    }
    expect(read({ kind: "cim", class: "Win32_Tpm", namespace: "root\\cimv2\\Security\\MicrosoftTpm" })).toMatchObject({ class: "Win32_Tpm" });
    expect(read({ kind: "cim", class: "MSFT_NetAdapter", namespace: "root\\StandardCimv2" })).toMatchObject({ class: "MSFT_NetAdapter" });
    expect(read({ kind: "cim", class: "WmiMonitorID", namespace: "ROOT\\WMI" })).toMatchObject({ class: "WmiMonitorID" });
    // A class in the wrong namespace isn't the listed one.
    expect(refused({ kind: "cim", class: "Win32_Tpm" })).toContain("doesn't read");
    expect(refused({ kind: "cim", class: "Win32_Process", namespace: "root\\StandardCimv2" })).toContain("doesn't read");
  });

  it("never reads command lines or anything that looks like a credential, asked for or filtered on", () => {
    expect(refused({ kind: "cim", class: "Win32_Process", properties: ["Name", "CommandLine"] })).toBe("Rig never reads Win32_Process.CommandLine.");
    expect(refused({ kind: "cim", class: "Win32_Process", filter: [{ property: "CommandLine", value: "x" }] })).toContain("CommandLine");
    expect(refused({ kind: "cim", class: "Win32_Service", properties: ["Name", "StartPassword"] })).toContain("StartPassword");
    expect(refused({ kind: "cim", class: "Win32_OperatingSystem", filter: [{ property: "ProductKeyId", value: "x" }] })).toContain("ProductKeyId");
    expect(read({ kind: "cim", class: "Win32_Process", properties: ["Name", "WorkingSetSize"] })).toMatchObject({ properties: ["Name", "WorkingSetSize"] });
  });

  it("counts only the listed hardware and Windows classes as clean, and free-text properties as outside text", () => {
    expect(taints({ kind: "cim", class: "Win32_VideoController", properties: ["Name", "DriverVersion"] })).toBe(false);
    expect(taints({ kind: "cim", class: "Win32_BIOS" })).toBe(false);
    expect(taints({ kind: "cim", class: "Win32_Tpm", namespace: "root\\cimv2\\Security\\MicrosoftTpm" })).toBe(false);
    // Services: start type and state are clean; a description or the whole class isn't.
    expect(taints({ kind: "cim", class: "Win32_Service", properties: ["Name", "StartMode", "State"] })).toBe(false);
    expect(taints({ kind: "cim", class: "Win32_Service", properties: ["Name", "Description"] })).toBe(true);
    expect(taints({ kind: "cim", class: "Win32_Service" })).toBe(true);
    // A Wi-Fi network's name is written by whoever runs it.
    expect(taints({ kind: "cim", class: "MSFT_NetConnectionProfile", namespace: "root\\StandardCimv2", properties: ["Name"] })).toBe(true);
    expect(taints({ kind: "cim", class: "Win32_NTLogEvent", properties: ["EventCode"] })).toBe(true);
    expect(taints({ kind: "cim", class: "MSFT_NetFirewallRule", namespace: "root\\StandardCimv2" })).toBe(true);
    expect(taints({ kind: "cim", class: "Win32_Process", properties: ["Name"] })).toBe(true);
  });
});

describe("registry reads", () => {
  it("refuses keys that hold saved passwords and sign-ins", () => {
    for (const key of [
      "HKLM\\SAM\\SAM\\Domains", "HKLM\\SECURITY\\Policy\\Secrets", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Lsa\\Secrets",
      "HKCU\\Software\\SimonTatham\\PuTTY\\Sessions\\work", "HKCU\\Software\\Martin Prikryl\\WinSCP 2\\Sessions", "HKLM\\SOFTWARE\\RealVNC\\vncserver",
      "HKLM\\SOFTWARE\\TightVNC\\Server", "HKLM\\SOFTWARE\\ORL\\WinVNC3\\Default", "HKLM\\SOFTWARE\\WOW6432Node\\uvnc bvba\\UltraVNC",
      "HKLM\\SYSTEM\\CurrentControlSet\\Services\\SNMP\\Parameters\\ValidCommunities", "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon",
      "HKCU\\Software\\Microsoft\\Terminal Server Client\\Servers", "HKCU\\Software\\Google\\Chrome\\PreferenceMACs", "HKCU\\Software\\Microsoft\\Edge",
      "HKCU\\Software\\Microsoft\\Internet Explorer\\IntelliForms\\Storage2", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Credentials",
      "HKCU\\Software\\Microsoft\\Vault",
    ]) {
      expect(registryNever(key) ?? checkRead({ kind: "registry", key }), key).toMatch(/^Rig never/);
      expect(typeof checkRead({ kind: "registry", key }), key).toBe("string");
    }
    // Policies for browsers are settings, and the person's environment is fine to read.
    expect(read({ kind: "registry", key: "HKLM\\SOFTWARE\\Policies\\Google\\Chrome" })).toMatchObject({ kind: "registry" });
    // The shared never list matches "\\Credentials" anywhere, so this policy key is refused too. Safe, if broad.
    expect(typeof checkRead({ kind: "registry", key: "HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\CredentialsDelegation" })).toBe("string");
    expect(read({ kind: "registry", key: "HKCU\\Environment" })).toMatchObject({ key: "HKCU\\Environment" });
  });

  it("refuses one value whose name says it's a secret", () => {
    expect(refused({ kind: "registry", key: "HKCU\\Software\\Acme\\Sync", value: "ApiToken" })).toContain("password, key or token");
    expect(refused({ kind: "registry", key: "HKCU\\Software\\Acme\\Sync", value: "ProxyPwd" })).toContain("password, key or token");
    expect(read({ kind: "registry", key: "HKCU\\Control Panel\\Keyboard", value: "KeyboardDelay" })).toMatchObject({ value: "KeyboardDelay" });
  });

  it("counts only Control, Policies, Game Bar and graphics keys and the like as clean", () => {
    expect(taints({ kind: "registry", key: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power" })).toBe(false);
    expect(taints({ kind: "registry", key: "HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer" })).toBe(false);
    expect(taints({ kind: "registry", key: "HKCU\\System\\GameConfigStore", value: "GameDVR_Enabled" })).toBe(false);
    expect(taints({ kind: "registry", key: "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences" })).toBe(false);
    expect(taints({ kind: "registry", key: "HKCU\\Control Panel\\Desktop" })).toBe(false);
    // A service's start type is clean; its description and path, in the whole key, aren't.
    expect(taints({ kind: "registry", key: "HKLM\\SYSTEM\\CurrentControlSet\\Services\\wuauserv", value: "Start" })).toBe(false);
    expect(taints({ kind: "registry", key: "HKLM\\SYSTEM\\CurrentControlSet\\Services\\wuauserv" })).toBe(true);
    // Whole parts only: a key that only starts with the same letters isn't under it.
    expect(taints({ kind: "registry", key: "HKCU\\Control Panel Extra\\X" })).toBe(true);
    expect(taints({ kind: "registry", key: "HKCU\\Environment" })).toBe(true);
    expect(taints({ kind: "registry", key: "HKCU\\Software\\Acme" })).toBe(true);
  });
});

describe("command and script reads", () => {
  it("always count as outside text", () => {
    expect(taints({ kind: "cmdlet", command: "Get-Service -Name wuauserv" })).toBe(true);
  });
});

describe("one table", () => {
  it("is the one the helper embeds", () => {
    const csproj = readFileSync(new URL("../../../helper/RigHelper/RigHelper.csproj", import.meta.url), "utf8");
    expect(csproj).toContain('packages\\core\\src\\rules\\reads.json" LogicalName="Rig.Rules.reads.json"');
  });
});
