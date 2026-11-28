// The storage map on My PC: each drive split by what fills it, with its health, and what Windows doesn't say.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("counts each drive's free space in the games on it, and offers one game to move to the roomier drive", async () => {
    await openStorage();
    expect(screen.getByText("Room for about 4 more big games")).toBeTruthy();
    expect(screen.getByText("726 GB free: 4 installs the size of Baldur's Gate 3 (148 GB), with 134 GB to spare.")).toBeTruthy();
    expect(screen.getByText("Room for about 8 more big games")).toBeTruthy();
    // Only C: has a roomier drive to move to.
    const move = within(screen.getByRole("list", { name: "Move one thing to D:" }));
    expect(move.getByText("Move Baldur's Gate 3 to D:")).toBeTruthy();
    expect(move.getByText("148 GB · most likely loads slower from a hard drive")).toBeTruthy();
    expect(move.getByText("+1")).toBeTruthy();
    fireEvent.click(move.getByRole("button", { name: "Details: Baldur's Gate 3" }));
    expect(move.getByText(/Move it from the launcher it came from/)).toBeTruthy();
    expect(screen.queryAllByRole("list", { name: /^Move one thing to/ })).toHaveLength(1);
  });
});

describe("Free up space", () => {
  it("lists what's safe to clear under the drives, with what each frees and the steps behind Details", async () => {
    await openStorage();
    const section = within((await screen.findByRole("heading", { name: "Free up space" })).closest("section")!);
    expect(await section.findByText("You could free about 38 GB")).toBeTruthy();
    expect(section.getByText(/Games you haven't played and old downloads hold 321 GB more\./)).toBeTruthy();
    const safe = within(section.getByRole("list", { name: "Safe to clear" }));
    expect(safe.getAllByRole("listitem").map((li) => li.querySelector(".row-title")?.textContent)).toEqual([
      "Previous version of Windows", "Temporary files", "Windows Update files", "Delivery Optimization files", "Recycle Bin", "Crash reports", "Picture previews", "Let Windows clear these by itself",
    ]);
    expect(safe.getByText("18 GB")).toBeTruthy();
    fireEvent.click(safe.getByRole("button", { name: "Details: Previous version of Windows" }));
    expect(safe.getByText(/you can't go back to the previous version of Windows/)).toBeTruthy();
    const how = within(safe.getByRole("list", { name: "How to clear Previous version of Windows" }));
    expect(how.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Open Settings, then go to System > Storage > Temporary files.", "Tick Previous Windows installation(s), then choose Remove files.",
    ]);
  });

  it("lists games not played in months as uninstalls from their launcher, never as files to delete", async () => {
    await openStorage();
    const look = within(await screen.findByRole("list", { name: "Look first" }));
    expect(look.getAllByRole("listitem").map((li) => li.querySelector(".row-title")?.textContent)).toEqual(["Microsoft Flight Simulator", "Red Dead Redemption 2", "Old downloads"]);
    expect(look.getByText("Last played 7 months ago")).toBeTruthy();
    expect(look.getByText("121 GB")).toBeTruthy();
    fireEvent.click(look.getByRole("button", { name: "Details: Red Dead Redemption 2" }));
    expect(within(look.getByRole("list", { name: "How to uninstall Red Dead Redemption 2" })).getByText(/choose Uninstall/)).toBeTruthy();
    expect(look.getAllByText(/rather than deleting its folder/).length).toBeGreaterThan(0);
  });

  it("turns on Storage Sense only through its own card: read first, applied once approved, and in Changes after", async () => {
    const client = await openStorage();
    const before = (await client.changes("demo-atlas")).length;
    fireEvent.click(await screen.findByRole("button", { name: "Turn on…" }));
    const review = await screen.findByRole("button", { name: "Review" });
    // Nothing has changed yet: the card shows what's there now and waits.
    expect(await client.changes("demo-atlas")).toHaveLength(before);
    fireEvent.click(review);
    const apply = screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement;
    await waitFor(() => expect(apply.disabled).toBe(false));
    fireEvent.click(apply);
    expect(await screen.findByText("Storage Sense is on")).toBeTruthy();
    const made = await client.changes("demo-atlas");
    expect(made).toHaveLength(before + 1);
    expect(made[0]).toMatchObject({ by: "you", status: "applied" });
    expect(screen.getByRole("button", { name: /Undo/ })).toBeTruthy();
  });

  it("says where it works on the website, and offers to ask instead", async () => {
    const client = new DemoClient();
    (client as { cleanupSizes?: unknown }).cleanupSizes = undefined;
    await openStorage(client);
    expect(await screen.findByText("Rig sees what's safe to clear only in the Rig app on Atlas.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask Rig" })).toBeTruthy();
  });
});
