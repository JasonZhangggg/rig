// A protection turned off for a while: its card, and its change in Changes with the time left, "Turn it back on now"
// and the second choice that keeps it off.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkStep, KEEP_OFF_CHAT, type Allowed, type ApplyMeta, type ApplyReply, type Change, type HelperStep, type NativeOp, type PreviewReply, type Proposal, type UndoReply } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { ChangeCards } from "../src/components/change";
import { timeLeft } from "../src/pages/Changes";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const name = "Windows Firewall on public networks";
const card = (op: NativeOp): Proposal => ({ id: "p", title: "A change", steps: [{ kind: "native", op }], tier: 3, rows: [], status: "waiting", previews: [] });
const show = (op: NativeOp) => render(<ChangeCards proposal={card(op)} previews={[]} pcName="Atlas" canApply onReviewFixes={vi.fn()} onDecline={vi.fn()} onCommandStep={vi.fn()} onSteps={vi.fn()} />);

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(cleanup);

describe("the card that turns a protection off", () => {
  it("is red, names the protection and says when Rig turns it back on", () => {
    show({ name: "protection", id: "firewallPublic", revertAfter: 60 });
    expect(screen.getByRole("heading", { name: `Turns off ${name} for 1 hour` })).toBeTruthy();
    const lead = screen.getByRole("note").textContent!;
    expect(lead).toContain("This lowers a protection on this PC.");
    expect(lead).toContain("It turns off a protection. Rig turns it back on by itself after 1 hour.");
    expect(screen.getByText("Rig says").parentElement!.textContent).toContain("anyone on the same public network");
    expect(screen.getByText(/Rig turns it back on by itself after 1 hour, even if the PC restarts in between\./)).toBeTruthy();
    expect(screen.getByText("Can it be undone", { selector: "dt" }).nextElementSibling!.textContent).toBe("Yes. Rig turns it back on by itself when the time is up, and you can turn it back on sooner.");
    expect(within(screen.getByRole("list", { name: "What changes" })).getByRole("listitem").textContent).toBe(`${name}:As it is now→ changed to Off for 1 hour`);
  });

  it("is never a card for keeping one off when it comes from a chat", () => {
    show({ name: "keepOff", id: "firewallPublic" });
    expect(screen.getByRole("heading", { name: "Rig won't make this change" })).toBeTruthy();
    expect(screen.getByText(KEEP_OFF_CHAT, { exact: false })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply|Read current settings/ })).toBeNull();
  });
});

describe("the time left", () => {
  it("is in plain words", () => {
    const due = "2026-11-17T21:00:00.000Z", at = (iso: string) => Date.parse(iso);
    expect(timeLeft(due, at("2026-11-17T20:18:30.000Z"))).toBe("42 minutes");
    expect(timeLeft(due, at("2026-11-17T17:55:00.000Z"))).toBe("3 hours 5 minutes");
    expect(timeLeft(due, at("2026-11-17T20:00:00.000Z"))).toBe("1 hour");
    expect(timeLeft(due, at("2026-11-17T20:59:40.000Z"))).toBe("20 seconds");
    expect(timeLeft(due, at("2026-11-17T21:00:05.000Z"))).toBe("0 seconds");
  });
});

/** A PC whose firewall Rig turned off 18 minutes ago for an hour. */
class Lowered extends DemoClient {
  log: Change[] = [{
    id: "c1", machineId: "demo-atlas", at: new Date(Date.now() - 18 * 60_000).toISOString(), title: `Turned off ${name} for 1 hour`, by: "rig", status: "applied", why: "", result: "", tier: 3,
    diff: [[name, "On", "Off"]], revert: { due: new Date(Date.now() + 42 * 60_000 - 5000).toISOString() },
    applied: [{ step: { kind: "native", op: { name: "protection", id: "firewallPublic", revertAfter: 60 } }, undo: { kind: "native", id: "u1", outside: [], fingerprint: "f" }, rows: [] }],
  }];
  asked: { step: HelperStep; own?: boolean }[] = [];
  override async changes() { return this.log; }
  override async previewStep(_id: string, step: HelperStep, _tainted = false, own?: boolean): Promise<PreviewReply> {
    this.asked.push({ step, own });
    return { outcome: "ready", nonce: "n1", expiresAt: new Date(Date.now() + 600_000).toISOString(), verdict: checkStep(step, { tainted: false, own }) as Allowed, read: `${name}: Off, and Rig turns it back on by itself`, touches: [] };
  }
  override async applyStep(_id: string, _nonce: string, _meta: ApplyMeta): Promise<ApplyReply> {
    this.log = this.log.map((c) => ({ ...c, revert: { due: null } }));
    return { outcome: "applied", result: { before: `${name}: Off, and Rig turns it back on by itself`, after: `${name}: Off, and it stays off`, output: "", alsoChanged: [], touches: [] }, undo: { kind: "native", id: "u2", outside: [], fingerprint: "f" } };
  }
  override async undoStep(_id: string, _undoId: string): Promise<UndoReply> {
    this.log = this.log.map((c) => ({ ...c, status: "undone", result: "You turned it back on in Rig." }));
    return { outcome: "undone", printed: `${name}: On`, left: [] };
  }
}

async function openChanges(client: DemoClient) {
  render(<RigApp client={client} />);
  await screen.findByText(/Things to look at/i);
  await act(async () => { location.hash = "changes"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  await screen.findByText(`Turned off ${name} for 1 hour`);
}

describe("a protection that is off for now, in Changes", () => {
  it("counts down, and keeps it off only after a second card of its own with the typed word", async () => {
    const client = new Lowered();
    const apply = vi.spyOn(client, "applyStep");
    await openChanges(client);
    expect(screen.getByText("By Rig, after you said yes. It's off. Rig turns it back on in 42 minutes.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn it back on now" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it off" }));
    expect(screen.getByRole("heading", { name: `Keeps ${name} off` })).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Read current settings" }));
    const word = await screen.findByRole("textbox", { name: /Type lower to turn on Apply/ });
    expect(client.asked).toEqual([{ step: { kind: "native", op: { name: "keepOff", id: "firewallPublic" } }, own: true }]);
    const go = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(word, { target: { value: "lower" } });
    fireEvent.click(go);
    expect(await screen.findByText("By Rig, after you said yes. It's off, and it stays off until you turn it back on.")).toBeTruthy();
    expect(apply).toHaveBeenCalledWith("demo-atlas", "n1", { title: `Keeps ${name} off`, why: "You chose to keep it off.", by: "you" });
    expect(screen.queryByRole("button", { name: "Keep it off" })).toBeNull();
    expect(screen.getByRole("button", { name: "Turn it back on now" })).toBeTruthy();
  });

  it("turns it back on now through the change's own undo, and then offers nothing more", async () => {
    const client = new Lowered();
    const undo = vi.spyOn(client, "undoStep");
    await openChanges(client);
    fireEvent.click(screen.getByRole("button", { name: "Turn it back on now" }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith("demo-atlas", "u1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Turn it back on now|Keep it off|Redo/ })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /^Details: Turned off/ }));
    expect(screen.getByText("You turned it back on in Rig.")).toBeTruthy();
  });
});
