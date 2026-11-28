// "Why is it slow or loud?": one tap on Home or in Ctrl K, answered from Rig's own readings with a step for each cause.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const openFromHome = async (client = new DemoClient()) => {
  render(<RigApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Slow or loud? Check now" }));
  return screen.getByRole("dialog", { name: /./ });
};

describe("why is it slow or loud", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("opens from Home and names what keeps the PC busy, with a step for each cause", async () => {
    const dialog = within(await openFromHome());
    // The demo desktop is in a game with a Windows Security scan beside it whenever it's checked.
    expect(await dialog.findByRole("heading", { name: "The fans are loud. Here's why." })).toBeTruthy();
    const found = within(dialog.getByRole("list", { name: "What Rig found" }));
    expect(found.getByText("Windows Security is scanning in the background")).toBeTruthy();
    expect(found.getByText("MsMpEng.exe uses 10% of the processor")).toBeTruthy();
    fireEvent.click(found.getByRole("button", { name: "Ask about settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /fans are loud/ })).toBeNull());
    expect(await screen.findByText(/^Cyberpunk 2077 keeps my graphics card at 97%/)).toBeTruthy();
  });

  it("says plainly when nothing looks wrong, and what it checked", async () => {
    // The demo laptop, at work on a Thursday morning.
    localStorage.setItem("rig.pc", "demo-pebble");
    const client = new DemoClient();
    client.processes = async () => [{ name: "EXCEL.EXE", cpu: 9, memMb: 780 }];
    const dialog = within(await openFromHome(client));
    expect(await dialog.findByRole("heading", { name: "Nothing looks wrong right now." })).toBeTruthy();
    expect(dialog.getByText("Processor")).toBeTruthy();
    expect(dialog.getByText("Excel is the busiest, at 9%")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still answers where the apps can't be read, and says what that needs", async () => {
    const client = new DemoClient();
    client.processes = async () => null;
    const dialog = within(await openFromHome(client));
    expect(await dialog.findByText("The list of apps needs the Rig app open on Atlas.")).toBeTruthy();
  });

  it("opens from Ctrl K", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("button", { name: "Slow or loud? Check now" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "noisy" } });
    fireEvent.click(screen.getByRole("button", { name: /Why is Atlas slow or loud\?/ }));
    expect(await screen.findByRole("heading", { name: "The fans are loud. Here's why." })).toBeTruthy();
  });

  it("on the gaming laptop, says a game is on the built-in graphics and that it's on battery, and moves the game through review", async () => {
    localStorage.setItem("rig.pc", "demo-comet");
    const client = new DemoClient();
    const dialog = within(await openFromHome(client));
    expect(await dialog.findByRole("heading", { name: "Here's what's slowing Comet down." })).toBeTruthy();
    const found = within(dialog.getByRole("list", { name: "What Rig found" }));
    expect(found.getAllByRole("listitem").map((li) => li.querySelector(".row-title")!.textContent)).toEqual([
      "Baldur's Gate 3 is running on the built-in graphics", "On battery, Windows is saving power",
    ]);
    expect(found.getByText(/^bg3\.exe uses \d+% of the Radeon 780M · RTX 4060 asleep$/)).toBeTruthy();
    expect(found.getByText("Unplugged at 46% · Power mode is Best power efficiency")).toBeTruthy();
    // Plugging in is the person's to do: said, not a button.
    expect(found.getByText("Plug in")).toBeTruthy();
    expect(found.queryByRole("button", { name: "Plug in" })).toBeNull();
    fireEvent.click(found.getByRole("button", { name: "Details: On battery, Windows is saving power" }));
    expect(found.getByText(/while the laptop runs on battery\. Plugging in brings back full speed\.$/)).toBeTruthy();

    // The game's step is the usual review: Windows' own words before and after, then the change, which can be undone.
    fireEvent.click(found.getByRole("button", { name: "Review change" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Set bg3.exe to use the graphics card?" }));
    expect(sheet.getByText("Graphics for bg3.exe, from its next start")).toBeTruthy();
    expect(sheet.getByText("Let Windows decide")).toBeTruthy();
    expect(sheet.getByText("High performance")).toBeTruthy();
    fireEvent.click(sheet.getByRole("button", { name: "Make this change" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Set bg3\.exe/ })).toBeNull(), { timeout: 5000 });

    // Checked again, the game is set: it moves the next time it starts.
    fireEvent.click(await screen.findByRole("button", { name: "Slow or loud? Check now" }));
    const again = within(await screen.findByRole("list", { name: "What Rig found" }));
    expect(await again.findByText("Reopen it")).toBeTruthy();
    expect(again.queryByRole("button", { name: "Review change" })).toBeNull();
  });
});
