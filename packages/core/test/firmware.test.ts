import { describe, expect, it } from "vitest";
import { canonicalNative, checkRead, checkStep, FIRMWARE_MAKERS, FIRMWARE_SETTINGS, firmwareNever, firmwareSealed, nativeRows, readTaints, readWhat, stepsTitle, type Step } from "../src";

const step = (op: Record<string, unknown>): Step => ({ kind: "native", op: { name: "firmware", does: "Turns on virtualization so WSL 2 can run.", ...op } } as Step);
const verdict = (op: Record<string, unknown>, tainted = false) => checkStep(step(op), { tainted });

describe("the firmware table", () => {
  it("loads, and every value it won't set says why", () => {
    expect(Object.keys(FIRMWARE_SETTINGS).sort()).toEqual(["chargeLimit", "fanMode", "secureBoot", "tpm", "virtualization", "vtd", "wakeOnLan"]);
    for (const [key, s] of Object.entries(FIRMWARE_SETTINGS)) {
      for (const v of s.allow) expect(s.values, key).toHaveProperty(v);
      for (const v of Object.keys(s.values).filter((x) => !s.allow.includes(x))) expect(s.refuse?.[v], `${key} ${v}`).toBeTruthy();
      for (const [maker, row] of Object.entries(s.makers)) {
        expect(FIRMWARE_MAKERS).toContain(maker);
        for (const v of Object.keys(row.values)) expect(s.values, `${maker} ${key}`).toHaveProperty(v);
      }
    }
  });

  it("offers no row whose name or maker attribute is on its never list", () => {
    for (const [key, s] of Object.entries(FIRMWARE_SETTINGS)) {
      expect(firmwareNever(key), key).toBeNull();
      for (const row of Object.values(s.makers)) expect(firmwareNever(row!.attribute), row!.attribute).toBeNull();
    }
  });

  it("turns the security chip and Secure Boot only on, and they are sealed by drive encryption", () => {
    for (const key of ["tpm", "secureBoot"]) {
      expect(FIRMWARE_SETTINGS[key].allow).toEqual(["on"]);
      expect(FIRMWARE_SETTINGS[key].sealed).toBe(true);
      expect(FIRMWARE_SETTINGS[key].undo).toBe(false);
    }
  });
});

describe("a firmware step", () => {
  it("is always tier 3 and needs admin rights, so Windows asks first", () => {
    const v = verdict({ setting: "virtualization", value: "on" });
    expect(v).toMatchObject({ status: "allowed", tier: 3, admin: true });
    expect(v.status === "allowed" && v.reasons.join(" ")).toContain("applies at the next restart");
  });

  it("is refused after the chat read outside text, like any tier 3 step", () => {
    expect(verdict({ setting: "virtualization", value: "on" }, true)).toMatchObject({ status: "refused", why: "tainted" });
  });

  it("never turns the security chip or Secure Boot off", () => {
    expect(verdict({ setting: "tpm", value: "off" })).toMatchObject({ status: "refused", why: "never", refused: expect.stringContaining("never turns the security chip (TPM) off") });
    expect(verdict({ setting: "secureBoot", value: "off" })).toMatchObject({ status: "refused", why: "never", refused: expect.stringContaining("never turns Secure Boot off") });
    expect(verdict({ setting: "tpm", value: "on" })).toMatchObject({ status: "allowed", tier: 3 });
  });

  it("names a never-list setting as never, whatever it is called", () => {
    for (const setting of ["bootOrder", "Boot Sequence", "SATA Operation", "tpmClear", "SecureBootMode", "XMP Profile", "Admin Password", "Computrace", "CSM Support"]) {
      expect(verdict({ setting, value: "on" }), setting).toMatchObject({ status: "refused", why: "never" });
    }
  });

  it("refuses a setting or value that isn't on Rig's list, and says what is", () => {
    expect(verdict({ setting: "numLock", value: "on" })).toMatchObject({ status: "refused", why: "refused", refused: expect.stringContaining("It changes: virtualization, vtd") });
    expect(verdict({ setting: "fanMode", value: "turbo" })).toMatchObject({ status: "refused", refused: "Fan and cooling mode takes one of: quiet, balanced, cool, performance." });
    expect(verdict({ setting: "virtualization", value: "on", does: "" })).toMatchObject({ status: "refused", refused: "does must be one plain sentence." });
  });

  it("is titled and shown with the setting's own words", () => {
    const s = step({ setting: "virtualization", value: "on" });
    expect(stepsTitle([s])).toBe("Set Virtualization (Intel VT-x or AMD-V) to On");
    const op = (s as Extract<Step, { kind: "native" }>).op;
    const before = "Virtualization (Intel VT-x or AMD-V): Off\nDrive encryption on drive C: off";
    expect(nativeRows(op, before)).toEqual([["Virtualization (Intel VT-x or AMD-V)", "Off", "On"]]);
    expect(nativeRows(op, before, before.replace("Off", "On"))).toEqual([["Virtualization (Intel VT-x or AMD-V)", "Off", "On"]]);
    expect(firmwareSealed(before)).toBe(false);
    expect(firmwareSealed("Wake on LAN: Off\nDrive encryption on drive C: on")).toBe(true);
    expect(firmwareSealed("Wake on LAN: Off\nDrive encryption on drive D: not known")).toBe(true);
  });

  it("keeps only its own fields, so the model can't name a maker's attribute", () => {
    const op = { name: "firmware", setting: "vtd", value: "off", does: "Turns off VT-d." };
    expect(canonicalNative({ ...op, maker: "dell", attribute: "SecureBoot", to: "Disabled" })).toEqual(op);
  });
});

describe("the restart into firmware setup", () => {
  const restart = (op: Record<string, unknown> = {}): Step => ({ kind: "native", op: { name: "restartToFirmware", ...op } } as Step);

  it("takes nothing but its name, is tier 3 and needs admin rights", () => {
    expect(checkStep(restart({ seconds: 0, args: "/s" }))).toMatchObject({ status: "allowed", tier: 3, admin: true, reasons: [expect.stringContaining("Save your work first")] });
    expect(stepsTitle([restart()])).toBe("Restarted into firmware setup");
  });
});

describe("read_pc firmware", () => {
  it("takes no fields and counts as Rig's own words, not outside text", () => {
    expect(checkRead({ kind: "firmware", namespace: "root\\HP\\InstrumentedBIOS" })).toEqual({ kind: "firmware" });
    expect(readTaints({ kind: "firmware" })).toBe(false);
    expect(readWhat({ kind: "firmware" })).toBe("firmware settings");
  });

  it("doesn't read a maker's management classes directly", () => {
    expect(typeof checkRead({ kind: "cim", namespace: "root\\HP\\InstrumentedBIOS", class: "HP_BIOSEnumeration" })).toBe("string");
    expect(typeof checkRead({ kind: "cim", namespace: "root\\dcim\\sysman\\biosattributes", class: "EnumerationAttribute" })).toBe("string");
  });
});
