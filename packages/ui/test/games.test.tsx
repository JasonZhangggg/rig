// The Games page reads what was played from recorded history, opens a game
// for its sessions and notes, and says so plainly when nothing was played.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { noteText } = await import("../src/pages/games/words");
const { headroomWords } = await import("../src/pages/games/Library");

async function openGames(client = new DemoClient()) {
  location.hash = "games";
  render(<RigApp client={client} />);
  return client;
}

describe("Games", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); });
  afterEach(() => cleanup());

  it("lists the week's games most played first and opens one", async () => {
    await openGames();
    const list = await screen.findByRole("list", { name: "Games" });
    const rows = within(list).getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const hours = rows.map((r) => Number(r.querySelector(".gm-hours .num")!.textContent!.replace(/[^\d.]/g, "")));
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByText("Most played this month");
    const cyberpunk = within(await screen.findByRole("list", { name: "Games" })).getAllByRole("button").find((r) => r.textContent!.includes("Cyberpunk 2077"))!;
    expect(within(cyberpunk).getByText("settings to try")).toBeTruthy();
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
    await screen.findByRole("list", { name: "Games" });
    expect(screen.queryByText(/settings to try/i)).toBeNull();
  });

  it("says every game ran cool when none came near the limit, and points to settings to try", async () => {
    const client = new DemoClient();
    const start = Date.now() - 2 * 864e5;
    client.history = async () => Array.from({ length: 12 }, (_, i) => ({ t: start + i * 5 * 6e4, cpu: 55, gpu: 60, busy: true, game: "Cyberpunk 2077" }));
    await openGames(client);
    const lead = await screen.findByRole("region", { name: "Every game ran cool this week" });
    expect(within(lead).getByText(/peaked at 60°C in Cyberpunk 2077/)).toBeTruthy();
    expect(within(lead).getByText(/from 78 to 96 fps/)).toBeTruthy();
    fireEvent.click(within(lead).getByRole("button", { name: "See settings for Cyberpunk 2077" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Cyberpunk 2077" })).toBeTruthy();
  });

  it("leads with the game that came closest to the limit", async () => {
    const client = new DemoClient();
    const start = Date.now() - 2 * 864e5;
    const at = (i: number, gpu: number, game: string) => ({ t: start + i * 5 * 6e4, cpu: 55, gpu, busy: true, game });
    client.history = async () => [...Array.from({ length: 12 }, (_, i) => at(i, 60, "Quiet Game")), ...Array.from({ length: 12 }, (_, i) => at(100 + i, i === 6 ? 200 : 70, "Loud Game"))];
    await openGames(client);
    const lead = await screen.findByRole("region", { name: "Loud Game ran over the safe limit" });
    expect(within(lead).getByText(/slowed itself down/)).toBeTruthy();
    fireEvent.click(within(lead).getByRole("button", { name: "See Loud Game" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Loud Game" })).toBeTruthy();
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

  it("writes differences as differences in °F", () => {
    expect(noteText({ kind: "hotter", by: 13 }, "gpu", "f")).toBe("Runs 23°F hotter than your other games.");
    expect(noteText({ kind: "hotter", by: 13 }, "gpu")).toBe("Runs 13°C hotter than your other games.");
    expect(headroomWords(6, "f")).toBe("11° under the limit");
    expect(headroomWords(-3, "f")).toBe("5° over the limit");
  });

  it("shows the games in °F once picked", async () => {
    localStorage.setItem("rig.tempUnit", "f");
    await openGames();
    await screen.findByRole("list", { name: "Games" });
    await waitFor(() => expect(screen.getByRole("main").textContent).toMatch(/\d+°F/));
    expect(screen.getByRole("main").textContent).not.toMatch(/°C/);
  });
});
