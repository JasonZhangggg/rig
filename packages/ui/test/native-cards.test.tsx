// The cards for changes the helper's own code makes (graphics settings, a program's settings file), and what they show afterwards.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, NativeOp, Proposal, StepOutcome } from "@rig/core";
import { DemoClient, demoApply, demoCards, demoNativeCards, demoProposal, demoUndo, type AnyDemoCard } from "@rig/core/demo";
import { ChangeCards, type ChangeCardsProps } from "../src/components/change";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { AppProvider, useActions, useData } = await import("../src/state");

const card = (key: string): AnyDemoCard => [...demoCards, ...demoNativeCards].find((c) => c.key === key)!;

function show(p: Proposal, more: Partial<ChangeCardsProps> = {}) {
  const on = { onReviewFixes: vi.fn(), onDecline: vi.fn(), onCommandStep: vi.fn(), onSteps: vi.fn() };
  render(<ChangeCards proposal={p} previews={p.previews} pcName="Atlas" canApply {...on} {...more} />);
  return on;
}
const button = (name: string | RegExp) => screen.queryByRole("button", { name });
const glance = (dt: string) => screen.getByText(dt, { selector: "dt" }).nextElementSibling!.textContent;
const changes = (name = "What changes") => within(screen.getByRole("list", { name })).getAllByRole("listitem").map((li) => li.textContent);
/** A proposal of one native op, before Rig has read the current settings. */
const unread = (op: NativeOp): Proposal => ({ id: "p", title: "A change", steps: [{ kind: "native", op }], tier: 2, rows: [], status: "waiting", previews: [] });

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(() => cleanup());

describe("a settings file card", () => {
  it("shows the file, each value before and after from Rig's read, and its tier", () => {
    show(demoProposal(card("fileEdit")));
    expect(screen.getByRole("heading", { name: "Changes 2 values in GameUserSettings.ini" })).toBeTruthy();
    expect(screen.getByText("Check first")).toBeTruthy();
    expect(glance("What changes")).toContain("GameUserSettings.ini");
    expect(glance("What changes")).toContain("C:\\Users\\Sam\\AppData\\Local\\Pal\\Saved\\Config\\Windows\\GameUserSettings.ini");
    expect(changes()).toEqual([
      "/Script/Engine.GameUserSettings › bUseVSync:True→ changed to False",
      "/Script/Engine.GameUserSettings › FrameRateLimit:0.000000→ changed to 141.000000",
    ]);
    expect(glance("How risky")).toMatch(/^Low\.Rig changes only the text of the values listed and saves a copy of the file first/);
    expect(glance("Can it be undone")).toBe("Yes. Rig keeps how it was, and Undo puts it back.");
    expect(screen.getByRole("region", { name: "The lines that change (on Atlas)" }).textContent).toContain("+ bUseVSync=False");
    expect(screen.getByText("Claude says").parentElement!.textContent).toContain("Turns off vsync and caps Palworld");
    expect(screen.queryByLabelText("Change script")).toBeNull();
  });

  it("says when it adds a key or reaches past your own folders, and asks more for it", () => {
    show(unread({ name: "fileEdit", does: "Turns off the intro.", path: "C:\\Users\\Public\\Game\\settings.json", format: "json", edits: [{ at: ["intro"], value: false, add: true }] }));
    const risk = glance("How risky");
    expect(risk).toMatch(/^Medium\./);
    expect(risk).toContain("It adds a key the file may not have yet");
    expect(risk).toContain("The file isn't in your own folders");
    expect(changes()).toEqual(["intro:As it is now→ changed to false"]);
    expect(button("Read current settings")).toBeTruthy();
  });
});

describe("a graphics setting card", () => {
  it("shows the setting's plain name, the program, and its value now and after", () => {
    show(demoProposal(card("gpu")));
    expect(screen.getByRole("heading", { name: "Changes Low latency mode for cyberpunk2077.exe" })).toBeTruthy();
    expect(glance("What changes")).toContain("Setting Low latency mode");
    expect(glance("What changes")).toContain("Program cyberpunk2077.exe");
    expect(changes()).toEqual(["Low latency mode:Off: the game decides→ changed to On: at most one frame waits"]);
    expect(screen.getByRole("region", { name: "NVIDIA's settings now (on Atlas)" }).textContent).toContain("(the driver's default)");
  });

  it("says all programs when it's for the whole PC", () => {
    show(unread({ name: "gpu", vendor: "nvidia", setting: "vsync", value: "off", does: "Turns off vertical sync everywhere." }));
    expect(screen.getByRole("heading", { name: "Changes Vertical sync for all programs" })).toBeTruthy();
    expect(glance("What changes")).toContain("Program All programs");
    expect(changes()).toEqual(["Vertical sync:As it is now→ changed to Off"]);
  });
});

describe("an app window card", () => {
  const screenCard = () => card("screen") as Extract<AnyDemoCard, { key: "screen" }>;

  it("shows the app, the path and the value now and after in the app's words, on a red card", () => {
    show(demoProposal(screenCard()), { canApply: false });
    expect(screen.getByRole("heading", { name: "Changes a setting in NVIDIA Control Panel" })).toBeTruthy();
    expect(screen.getByText("Can't promise an undo")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("Rig can't promise to undo this.");
    expect(glance("What changes")).toContain("App NVIDIA Control Panel");
    expect(glance("What changes")).toContain("Path Change resolution › Output dynamic range · names and values in the app's own words");
    expect(changes()).toEqual(["Output dynamic range:Limited→ changed to Full"]);
    expect(glance("How risky")).toMatch(/^High\./);
    expect(glance("Can it be undone")).toMatch(/^Not for sure\. Undo walks the same path/);
    expect(screen.getByText(/Rig will click through NVIDIA Control Panel's window to set it/).textContent).toContain("A Stop bar shows at the top of the screen while it does");
    expect(screen.getByText("Changes are made in the Rig app on Atlas. Open Rig there to apply this.")).toBeTruthy();
    expect(button("Apply")).toBeNull();
  });

  it("asks for the card's word before Apply, on the PC", () => {
    show(demoProposal(screenCard()));
    const apply = button("Apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Type permanent/), { target: { value: "permanent" } });
    expect(apply.disabled).toBe(false);
  });

  it("is refused when the proposal doesn't carry the look it names", () => {
    const { looks: _l, ...bare } = demoProposal(screenCard());
    show({ ...bare, previews: [] });
    expect(screen.getByRole("heading", { name: "Rig won't make this change" })).toBeTruthy();
    expect(screen.getByText(/Rig hasn't looked at this control/)).toBeTruthy();
  });

  it("says what Rig set once it ran", () => {
    show(demoProposal(screenCard()), { outcomes: [{ apply: demoApply(screenCard()) }] });
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByText("Rig set Output dynamic range to Full in NVIDIA Control Panel and read it back.")).toBeTruthy();
    expect(changes("What changed")).toEqual(["Output dynamic range:Limited→ changed to Full"]);
  });

  it("says Rig stopped when the person pressed Stop, and offers undo", () => {
    const ran = demoApply(screenCard());
    if (ran.outcome !== "applied") throw new Error("the demo card should apply");
    const stopped = { ...ran, result: { ...ran.result, stopped: true as const, after: "You pressed Stop, so Rig stopped. It had started setting Output dynamic range to Full and didn't read it back." } };
    const on = show(demoProposal(screenCard()), { outcomes: [{ apply: stopped }] });
    expect(screen.getByRole("status").textContent).toBe("You pressed Stop, so Rig stopped part way.");
    expect(screen.getByText(/Rig didn't read Output dynamic range back, so check it in NVIDIA Control Panel/).textContent).toContain("sets it back to Limited");
    expect(screen.queryByRole("list", { name: "What changed" })).toBeNull();
    fireEvent.click(button("Undo")!);
    expect(on.onCommandStep).toHaveBeenCalledWith(0, "undo");
  });
});

describe("a kind of change this Rig doesn't know", () => {
  it("is refused in plain words, never left blank", () => {
    const on = show(unread({ name: "refreshRate", does: "Sets the screen to 144 Hz.", hz: 144 } as unknown as NativeOp));
    expect(screen.getByRole("heading", { name: "Rig won't make this change" })).toBeTruthy();
    expect(screen.getByText(/This copy of Rig doesn't know this kind of change, so it won't make it\. Update Rig, then ask again\./)).toBeTruthy();
    expect(screen.getByText("Claude says").parentElement!.textContent).toContain("Sets the screen to 144 Hz.");
    expect(button(/Apply|Review|Read current settings/)).toBeNull();
    fireEvent.click(button("Show me the steps")!);
    expect(on.onSteps).toHaveBeenCalledWith(0);
  });

  it("is refused when Rig won't make it, with Rig's reason", () => {
    show(unread({ name: "gpu", vendor: "amd", setting: "vsync", value: "off", does: "Turns off vsync." } as unknown as NativeOp));
    expect(screen.getByText("Rig can only change NVIDIA's graphics settings for now.")).toBeTruthy();
    expect(button("Read current settings")).toBeNull();
  });
});

describe("a proposal with commands and native steps", () => {
  it("shows every step in order, and counts each one", () => {
    const parts = [demoProposal(card("registry")), demoProposal(card("gpu")), demoProposal(card("fileEdit"))];
    const p: Proposal = { ...parts[0], steps: parts.flatMap((x) => x.steps), previews: parts.flatMap((x) => x.previews!) };
    const on = show(p);
    const heads = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(heads).toEqual(["Changes a registry value", "Changes Low latency mode for cyberpunk2077.exe", "Changes 2 values in GameUserSettings.ini"]);
    expect(screen.getAllByText(/^\d of 3$/).map((x) => x.textContent)).toEqual(["1 of 3", "2 of 3", "3 of 3"]);
    expect(screen.getAllByText("Apply 1 of 3 first.")).toHaveLength(2);
    fireEvent.click(button("Review")!);
    expect(on.onCommandStep).not.toHaveBeenCalled();
  });
});

describe("after a native change", () => {
  const done = (key: string, undo = false): StepOutcome => ({ apply: demoApply(card(key)), undo: undo ? demoUndo(card(key)) : undefined });

  it("shows each value before and after, and Undo", () => {
    const on = show(demoProposal(card("gpu")), { outcomes: [done("gpu")] });
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(changes("What changed")).toEqual(["Low latency mode:Off: the game decides→ changed to On: at most one frame waits"]);
    expect(screen.getByText("Undo puts it back the way Rig read it before.")).toBeTruthy();
    fireEvent.click(button("Undo")!);
    expect(on.onCommandStep).toHaveBeenCalledWith(0, "undo");
  });

  it("says what undo put back", () => {
    show(demoProposal(card("fileEdit")), { outcomes: [done("fileEdit", true)] });
    expect(screen.getByText("Undone")).toBeTruthy();
    expect(screen.getByText("Put back the way it was.")).toBeTruthy();
    expect(screen.getByRole("region", { name: "After undo, Rig read" }).textContent).toContain("bUseVSync: True");
    expect(button("Undo")).toBeNull();
  });

  it("shows a rollback and what Rig couldn't put back", () => {
    const apply = { outcome: "rolledBack" as const, result: { before: "", after: "", output: "", alsoChanged: [], touches: [] }, sentinels: [], error: "The file was in use.", left: ["GameUserSettings.ini"] };
    show(demoProposal(card("fileEdit")), { outcomes: [{ apply }] });
    expect(screen.getByRole("status").textContent).toBe("Rig stopped this and put back what it had saved.");
    expect(screen.getByText("It stopped with an error: The file was in use.")).toBeTruthy();
    expect(screen.getByText("Rig couldn't put back").closest(".cc-fact")!.textContent).toContain("GameUserSettings.ini");
    expect(button("Undo")).toBeNull();
  });
});

describe("on the website", () => {
  it("shows a native card, and says changes are made in the Rig app on that PC", () => {
    show(demoProposal(card("fileEdit")), { canApply: false });
    expect(changes()).toHaveLength(2);
    expect(screen.getByText("Changes are made in the Rig app on Atlas. Open Rig there to apply this.")).toBeTruthy();
    expect(button("Review")).toBeNull();
    expect(button("Apply")).toBeNull();
  });
});

describe("applying a native step through the app", () => {
  class OneCard extends DemoClient {
    override conversation(id: string): ChatMessage[] { return id === "demo-atlas" ? [{ id: "m", from: "rig", text: "One step.", proposal: demoProposal(card("gpu"), "g") }] : []; }
  }
  let actions!: ReturnType<typeof useActions>;
  let chat!: ChatMessage[];
  function Probe() { actions = useActions(); chat = useData("chat").chat; return null; }

  it("goes through the same calls as a command, and logs it in Changes", async () => {
    const client = new OneCard();
    const apply = vi.spyOn(client, "applyStep");
    const undo = vi.spyOn(client, "undoStep");
    render(<AppProvider client={client} fallback={(t) => <p>{t}</p>}><Probe /></AppProvider>);
    await waitFor(() => expect(chat?.length).toBe(1));
    await act(() => actions.commandStep("g", 0, "apply"));
    expect(apply).toHaveBeenCalledOnce();
    expect(chat[0].proposal!.outcomes![0]!.apply.outcome).toBe("applied");
    const change = (await client.changes("demo-atlas"))[0];
    expect(change.title).toBe("Changes Low latency mode for cyberpunk2077.exe");
    await act(() => actions.commandStep("g", 0, "undo"));
    expect(undo).toHaveBeenCalledWith("demo-atlas", "undo-gpu");
    expect(chat[0].proposal!.outcomes![0]!.undo?.outcome).toBe("undone");
  });

  it("reads, applies and undoes from the card in the demo", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: card("fileEdit").ask } });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(await screen.findByRole("button", { name: "Review" }, { timeout: 4000 }));
    expect(screen.getByText("This is exactly what changes on Atlas.")).toBeTruthy();
    const applyButton = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    await waitFor(() => expect(applyButton.disabled).toBe(false));
    fireEvent.click(applyButton);
    expect(await screen.findByRole("list", { name: "What changed" }, { timeout: 4000 })).toBeTruthy();
    expect(changes("What changed")).toEqual([
      "/Script/Engine.GameUserSettings › bUseVSync:True→ changed to False",
      "/Script/Engine.GameUserSettings › FrameRateLimit:0.000000→ changed to 141.000000",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Put back the way it was.", {}, { timeout: 4000 })).toBeTruthy();
  });
});
