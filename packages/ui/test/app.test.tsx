// Smoke test: every screen renders on the demo PCs, and a change can be
// reviewed, made and undone. The 3D scene needs WebGL, so it's stubbed; picking
// a part still reports the pick back like the real scene does.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: (_el: HTMLElement, { onSelect }: { onSelect: (id: string | null) => void }) =>
    new Proxy({}, { get: (_t, key) => (key === "select" ? onSelect : () => {}) }),
}));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

describe("Rig app on demo data", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; });
  afterEach(() => cleanup());

  it("renders every screen", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    const pages: [string, RegExp][] = [
      ["pc", /Quick switches/i],
      ["chat", /How fixes work/i],
      ["changes", /Changes/i],
      ["upgrades", /Upgrades|upgrade/i],
      ["games", /Games|game/i],
      ["history", /temperature|History/i],
      ["web", /Your PCs/i],
    ];
    for (const [route, text] of pages) {
      await open(route);
      expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    }
  });

  it("keeps the account at the bottom of the sidebar", async () => {
    render(<RigApp client={new DemoClient()} />);
    const side = await screen.findByRole("complementary", { name: "Main" });
    const account = await within(side).findByRole("button", { name: /^Account, You/ });
    const controls = side.querySelectorAll("a, button");
    expect(controls[controls.length - 1]).toBe(account);
    fireEvent.click(account);
    expect(within(side).getByText("demo@rig.app")).toBeTruthy();
    expect(within(side).getByRole("menuitem", { name: "All your PCs" })).toBeTruthy();
  });

  it("logs a dust clean from the cooling part", async () => {
    render(<RigApp client={new DemoClient()} />);
    await open("pc");
    fireEvent.click(await screen.findByRole("button", { name: /Cooling/ }));
    fireEvent.click(await screen.findByRole("button", { name: "I cleaned it today" }));
    await screen.findByText(/Cleaned today/);
    expect(screen.queryByRole("button", { name: "I cleaned it today" })).toBeNull();
  });

  it("reviews a change before making it, then undoes it", async () => {
    const client = new DemoClient();
    const apply = vi.spyOn(client, "apply");
    render(<RigApp client={client} />);
    await open("pc");
    const sw = await screen.findByRole("switch", { name: /Game Mode/i });
    const before = sw.getAttribute("aria-checked");
    fireEvent.click(sw);

    const sheet = await screen.findByRole("dialog");
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole("button", { name: /Turn (on|off)/i }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("switch", { name: /Game Mode/i }).getAttribute("aria-checked")).not.toBe(before));

    await open("changes");
    const main = await screen.findByRole("main");
    // Newest change first: the one just made.
    fireEvent.click((await within(main).findAllByRole("button", { name: /^Undo$/i }))[0]);
    await within(main).findByRole("button", { name: /^Redo$/i });
    await open("pc");
    await waitFor(() => expect(screen.getByRole("switch", { name: /Game Mode/i }).getAttribute("aria-checked")).toBe(before));
  });
});

describe("Desktop sign-in on the website", () => {
  afterEach(() => { cleanup(); history.replaceState(null, "", "/"); });

  it("asks before signing a PC in, then sends the approval", async () => {
    history.replaceState(null, "", "/app/?user_code=W4XKLL2V");
    const client = new DemoClient();
    const approve = vi.fn(async () => {});
    Object.assign(client, { approveDevice: approve, account: async () => ({ id: "u1", name: "Jo", email: "jo@example.com" }) });
    render(<RigApp client={client} requireAccount />);
    expect(await screen.findByText("W4XKLL2V")).toBeTruthy();
    expect(screen.getByText("jo@example.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in on that PC" }));
    await screen.findByText("Your PC is signed in");
    expect(approve).toHaveBeenCalledWith("W4XKLL2V", true);
  });
});
