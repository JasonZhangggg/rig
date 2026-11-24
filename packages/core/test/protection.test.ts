import { describe, expect, it } from "vitest";
import { KEEP_OFF_CHAT, PROTECTIONS, backOnWords, checkStep, nativeRows, stepHash, stepsTitle, type HelperStep } from "../src";

const step = (op: Record<string, unknown>) => ({ kind: "native", op } as unknown as HelperStep);

describe("turning a protection off for a while", () => {
  it("is always the red tier, needs admin rights, and comes back on after an hour unless the step says otherwise", async () => {
    const v = checkStep(step({ name: "protection", id: "firewallPublic", does: "dropped" }));
    expect(v).toMatchObject({ status: "allowed", tier: 3, admin: true, reasons: ["It turns off a protection. Rig turns it back on by itself after 1 hour."] });
    expect(checkStep(step({ name: "protection", id: "defenderRealtime", revertAfter: 15 }))).toMatchObject({ tier: 3, reasons: ["It turns off a protection. Rig turns it back on by itself after 15 minutes."] });
    // The same fingerprint as the helper's self-test (ProtectionSelfTest.cs).
    expect(await stepHash(step({ name: "protection", id: "firewallPublic", revertAfter: 60 }))).toBe("7bc76eee6f83b98ef81fd5ce1c0349dda30fa5aae2c9a13b266fddc3179612ee");
  });

  it("takes only a row of Rig's table and one of its three times", () => {
    expect(PROTECTIONS.map((p) => p.id)).toEqual(["firewallPrivate", "firewallPublic", "firewallDomain", "defenderRealtime", "smartScreenApps"]);
    expect(checkStep(step({ name: "protection", id: "uac" }))).toMatchObject({ status: "refused", refused: "This isn't a protection Rig turns off." });
    for (const revertAfter of [5, 0, 1e6, "60", null])
      expect(checkStep(step({ name: "protection", id: "firewallPublic", revertAfter })), String(revertAfter)).toMatchObject({ status: revertAfter === null ? "allowed" : "refused" });
    expect(checkStep(step({ name: "protection", id: "firewallPublic", revertAfter: 5 }))).toMatchObject({ refused: "Rig turns a protection off for 15 minutes, 1 hour or 4 hours, nothing else." });
  });

  it("names the protection and the time in the log, and reads the state from the helper's line", () => {
    const op = { name: "protection", id: "firewallPublic", revertAfter: 240 } as const;
    expect(stepsTitle([{ kind: "native", op }])).toBe("Turned off Windows Firewall on public networks for 4 hours");
    expect(nativeRows(op, "Windows Firewall on public networks: On", undefined)).toEqual([["Windows Firewall on public networks", "On", "Off for 4 hours"]]);
  });
});

describe("keeping a protection off", () => {
  it("is refused from a chat, and allowed only from Rig's own button", () => {
    const keep = step({ name: "keepOff", id: "firewallPublic" });
    expect(checkStep(keep)).toMatchObject({ status: "refused", refused: KEEP_OFF_CHAT });
    expect(checkStep(keep, { tainted: false })).toMatchObject({ status: "refused" });
    expect(checkStep(keep, { tainted: false, own: true })).toMatchObject({ status: "allowed", tier: 3, admin: true });
    expect(checkStep(step({ name: "keepOff", id: "uac" }), { tainted: false, own: true })).toMatchObject({ status: "refused" });
  });
});

describe("how a protection came back on", () => {
  const at = "2026-11-17T21:00:00.000Z", since = "2026-11-17T20:00:00.000Z";
  it("says who turned it back on, from the service's own log", () => {
    expect(backOnWords({ at, why: "due", was: "off" }, since)).toBe("Rig turned it back on when its time was up.");
    expect(backOnWords({ at, why: "start", was: "off" }, since)).toBe("Its time ran out while the PC was off, so Rig turned it back on when the PC started.");
    expect(backOnWords({ at, why: "due", was: "on" }, since)).toBe("It was already back on when its time was up, so Rig left it alone.");
    expect(backOnWords({ at, why: "undone" }, since)).toBe("You turned it back on in Rig.");
    expect(backOnWords({ at, why: "stop", was: "off" }, since)).toBe("Rig's background recorder was stopped, so it turned this back on first.");
  });
  it("says only that it's back on when the log's last line is older than the change", () => {
    expect(backOnWords({ at: "2026-11-17T19:00:00.000Z", why: "due", was: "off" }, since)).toBe("It's back on.");
    expect(backOnWords(undefined, since)).toBe("It's back on.");
  });
});
