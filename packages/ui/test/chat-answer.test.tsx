// Rig's answers show their lists as lists and their bold labels as bold, while they stream in and after.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatMessage } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { Answer } = await import("../src/pages/chat/Answer");

// The shape of the startup-apps answer that showed its items run together in one paragraph.
const ANSWER = `Six can go with no downside, and a few more depend on what you use. The card I'm sending turns off these six:

- **Riot Client, Steam, Battle.net and Lunar Client.** These are game launchers. They still open normally when you click them.
- **StartAUEP.** This is AMD's User Experience Program, which only sends usage data to AMD. Your graphics driver doesn't need it.
- **SunJavaUpdateSched.** This only checks for Java updates. You can update Java by hand now and then.

Your memory is 74% used even though the PC is nearly idle, so cutting these background apps should help.

**Turn these off only if you don't use them:**
- **AMDNoiseSuppression** cleans up background noise on your mic.
- **LGHUB** keeps your Logitech mouse and keyboard settings (DPI, macros, lighting) active.

**Leave these on:**
- **SecurityHealth** is Windows Security's icon in the taskbar.
- **RtkAudUService** is the Realtek audio service.

Nothing changes until you approve the card in Rig.`;

/** Streams `text` in pieces that cut through the middle of "**" and "- ", like the real server can. */
class Streaming extends DemoClient {
  constructor(private text: string, private step = 13) { super(); }
  override async chat(_id: string, _history: ChatMessage[], onEvent: (e: ChatEvent) => void) {
    for (let i = 0; i < this.text.length; i += this.step) {
      onEvent({ type: "text", text: this.text.slice(i, i + this.step) });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
}

async function ask(client: DemoClient, q: string) {
  render(<RigApp client={client} />);
  await screen.findByText(/Things to look at/i);
  await act(async () => { location.hash = "chat"; window.dispatchEvent(new HashChangeEvent("hashchange")); });
  const box = await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: q } });
  fireEvent.keyDown(box, { key: "Enter" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy(), { timeout: 10000 });
  const answers = document.querySelectorAll(".msg.claude .body");
  return answers[answers.length - 1] as HTMLElement;
}

beforeEach(() => { location.hash = ""; localStorage.clear(); });
afterEach(() => cleanup());

describe("Rig's answers", () => {
  it("show each list item on its own line, with its bold label, after streaming in", async () => {
    const body = await ask(new Streaming(ANSWER), "Which startup apps can I turn off?");
    const lists = within(body).getAllByRole("list");
    expect(lists).toHaveLength(3);
    const items = lists.map((l) => within(l).getAllByRole("listitem").map((li) => li.textContent));
    expect(items[0]).toEqual([
      "Riot Client, Steam, Battle.net and Lunar Client. These are game launchers. They still open normally when you click them.",
      "StartAUEP. This is AMD's User Experience Program, which only sends usage data to AMD. Your graphics driver doesn't need it.",
      "SunJavaUpdateSched. This only checks for Java updates. You can update Java by hand now and then.",
    ]);
    expect(items[1].map((t) => t!.split(" ")[0])).toEqual(["AMDNoiseSuppression", "LGHUB"]);
    expect(items[2].map((t) => t!.split(" ")[0])).toEqual(["SecurityHealth", "RtkAudUService"]);
    expect([...lists[0].querySelectorAll("li > strong")].map((s) => s.textContent)).toEqual(["Riot Client, Steam, Battle.net and Lunar Client.", "StartAUEP.", "SunJavaUpdateSched."]);
    // The labels above the second and third lists are bold paragraphs of their own.
    expect(within(body).getByText("Turn these off only if you don't use them:").tagName).toBe("STRONG");
    expect(lists[1].previousElementSibling?.textContent).toBe("Turn these off only if you don't use them:");
    // No Markdown marks are left showing anywhere.
    expect(body.textContent).not.toMatch(/\*\*| - \*\*|^- /m);
    expect([...body.querySelectorAll(":scope > p")].map((p) => p.textContent)).toEqual([
      "Six can go with no downside, and a few more depend on what you use. The card I'm sending turns off these six:",
      "Your memory is 74% used even though the PC is nearly idle, so cutting these background apps should help.",
      "Turn these off only if you don't use them:",
      "Leave these on:",
      "Nothing changes until you approve the card in Rig.",
    ]);
  }, 15000);

  it("show a list item as soon as its line starts, with no stray marks while bold is still arriving", () => {
    const half = ANSWER.slice(0, ANSWER.indexOf("StartAUEP") + 5); // ends "...\n- **Start"
    const { container } = render(<Answer text={half} />);
    const items = within(container).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([expect.stringMatching(/^Riot Client/), "Start"]);
    expect(items[1].querySelector("strong")?.textContent).toBe("Start");
    cleanup();
    const { container: c2 } = render(<Answer text={"Intro\n\n- **"} />);
    expect(c2.textContent).toBe("Intro");
  });

  it("keep numbered lists, emphasis and code, and leave other asterisks as written", () => {
    const { container } = render(<Answer text={"Do this:\n\n1. Open *Settings*\n2. Pick `Display`\n\n3. Restart\n\nA 2*3 grid and C:\\Windows\\*.log stay as they are."} />);
    const list = within(container).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Open Settings", "Pick Display", "Restart"]);
    expect(container.querySelector("em")?.textContent).toBe("Settings");
    expect(container.querySelector("code")?.textContent).toBe("Display");
    expect(container.lastElementChild?.textContent).toBe("A 2*3 grid and C:\\Windows\\*.log stay as they are.");
  });
});
