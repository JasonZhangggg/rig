// The storage map on My PC: each drive split by what fills it, with its health, and what Windows doesn't say.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function openStorage(client = new DemoClient()) {
  location.hash = "pc";
  render(<RigApp client={client} />);
  await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
  fireEvent.click(await screen.findByRole("button", { name: /Storage/ }));
  return client;
}

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
afterEach(() => cleanup());

describe("Storage map", () => {
  it("opens the storage part on its drives, Windows' drive first", async () => {
    await openStorage();
    expect(screen.getByRole("tab", { name: "Drives", selected: true })).toBeTruthy();
    const drives = within(screen.getByRole("list", { name: "Drives" })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(drives).toEqual(["Samsung SSD 990 PRO 2TB", "ST4000DM004-2U9104"]);
    expect(screen.getByText(/Folders measured 3 hours ago/)).toBeTruthy();
  });

  it("splits each drive by what fills it, naming the biggest things", async () => {
    await openStorage();
    const c = within(screen.getByRole("list", { name: "What fills Samsung SSD 990 PRO 2TB" }));
    expect(c.getAllByRole("listitem").map((li) => li.querySelector(".sm-fill-name")?.textContent)).toEqual(["Your files", "Games", "Apps", "Windows", "Page and sleep files", "Other"]);
    expect(c.getByText("Baldur's Gate 3, Counter-Strike 2, Rocket League")).toBeTruthy();
    expect(screen.getByRole("img", { name: /^ST4000DM004-2U9104: Games 1\.7 TB, Your files 64 GB, Other 46 GB, Free 1\.9 TB$/ })).toBeTruthy();
  });

  it("shows each drive's health beside it, and says what Windows doesn't report", async () => {
    await openStorage();
    const ssd = within(screen.getByRole("group", { name: "Health of Samsung SSD 990 PRO 2TB" }));
    expect(ssd.getByText("98%")).toBeTruthy();
    expect(ssd.getByText("14.2 TB")).toBeTruthy();
    expect(ssd.getByText("3,120 hours, about 4 months")).toBeTruthy();
    expect(screen.getAllByText("Healthy")).toHaveLength(2);
    const hdd = within(screen.getByRole("list", { name: "What Windows doesn't tell Rig about ST4000DM004-2U9104" }));
    expect(hdd.getByText("Wear: hard drives don't count it")).toBeTruthy();
  });

  it("measures again in the background, and says so while it runs", async () => {
    await openStorage();
    fireEvent.click(screen.getByRole("button", { name: "Measure again" }));
    expect(await screen.findByText(/Measuring folders now/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Measuring…" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
