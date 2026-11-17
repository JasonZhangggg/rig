// Smoke test: every screen renders on the demo PCs, and a change can be
// reviewed, made and undone. The 3D scene needs WebGL, so it's stubbed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({
  createScene: () => new Proxy({}, { get: () => () => {} }),
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
    await screen.findByText(/need help\?/i);
    const pages: [string, RegExp][] = [
      ["pc", /Customize|Exploded|Live/i],
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
    const { container } = render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/need help\?/i);
    const bottom = container.querySelector(".fp-bottom");
    expect(bottom).not.toBeNull();
    expect(bottom!.querySelector(".fp-account")).not.toBeNull();
    expect(bottom!.nextElementSibling).toBeNull();
  });

  it("reviews a change before making it, then undoes it", async () => {
    const client = new DemoClient();
    const apply = vi.spyOn(client, "apply");
    render(<RigApp client={client} />);
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
    await open("overview");
    await waitFor(() => expect(screen.getByRole("switch", { name: /Game Mode/i }).getAttribute("aria-checked")).toBe(before));
  });
});
