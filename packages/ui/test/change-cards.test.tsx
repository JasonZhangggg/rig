// The cards that ask before a command runs, and what they show afterwards.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixSteps, type Proposal, type StepOutcome } from "@rig/core";
import { DemoClient, demoApply, demoCards, demoProposal, demoUndo, demoUndoRecord } from "@rig/core/demo";
import { ChangeCards, StepRecord, type ChangeCardsProps } from "../src/components/change";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const card = (key: string) => demoCards.find((c) => c.key === key)!;

function show(p: Proposal, more: Partial<ChangeCardsProps> = {}) {
  const on = { onReviewFixes: vi.fn(), onDecline: vi.fn(), onCommandStep: vi.fn(), onSteps: vi.fn() };
  render(<ChangeCards proposal={p} previews={p.previews} pcName="Atlas" canApply {...on} {...more} />);
  return on;
}
const button = (name: string | RegExp) => screen.queryByRole("button", { name });

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(() => cleanup());

describe("a card of Rig's own fixes", () => {
  it("shows the settings as rows and opens the review sheet", () => {
    const steps = fixSteps([{ kind: "startup.app", name: "Discord", enabled: false }]);
    const on = show({ id: "p", title: "Turn off Discord at startup", steps, tier: 1, rows: [["Discord", "Starts with Windows", "Off"]], status: "waiting" });
    expect(within(screen.getByRole("table")).getByText("Starts with Windows")).toBeTruthy();
    expect(screen.getByText(/1 change · undo anytime/)).toBeTruthy();
    fireEvent.click(button("Review and apply")!);
    expect(on.onReviewFixes).toHaveBeenCalledOnce();
    expect(on.onCommandStep).not.toHaveBeenCalled();
  });
});

describe("the amber card", () => {
  it("labels Claude's sentence and shows what Rig read, found and would change", () => {
    show(demoProposal(card("registry")));
    expect(screen.getByRole("heading", { name: "Changes a registry value" })).toBeTruthy();
    expect(screen.getByText("Check before you apply")).toBeTruthy();
    expect(screen.getByText("Claude says").parentElement!.textContent).toContain("Turns on seconds in the taskbar clock");
    expect(screen.getByLabelText("Now").textContent).toBe("ShowSecondsInSystemClock : 0");
    const found = within(screen.getByRole("list", { name: "Commands Rig found" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(found).toEqual(["Set-ItemPropertychanges a registry valueChanges", "Get-ItemPropertyreads a registry value or file detailsReads"]);
    const touch = within(screen.getByRole("list", { name: "What it changes" })).getByRole("listitem");
    expect(touch.textContent).toContain("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced\\ShowSecondsInSystemClock");
    expect(touch.textContent).toMatch(/Now 0$/);
    expect(screen.getByText(/^Can be undone\. Rig saves the current value first, then runs the undo script\.$/)).toBeTruthy();
  });

  it("keeps the full scripts folded, one tap away", () => {
    show(demoProposal(card("registry")));
    const run = screen.getByLabelText("Change script");
    expect(run.textContent).toBe(card("registry").cmd.run);
    expect(screen.getByLabelText("Undo script").textContent).toBe(card("registry").cmd.undo);
    expect(run.closest("details")!.open).toBe(false);
    expect(screen.getByText("Change script").closest("summary")).toBeTruthy();
  });

  it("needs two presses: Review, then Apply", async () => {
    const on = show(demoProposal(card("registry")));
    expect(button("Apply")).toBeNull();
    fireEvent.click(button("Review")!);
    expect(on.onCommandStep).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Change script").closest("details")!.open).toBe(true);
    fireEvent.click(button("Apply")!);
    expect(on.onCommandStep).toHaveBeenCalledWith(0, "apply");
    await waitFor(() => expect(button("Apply")).toBeTruthy());
  });

  it("says when Windows will ask for permission", () => {
    show(demoProposal(card("firewall")));
    expect(screen.getByRole("heading", { name: "Adds a firewall rule" })).toBeTruthy();
    expect(screen.getByText("Admin")).toBeTruthy();
    expect(screen.getByText(/runs as admin, so Windows will ask for permission/)).toBeTruthy();
    expect(screen.getByText(/Rig can't save a copy of this first, so undo relies on that script/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "What it changes" })).getByRole("listitem").textContent).toMatch(/Minecraft server.*Not there/);
  });

  it("says when Rig read outside text before suggesting it", () => {
    show(demoProposal(card("registry")), { tainted: true });
    expect(screen.getByText(/Rig suggested this after reading text from outside this PC/)).toBeTruthy();
  });

  it("can be turned down", () => {
    const on = show(demoProposal(card("registry")));
    fireEvent.click(button("Not now")!);
    expect(on.onDecline).toHaveBeenCalledOnce();
  });
});

describe("the red card", () => {
  it("says what can't be undone before anything else", () => {
    show(demoProposal(card("uninstall")));
    const box = screen.getByRole("region", { name: "Uninstalls an app" });
    const first = within(box).getByRole("note");
    expect(first.textContent).toMatch(/^This can't be undone\./);
    expect(first.textContent).toContain("There is no undo script");
    expect(first.compareDocumentPosition(screen.getByText("Claude says")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/^No undo\. Rig can't save a copy of NVIDIA Broadcast/)).toBeTruthy();
    expect(screen.queryByLabelText("Undo script")).toBeNull();
  });

  it("keeps Apply off until the word it shows is typed", () => {
    const on = show(demoProposal(card("uninstall")));
    const apply = button("Apply") as HTMLButtonElement;
    const box = screen.getByRole("textbox", { name: /Type confirm to turn on Apply/ });
    expect(apply.disabled).toBe(true);
    fireEvent.click(apply);
    fireEvent.change(box, { target: { value: "yes" } });
    expect(apply.disabled).toBe(true);
    expect(on.onCommandStep).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "Confirm " } });
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(on.onCommandStep).toHaveBeenCalledWith(0, "apply");
  });

  it("gives each step its own card", () => {
    const one = demoProposal(card("uninstall"));
    const two: Proposal = { ...one, steps: [...one.steps, ...one.steps], previews: [...one.previews!, ...one.previews!] };
    show(two);
    expect(screen.getAllByRole("region", { name: "Uninstalls an app" })).toHaveLength(2);
    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });
});

describe("a refused change", () => {
  it("says what was refused and that nothing changed, with no way to apply", () => {
    const on = show(demoProposal(card("refused")));
    expect(screen.getByRole("heading", { name: "Rig won't make this change" })).toBeTruthy();
    expect(screen.getByText(/Rig won't run Add-MpPreference: it adds a Defender exclusion/, { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Nothing changed on Atlas.")).toBeTruthy();
    expect(button(/apply/i)).toBeNull();
    expect(button("Review")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(button("Show me the steps")!);
    expect(on.onSteps).toHaveBeenCalledWith(0);
  });
});

describe("after a change", () => {
  const done = (key: string, undo = false): StepOutcome => ({ apply: demoApply(card(key)), undo: undo ? demoUndo(card(key)) : undefined });

  it("shows before and after side by side, each touch, and what else changed", () => {
    const p = demoProposal(card("firewall"));
    const on = show(p, { outcomes: [done("firewall")] });
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByLabelText("Before").textContent).toBe("No rule with that name.");
    expect(screen.getByLabelText("After").textContent).toMatch(/Minecraft server\s+True\s+Inbound\s+Allow/);
    expect(within(screen.getByRole("list", { name: "What changed" })).getByRole("listitem").textContent).toMatch(/Minecraft serverNot there→On, inbound, TCP 25565, allow$/);
    expect(screen.getByText("Also changed").closest(".cc-fact")!.textContent).toContain("FirewallPolicy\\FirewallRules");
    expect(screen.getByText(/Undo runs the undo script\. It can't put back the other thing that changed\. As a last resort, Windows has a restore point/)).toBeTruthy();
    expect(button("Apply")).toBeNull();
    fireEvent.click(button("Undo")!);
    expect(on.onCommandStep).toHaveBeenCalledWith(0, "undo");
  });

  it("says what undo put back and what it couldn't", () => {
    show(demoProposal(card("firewall")), { outcomes: [done("firewall", true)] });
    expect(screen.getByText("Undone")).toBeTruthy();
    expect(screen.getByText("Put back, except for what's listed below.")).toBeTruthy();
    expect(screen.getByText("Rig couldn't put back").closest(".cc-fact")!.textContent).toContain("The rule itself is off");
    expect(screen.getByLabelText("Now").textContent).toBe("No rule with that name.");
    expect(button("Undo")).toBeNull();
  });

  it("shows a rollback: what was put back and why", () => {
    show(demoProposal(card("rollback")), { outcomes: [done("rollback")] });
    expect(screen.getByText("Put back")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Rig put everything back. Nothing is changed on Atlas.");
    expect(screen.getByText(/The command changed the apps that start with Windows, which Rig never lets a command change/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "What was put back" })).getByRole("listitem").textContent).toMatch(/InprocServer32Now Not there$/);
    expect(button("Undo")).toBeNull();
    expect(button("Apply")).toBeNull();
  });

  it("says so when the card was too old to run", () => {
    show(demoProposal(card("registry")), { outcomes: [{ apply: { outcome: "expired" } }] });
    expect(screen.getByText(/too old to run, so nothing changed on Atlas\. Ask again/)).toBeTruthy();
  });
});

describe("a command in the changes log", () => {
  it("shows Claude's sentence, Rig's before and after, and the scripts that ran", () => {
    const c = card("firewall");
    render(<StepRecord applied={{ step: { kind: "command", cmd: c.cmd }, undo: demoUndoRecord(c), rows: [], verify: { before: c.read, after: c.after } }} />);
    expect(screen.getByText("Claude says").parentElement!.textContent).toContain("Adds a firewall rule that lets other devices reach");
    expect(screen.getByLabelText("Before").textContent).toBe("No rule with that name.");
    expect(screen.getByLabelText("After").textContent).toContain("Minecraft server");
    expect(screen.getByText("Also changed")).toBeTruthy();
    expect(screen.getByLabelText("Change script").textContent).toBe(c.cmd.run);
    expect(screen.getByText(/It can't put back the other thing that changed/)).toBeTruthy();
  });
});

describe("on the website", () => {
  it("shows the card, and says changes are made in the Rig app on that PC", () => {
    show(demoProposal(card("registry")), { canApply: false });
    expect(screen.getByLabelText("Now")).toBeTruthy();
    expect(screen.getByText("Changes are made in the Rig app on Atlas. Open Rig there to apply this.")).toBeTruthy();
    expect(button("Review")).toBeNull();
    expect(button("Apply")).toBeNull();
  });

  it("offers no typed confirm on a red card", () => {
    show(demoProposal(card("uninstall")), { canApply: false });
    expect(screen.getByRole("note").textContent).toMatch(/^This can't be undone\./);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(button("Apply")).toBeNull();
  });
});

describe("in the demo", () => {
  async function ask(q: string) {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: q } });
    fireEvent.keyDown(box, { key: "Enter" });
  }

  it("applies a command from its card, shows the result, and logs it in Changes", async () => {
    await ask(card("registry").ask);
    fireEvent.click(await screen.findByRole("button", { name: "Review" }, { timeout: 4000 }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((await screen.findByLabelText("After", {}, { timeout: 4000 })).textContent).toBe("ShowSecondsInSystemClock : 1");
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    await act(async () => { location.hash = "changes"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByText("Show seconds on the taskbar clock")).toBeTruthy();
  });

  it("answers a refused card's ask for steps", async () => {
    await ask(card("refused").ask);
    fireEvent.click(await screen.findByRole("button", { name: "Show me the steps" }, { timeout: 4000 }));
    expect(await screen.findByText(/Open Windows Security from the Start menu/, {}, { timeout: 4000 })).toBeTruthy();
  });
});
