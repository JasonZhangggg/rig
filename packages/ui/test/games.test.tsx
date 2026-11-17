// The Games page reads what was played from recorded history, opens a game
// for its sessions and notes, and says so plainly when nothing was played.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function openGames(client = new DemoClient()) {
  location.hash = "games";
  render(<RigApp client={client} />);
  return client;
}

describe("Games", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("lists the week's games most played first and opens one", async () => {
    await openGames();
    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const hours = rows.map((r) => Number(r.querySelector(".gm-hours .num")!.textContent!.replace(/[^\d.]/g, "")));
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByText("Most played this month");
    const cyberpunk = within(await screen.findByRole("list")).getAllByRole("button").find((r) => r.textContent!.includes("Cyberpunk 2077"))!;
    expect(within(cyberpunk).getByText("Settings to try")).toBeTruthy();
    fireEvent.click(cyberpunk);
    expect(await screen.findByRole("heading", { level: 1, name: "Cyberpunk 2077" })).toBeTruthy();
    expect(screen.getByText("What Rig noticed")).toBeTruthy();
    expect(screen.getByText(/hotter than your other games/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Sessions" })).toBeTruthy();
    expect(screen.getByText("Sample numbers in the demo", { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ask about this game" }));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(location.hash).toBe("#chat");
    expect(await screen.findByText(/How can I make Cyberpunk 2077 run better and cooler/)).toBeTruthy();
  });

  it("shows no tuning for games without measurements", async () => {
    const client = new DemoClient();
    client.games = async () => [];
    await openGames(client);
    await screen.findByRole("list");
    expect(screen.queryByText("Settings to try")).toBeNull();
  });

  it("says no games are recorded yet on a PC without history", async () => {
    const client = new DemoClient();
    client.history = async () => [];
    await openGames(client);
    expect(await screen.findByText("No games recorded yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show the month" })).toBeNull();
  });

  it("offers the month when nothing was played this week", async () => {
    const client = new DemoClient();
    const t = Date.now() - 36e5;
    client.history = async () => [{ t, cpu: 45, gpu: 38, busy: false, game: null }];
    await openGames(client);
    expect(await screen.findByText("No games this week")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show the month" })).toBeTruthy();
  });
});
