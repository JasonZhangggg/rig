// The startup apps list: opened from Home's finding or Ctrl K, switches only draft, and the review sheet makes the change.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Step } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; DemoClient.pace = 0; });
afterEach(() => cleanup());

const offAll = (names: string[]) => names.map((name) => ({ kind: "fix", call: { kind: "startup.app", name, enabled: false } }));

async function openFromHome(client = new DemoClient()) {
  render(<RigApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: /8 apps start with Windows/ }));
  const dialog = await screen.findByRole("dialog", { name: "Startup apps" });
  return { client, dialog: within(dialog) };
}

describe("Startup apps", () => {
  it("opens from Home's finding with a switch for every app, and nothing to review yet", async () => {
    const { dialog } = await openFromHome();
    expect(dialog.getByText(/8 of 9 start with Windows/)).toBeTruthy();
    const switches = dialog.getAllByRole("switch");
    expect(switches).toHaveLength(9);
    expect(dialog.getByRole("switch", { name: "Steam" }).getAttribute("aria-checked")).toBe("true");
    expect(dialog.getByRole("switch", { name: "NVIDIA Broadcast" }).getAttribute("aria-checked")).toBe("false");
    expect(dialog.getAllByText("Game store and launcher · Fine to turn off")).toHaveLength(2);
    expect(dialog.getByText("Keeps your files backed up to OneDrive · Best left on")).toBeTruthy();
    expect(dialog.getByText("Chat and meetings for work or school")).toBeTruthy();
    expect(dialog.getByText(/Nothing changes until you approve the review/)).toBeTruthy();
    expect((dialog.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reviews only the switches you flipped, and changes nothing until you approve", async () => {
    const client = new DemoClient();
    const preview = vi.spyOn(client, "preview");
    const apply = vi.spyOn(client, "apply");
    const { dialog } = await openFromHome(client);
    fireEvent.click(dialog.getByRole("switch", { name: "Steam" }));
    fireEvent.click(dialog.getByRole("switch", { name: "NVIDIA Broadcast" }));
    expect(dialog.getByRole("switch", { name: "Steam" }).getAttribute("aria-checked")).toBe("false");
    expect(dialog.getByText("Game store and launcher · Off after review")).toBeTruthy();
    // Flipping one back drops it from the review.
    fireEvent.click(dialog.getByRole("switch", { name: "Discord" }));
    fireEvent.click(dialog.getByRole("switch", { name: "Discord" }));
    fireEvent.click(dialog.getByRole("button", { name: "Review 2 changes" }));

    const sheet = await screen.findByRole("dialog", { name: "Changed 2 startup apps?" });
    expect(preview).toHaveBeenLastCalledWith("demo-atlas", [
      { kind: "fix", call: { kind: "startup.app", name: "Steam", enabled: false } },
      { kind: "fix", call: { kind: "startup.app", name: "NVIDIA Broadcast", enabled: true } },
    ]);
    expect(within(sheet).getByText("Steam")).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();

    // Cancel goes back to the list with the picks kept.
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));
    const list = within(await screen.findByRole("dialog", { name: "Startup apps" }));
    expect(list.getByRole("switch", { name: "Steam" }).getAttribute("aria-checked")).toBe("false");
    expect(apply).not.toHaveBeenCalled();
  });

  it("sets every app Rig suggests turning off at once, then turns them off once approved", async () => {
    const client = new DemoClient();
    const apply = vi.spyOn(client, "apply");
    const { dialog } = await openFromHome(client);
    fireEvent.click(dialog.getByRole("button", { name: "Turn off the 5 Rig suggests" }));
    const names = ["Steam", "Discord", "Spotify", "Epic Games Launcher", "Adobe Creative Cloud"];
    for (const n of names) expect(dialog.getByRole("switch", { name: n }).getAttribute("aria-checked")).toBe("false");
    for (const n of ["Microsoft Teams", "OneDrive", "Logitech G HUB"]) expect(dialog.getByRole("switch", { name: n }).getAttribute("aria-checked")).toBe("true");
    expect(dialog.queryByRole("button", { name: /Rig suggests/ })).toBeNull();

    fireEvent.click(dialog.getByRole("button", { name: "Review 5 changes" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Turned off 5 startup apps?" }));
    fireEvent.click(sheet.getByRole("button", { name: "Make 5 changes" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0][1] as Step[]).toEqual(offAll(names));
    expect(apply.mock.calls[0][2]).toMatchObject({ by: "you" });

    const list = within(await screen.findByRole("dialog", { name: "Startup apps" }));
    await waitFor(() => expect(list.getAllByText("Game store and launcher · Turned off")).toHaveLength(2));
    expect(list.getByText(/3 of 9 start with Windows/)).toBeTruthy();
    expect((list.getByRole("button", { name: "Review changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens from Ctrl K", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.click(screen.getByRole("button", { name: /Search or ask/ }));
    const palette = within(screen.getByRole("dialog", { name: "Search" }));
    fireEvent.change(palette.getByRole("textbox", { name: "Search" }), { target: { value: "startup" } });
    fireEvent.click(palette.getByRole("button", { name: /^Startup apps/ }));
    expect(await screen.findByRole("dialog", { name: "Startup apps" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("asks Rig about them from the list", async () => {
    const { dialog } = await openFromHome();
    fireEvent.click(dialog.getByRole("button", { name: "Ask Rig about these" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Startup apps" })).toBeNull());
    expect(location.hash).toBe("#chat");
    expect(await screen.findByText("Which of my startup apps can I safely turn off?")).toBeTruthy();
  });

  it("is read-only where the PC can't be changed from, like the website", async () => {
    const client = new DemoClient();
    Object.assign(client, { caps: { local: false, applyChanges: false } });
    const { dialog } = await openFromHome(client);
    for (const s of dialog.getAllByRole("switch")) expect((s as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.queryByRole("button", { name: /^Review/ })).toBeNull();
    expect(dialog.queryByRole("button", { name: /Rig suggests/ })).toBeNull();
    expect(dialog.getByText("Startup apps are changed from the Rig app on Atlas.")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog", { name: "Startup apps" })).toBeNull();
  });
});
