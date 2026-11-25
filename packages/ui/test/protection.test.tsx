// A protection Rig turns off for a while: its card, the countdown, and the Changes page until it is back on.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkStep, PROTECTIONS, type Allowed, type ApplyMeta, type ApplyReply, type Change, type NativeOp, type OpenRevert, type PreviewReply, type Proposal, type UndoReply } from "@rig/core";
import { DemoClient } from "@rig/core/demo";
import { ChangeCards, type ChangeCardsProps } from "../src/components/change";
import { timeLeft } from "../src/components/change/Revert";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const op: NativeOp = { name: "protection", id: "firewall-public", revertAfter: 15 };
const step = { kind: "native" as const, op };
const keep = { kind: "native" as const, op: { name: "protectionKeep" as const, id: "firewall-public" } };
const row = PROTECTIONS.find((r) => r.id === "firewall-public")!;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const ready = () => ({ outcome: "ready" as const, nonce: "n1", expiresAt: inMinutes(5), verdict: checkStep(step) as Allowed, read: "On", touches: [] });
const proposal = (): Proposal => ({ id: "p", title: "Turn the firewall off", steps: [step], tier: 3, rows: [], status: "waiting", previews: [ready()] });

function show(p: Proposal, more: Partial<ChangeCardsProps> = {}) {
  const on = { onReviewFixes: vi.fn(), onDecline: vi.fn(), onCommandStep: vi.fn(), onSteps: vi.fn() };
  render(<ChangeCards proposal={p} previews={p.previews} pcName="Atlas" canApply {...on} {...more} />);
  return on;
}

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(() => cleanup());

describe("the card that turns a protection off", () => {
  it("says which protection, for how long, what is open meanwhile, and that it comes back on by itself", () => {
    show(proposal());
    expect(screen.getByText("Turns off Windows Firewall on public networks for 15 minutes")).toBeTruthy();
    expect(screen.getByText(row.risk)).toBeTruthy();
    expect(screen.getByText(/Rig turns it back on by itself after 15 minutes, also if the PC restarts or Rig is closed\./)).toBeTruthy();
    expect(screen.getByText(/Keeping it off is a separate choice only you can make there\./)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "What changes" })).getByRole("listitem").textContent).toBe("Windows Firewall on public networks:On→ changed to Off for 15 minutes");
  });

  it("counts down once it is off, and turns it back on now through the card's own undo", () => {
    const apply: ApplyReply = { outcome: "applied", result: { before: "On", after: "Off", output: "", alsoChanged: [], touches: [], revert: { id: "r1", dueAt: inMinutes(14) } }, undo: { kind: "native", id: "u1", outside: [], fingerprint: "f" } };
    const on = show(proposal(), { outcomes: [{ apply }] });
    expect(screen.getByRole("timer").textContent).toMatch(/^Rig turns it back on at .+, in 14 minutes\.$/);
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn it back on now" }));
    expect(on.onCommandStep).toHaveBeenCalledWith(0, "undo");
  });

  it("says what it does in Rig's own words, never as Claude's", () => {
    show(proposal());
    expect(screen.queryByText("Claude didn't say what this does.")).toBeNull();
    expect(screen.queryByText("Claude says")).toBeNull();
    expect(screen.getByText("Turns Windows Firewall on public networks off for 15 minutes, then back on by itself.")).toBeTruthy();
    expect(screen.getByText("What it does")).toBeTruthy();
  });

  it("says it is back on once it was turned back on from the card, with no countdown left", () => {
    const apply: ApplyReply = { outcome: "applied", result: { before: "On", after: "Off", output: "", alsoChanged: [], touches: [], revert: { id: "r1", dueAt: inMinutes(14) } }, undo: { kind: "native", id: "u1", outside: [], fingerprint: "f" } };
    const undo: UndoReply = { outcome: "undone", printed: "On", left: [] };
    show(proposal(), { outcomes: [{ apply, undo }] });
    expect(screen.getByText("Windows Firewall on public networks is back on.")).toBeTruthy();
    expect(screen.queryByText(/is off\./)).toBeNull();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn it back on now" })).toBeNull();
  });

  it("is never a card for keeping one off when it comes from a chat", () => {
    show({ id: "p", title: "Keep it off", steps: [keep], tier: 3, rows: [], status: "waiting", previews: [] });
    expect(screen.getByRole("heading", { name: "Rig won't make this change" })).toBeTruthy();
    expect(screen.getByText(/Only you can choose to keep a protection off/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Apply|Read current settings/ })).toBeNull();
  });

  it("words the time left plainly", () => {
    const now = Date.parse("2026-11-17T20:00:00Z");
    expect(timeLeft("2026-11-17T20:00:30Z", now)).toBe("in under a minute");
    expect(timeLeft("2026-11-17T20:14:10Z", now)).toBe("in 15 minutes");
    expect(timeLeft("2026-11-17T23:58:00Z", now)).toBe("in 4 hours");
    expect(timeLeft("2026-11-17T19:59:00Z", now)).toBeNull();
  });
});

describe("the Changes page while a protection is off", () => {
  class Off extends DemoClient {
    open: OpenRevert[] = [];
    readonly change: Change = {
      id: "c1", machineId: "demo-atlas", at: new Date().toISOString(), title: "Turned off Windows Firewall on public networks for 15 minutes", by: "rig", status: "applied", why: "", result: "",
      diff: [[row.name, "On", "Off"]], tier: 3, applied: [{ step, undo: { kind: "native", id: "u1", outside: [], fingerprint: "f" }, rows: [], revert: { id: "r1", dueAt: inMinutes(14) } }],
    };
    constructor() { super(); this.open = [{ changeId: "c1", undoId: "u1", row, dueAt: inMinutes(14), kept: false, checked: true }]; }
    override async changes(id: string) { return id === "demo-atlas" ? [this.change, ...(await super.changes(id))] : super.changes(id); }
    async reverts() { return this.open; }
    previewKeepOff = vi.fn(async (_id: string, _changeId: string): Promise<PreviewReply> => ({ outcome: "ready", nonce: "k1", expiresAt: inMinutes(5), verdict: checkStep(keep, { tainted: false, byPerson: true }) as Allowed, read: "Off for now", touches: [] }));
    override applyStep = vi.fn(async (_id: string, _nonce: string, _meta: ApplyMeta): Promise<ApplyReply> => { this.open = this.open.map((r) => ({ ...r, kept: true })); return { outcome: "applied", result: { before: "Off for now", after: "Off until you turn it back on", output: "", alsoChanged: [], touches: [] }, undo: { kind: "native", id: "u2", outside: [], fingerprint: "f" } }; });
    override undoStep = vi.fn(async (): Promise<UndoReply> => { this.open = []; this.change.status = "undone"; return { outcome: "undone", printed: "On", left: [] }; });
  }

  async function page(client: Off) {
    render(<RigApp client={client} />);
    await screen.findByText(/Things to look at/i);
    await act(async () => { location.hash = "changes"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    return within(await screen.findByRole("region", { name: /Off for now/ }));
  }

  it("shows it with its countdown until it is back on, and turns it back on now", async () => {
    const client = new Off();
    const off = await page(client);
    expect(off.getByText("Windows Firewall on public networks is off")).toBeTruthy();
    expect(off.getByRole("timer").textContent).toMatch(/in 14 minutes\.$/);
    fireEvent.click(off.getByRole("button", { name: "Turn it back on now" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: /Off for now/ })).toBeNull());
    expect(client.undoStep).toHaveBeenCalledWith("demo-atlas", "u1");
    expect(client.applyStep).not.toHaveBeenCalled();
  });

  it("keeps it off only after a second card of its own, with the typed word", async () => {
    const client = new Off();
    const off = await page(client);
    fireEvent.click(off.getByRole("button", { name: "Keep it off…" }));
    expect(off.getByRole("heading", { name: "Keeps Windows Firewall on public networks off" })).toBeTruthy();
    expect(client.previewKeepOff).not.toHaveBeenCalled();
    fireEvent.click(off.getByRole("button", { name: "Read current settings" }));
    const word = await off.findByRole("textbox", { name: /Type lower to turn on Apply/ });
    expect(client.previewKeepOff).toHaveBeenCalledWith("demo-atlas", "c1");
    const go = off.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(word, { target: { value: "lower" } });
    fireEvent.click(go);
    await waitFor(() => expect(off.getByText("Off until you turn it back on.")).toBeTruthy());
    expect(client.applyStep).toHaveBeenCalledWith("demo-atlas", "k1", { by: "you", why: "You chose to keep it off after Rig turned it off for a while." });
    expect(off.queryByRole("button", { name: "Keep it off…" })).toBeNull();
    expect(off.getByRole("button", { name: "Turn it back on now" })).toBeTruthy();
  });

  it("drops the second card when the person says not now, and keeps nothing off", async () => {
    const client = new Off();
    const off = await page(client);
    fireEvent.click(off.getByRole("button", { name: "Keep it off…" }));
    fireEvent.click(off.getByRole("button", { name: "Read current settings" }));
    await off.findByRole("textbox", { name: /Type lower to turn on Apply/ });
    fireEvent.click(off.getByRole("button", { name: "Not now" }));
    expect(off.queryByRole("heading", { name: "Keeps Windows Firewall on public networks off" })).toBeNull();
    expect(client.applyStep).not.toHaveBeenCalled();
    expect(off.getByRole("button", { name: "Keep it off…" })).toBeTruthy();
  });
});
