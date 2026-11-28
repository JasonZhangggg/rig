// "Can it run a game?": the game's requirements, read from its store page, against the parts Rig read.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { canRunGame } = await import("../src/components/Palette");

const openFromGames = async (client = new DemoClient()) => {
  location.hash = "#games";
  render(<RigApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Can it run a game?" }));
  return within(screen.getByRole("dialog", { name: /./ }));
};
const check = async (dialog: ReturnType<typeof within>, game: string) => {
  fireEvent.change(dialog.getByRole("searchbox", { name: "Game" }), { target: { value: game } });
  const button = dialog.getByRole("button", { name: "Check" }) as HTMLButtonElement;
  // Enabled once Rig has the PC's parts.
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
};

describe("can it run a game", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("compares the desktop with a game's recommended specs, part by part, and says where they came from", async () => {
    const dialog = await openFromGames();
    expect(dialog.getByRole("heading", { name: "Which game should Rig check on Atlas?" })).toBeTruthy();
    await check(dialog, "Forza Horizon 5");
    expect(await dialog.findByRole("heading", { name: "Atlas runs Forza Horizon 5 well" }, { timeout: 3000 })).toBeTruthy();
    const rows = within(dialog.getByRole("list", { name: "How Atlas compares" }));
    expect(rows.getByText("RTX 4070 SUPER")).toBeTruthy();
    expect(rows.getByText("1,914 GB free on D:")).toBeTruthy();
    expect(rows.queryByText("Holds it back")).toBeNull();
    fireEvent.click(rows.getByRole("button", { name: "Details: Graphics card" }));
    expect(rows.getByText("NVidia GTX 1070, AMD RX 590, OR Intel Arc A750")).toBeTruthy();
    expect(dialog.getByRole("link", { name: "Steam store page" }).getAttribute("href")).toBe("https://store.steampowered.com/app/1551360/Forza_Horizon_5/");
    expect(dialog.getByText(/A sample read for the demo/)).toBeTruthy();
  });

  it("names the part that holds the laptop back, and says when it's below the minimum", async () => {
    localStorage.setItem("rig.pc", "demo-pebble");
    const dialog = await openFromGames();
    await check(dialog, "fh5");
    expect(await dialog.findByRole("heading", { name: "Pebble runs Forza Horizon 5 at low settings" }, { timeout: 3000 })).toBeTruthy();
    expect(dialog.getByText("Its graphics are below what the game recommends.")).toBeTruthy();
    expect(dialog.getByText("Holds it back")).toBeTruthy();
    // The laptop's graphics are part of its processor: nothing to buy.
    expect(dialog.queryByRole("button", { name: "See upgrades" })).toBeNull();

    await check(dialog, "Microsoft Flight Simulator 2024");
    expect(await dialog.findByRole("heading", { name: "Pebble is below Microsoft Flight Simulator 2024's minimum" }, { timeout: 3000 })).toBeTruthy();
  });

  it("points to Upgrades for the part holding a desktop back", async () => {
    const client = new DemoClient();
    const shop = client.shop.bind(client);
    client.shop = async (id) => {
      const s = await shop(id);
      return s && { ...s, facts: { ...s.facts, gpu: { ...s.facts.gpu!, name: "NVIDIA GeForce GTX 1050 Ti", short: "GTX 1050 Ti", vramGb: 4 } } };
    };
    const dialog = await openFromGames(client);
    await check(dialog, "Forza Horizon 5");
    expect(await dialog.findByRole("heading", { name: "Atlas is below Forza Horizon 5's minimum" }, { timeout: 3000 })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "See upgrades" }));
    await waitFor(() => expect(location.hash).toBe("#upgrades"));
    expect(screen.queryByRole("dialog", { name: /Forza/ })).toBeNull();
  });

  it("says plainly when it couldn't find a game, or can't look from here", async () => {
    const dialog = await openFromGames();
    await check(dialog, "Some Other Game");
    expect(await dialog.findByText(/The demo has requirements for Forza Horizon 5/, undefined, { timeout: 3000 })).toBeTruthy();
    cleanup();

    const none = new DemoClient();
    none.gameRequirements = async () => null;
    const d2 = await openFromGames(none);
    await check(d2, "Nothing Game");
    expect(await d2.findByRole("heading", { name: "Rig couldn't find Nothing Game's requirements" })).toBeTruthy();
    fireEvent.click(d2.getByRole("button", { name: "Ask Rig" }));
    expect(await screen.findByText("Can Atlas run Nothing Game? What settings should I use?")).toBeTruthy();
    cleanup();

    const offline = new DemoClient();
    (offline as { gameRequirements?: unknown }).gameRequirements = undefined;
    const d3 = await openFromGames(offline);
    await check(d3, "Forza Horizon 5");
    expect(await d3.findByText("Rig can't look up games from here. Ask Rig instead.")).toBeTruthy();
  });

  it("opens from Ctrl K with the game typed there", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByRole("button", { name: "Slow or loud? Check now" });
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "can it run cs2" } });
    fireEvent.click(screen.getByRole("button", { name: /Can Atlas run cs2\?/ }));
    expect(await screen.findByRole("heading", { name: "Atlas meets Counter-Strike 2's minimum" }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("The page lists only a minimum, so Rig can't say how high the settings can go.")).toBeTruthy();
  });

  it("reads the game out of what's typed in Ctrl K", () => {
    expect(canRunGame("can it run Elden Ring?")).toBe("Elden Ring");
    expect(canRunGame("can my pc run forza horizon 5")).toBe("forza horizon 5");
    expect(canRunGame("requirements for Starfield")).toBe("Starfield");
    expect(canRunGame("cyberpunk 2077 system requirements")).toBe("cyberpunk 2077");
    expect(canRunGame("cpu temperature")).toBeNull();
  });
});
