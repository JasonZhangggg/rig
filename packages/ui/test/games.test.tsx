// The Games page reads what was played from recorded history, opens a game
// for its sessions and notes, and says so plainly when nothing was played.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { noteText } = await import("../src/pages/games/words");
const { headroomWords, sortGames } = await import("../src/pages/games/Library");

async function openGames(client = new DemoClient()) {
  location.hash = "games";
  render(<RigApp client={client} />);
  return client;
}

describe("Games", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); });
  afterEach(() => cleanup());

  it("is a tab of Logs, marked as the one open", async () => {
    await openGames();
    await screen.findByRole("list", { name: "Games" });
    const tabs = screen.getByRole("navigation", { name: "Logs" });
    expect(within(tabs).getByRole("link", { name: "Games" }).getAttribute("aria-current")).toBe("page");
    expect(within(tabs).getByRole("link", { name: "Readings" }).getAttribute("aria-current")).toBeNull();
  });

  it("lists the week's games most played first and opens one", async () => {
    await openGames();
    const list = await screen.findByRole("list", { name: "Games" });
    const rows = within(list).getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const hours = rows.map((r) => Number(r.querySelector(".gm-hours .num")!.textContent!.replace(/[^\d.]/g, "")));
    expect([...hours].sort((a, b) => b - a)).toEqual(hours);
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);

    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByText("Games this month");
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

  it("sorts the list by most played, hottest or most recent, and still opens a game", async () => {
    await openGames();
    const sort = await screen.findByRole("group", { name: "Sort games" });
    const peaks = () => within(screen.getByRole("list", { name: "Games" })).getAllByRole("button")
      .map((r) => Number(r.querySelector(".gm-temp .faint")!.textContent!.match(/Peak (\d+)/)![1]));
    expect(within(sort).getByRole("button", { name: "Most played" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(sort).getByRole("button", { name: "Hottest" }));
    expect(within(sort).getByRole("button", { name: "Hottest" }).getAttribute("aria-pressed")).toBe("true");
    expect([...peaks()].sort((a, b) => b - a)).toEqual(peaks());
    fireEvent.click(within(sort).getByRole("button", { name: "Recent" }));
    const first = within(screen.getByRole("list", { name: "Games" })).getAllByRole("button")[0];
    const name = first.querySelector(".gm-title b")!.textContent!;
    fireEvent.click(first);
    expect(await screen.findByRole("heading", { level: 1, name })).toBeTruthy();
  });

  it("orders recent games by when they were last played", () => {
    const g = (name: string, lastPlayed: number, peak: number | null, hours = 1) => ({ name, lastPlayed, peak, hours }) as Parameters<typeof sortGames>[0][number];
    const games = [g("A", 1, 70, 3), g("B", 3, null, 2), g("C", 2, 80, 1)];
    expect(sortGames(games, "played").map((x) => x.name)).toEqual(["A", "B", "C"]);
    expect(sortGames(games, "recent").map((x) => x.name)).toEqual(["B", "C", "A"]);
    expect(sortGames(games, "hot").map((x) => x.name)).toEqual(["C", "A", "B"]);
  });

  it("holds the chart's readout at the peak of the session picked", async () => {
    await openGames();
    const row = within(await screen.findByRole("list", { name: "Games" })).getAllByRole("button")[0];
    fireEvent.click(row);
    const sessions = await screen.findByRole("list", { name: "Sessions" });
    const live = () => screen.getByRole("region", { name: "Sessions chart" }).querySelector("[aria-live]")!.textContent!;
    let charted = 0;
    for (const button of within(sessions).getAllByRole("button")) {
      fireEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      const peak = button.textContent!.match(/peak (\d+°C)/)![1];
      if (!screen.getByRole("region", { name: "Sessions chart" }).querySelector("svg.chart")) continue;
      expect(live()).toMatch(new RegExp(`Graphics card ${peak}`));
      charted++;
    }
    expect(charted).toBeGreaterThan(1);
  });

  it("shows each session as ten-minute squares and says the card gets hot sooner as dust builds up", async () => {
    await openGames();
    fireEvent.click(await screen.findByRole("button", { name: "Month" }));
    await screen.findByText("Games this month");
    fireEvent.click(within(await screen.findByRole("list", { name: "Games" })).getAllByRole("button").find((r) => r.textContent!.includes("Cyberpunk 2077"))!);
    const heat = await screen.findByRole("region", { name: "When it got hot" });
    expect(within(heat).getByRole("heading", { name: "Cyberpunk 2077 gets hot sooner" })).toBeTruthy();
    expect(within(heat).getByText("Getting worse")).toBeTruthy();
    expect(heat.textContent).toMatch(/now gets hot about \d+ minutes in\. (Two|Three|Four|Five) weeks earlier it (took about|stayed under)/);
    expect(heat.textContent).toMatch(/most likely cooling less well/);

    // One row per session, oldest first, each with its squares; the latest is the one on the chart.
    const rows = within(within(heat).getByRole("list", { name: "Sessions" })).getAllByRole("button");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows[rows.length - 1].getAttribute("aria-pressed")).toBe("true");
    const after = rows.map((r) => r.textContent!.match(/Hot after (?:(\d+) h)? ?(?:(\d+) min)?|Never hot/)!).map((m) => (m[0] === "Never hot" ? Infinity : Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)));
    expect(after[after.length - 1]).toBeLessThan(after[0]);
    for (const r of rows) expect(r.querySelectorAll(".hq").length).toBeGreaterThan(6);
    expect(rows[rows.length - 1].querySelector(".hq-hot")).toBeTruthy();
    expect(rows[rows.length - 1].querySelector(".hq")!.classList.contains("hq-hot")).toBe(false);

    // What to do comes from the readings, and asks Rig how.
    const todo = within(heat).getByRole("list", { name: "What to do" });
    expect(within(todo).getByText("Clean the dust filters")).toBeTruthy();
    fireEvent.click(within(todo).getByRole("button", { name: "How" }));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(location.hash).toBe("#chat");
    expect(await screen.findByText(/Cyberpunk 2077 gets my graphics card hot sooner than it did/)).toBeTruthy();
  });

  it("says the card stayed cool, with no advice, for a game that never got near the limit", async () => {
    await openGames();
    fireEvent.click(await screen.findByRole("button", { name: "Month" }));
    await screen.findByText("Games this month");
    fireEvent.click(within(await screen.findByRole("list", { name: "Games" })).getAllByRole("button").find((r) => r.textContent!.includes("Baldur's Gate 3"))!);
    const heat = await screen.findByRole("region", { name: "When it got hot" });
    expect(within(heat).getByRole("heading", { name: "The graphics card stayed cool" })).toBeTruthy();
    expect(within(heat).queryByRole("list", { name: "What to do" })).toBeNull();
    expect(within(heat).getByRole("list", { name: "Sessions" }).querySelector(".hq-hot")).toBeNull();
  });

  it("shows no tuning for games without measurements", async () => {
    const client = new DemoClient();
    client.games = async () => [];
    await openGames(client);
    await screen.findByRole("list", { name: "Games" });
    expect(screen.queryByText(/settings to try/i)).toBeNull();
  });

  it("marks a cool game with no limit chip, and its settings to try", async () => {
    const client = new DemoClient();
    const start = Date.now() - 2 * 864e5;
    client.history = async () => Array.from({ length: 12 }, (_, i) => ({ t: start + i * 5 * 6e4, cpu: 55, gpu: 60, busy: true, game: "Cyberpunk 2077" }));
    await openGames(client);
    const first = within(await screen.findByRole("list", { name: "Games" })).getAllByRole("button")[0];
    expect(first.textContent).toMatch(/Cyberpunk 2077/);
    expect(within(first).queryByText(/^(Near|Over) the limit$/)).toBeNull();
    expect(within(first).getByText("settings to try")).toBeTruthy();
    fireEvent.click(first);
    expect(await screen.findByRole("heading", { level: 1, name: "Cyberpunk 2077" })).toBeTruthy();
  });

  it("flags the game that went over the limit in the list, with its figures when opened", async () => {
    const client = new DemoClient();
    const start = Date.now() - 2 * 864e5;
    const at = (i: number, gpu: number, game: string) => ({ t: start + i * 5 * 6e4, cpu: 55, gpu, busy: true, game });
    client.history = async () => [...Array.from({ length: 12 }, (_, i) => at(i, 60, "Quiet Game")), ...Array.from({ length: 12 }, (_, i) => at(100 + i, i === 6 ? 200 : 70, "Loud Game"))];
    await openGames(client);
    const loud = within(await screen.findByRole("list", { name: "Games" })).getAllByRole("button").find((r) => r.textContent!.includes("Loud Game"))!;
    expect(within(loud).getByText("Over the limit")).toBeTruthy();
    fireEvent.click(loud);
    expect(await screen.findByRole("heading", { level: 1, name: "Loud Game" })).toBeTruthy();
    const figures = screen.getByRole("group", { name: "Key figures" });
    expect(within(figures).getByText("Hottest moment").parentElement!.textContent).toMatch(/over the limit\./);
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
