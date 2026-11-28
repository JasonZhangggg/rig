// A website account with no PC yet: the screen says how to add one, and the PC shows up without a reload once its app signs in.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

const jo = { id: "u1", name: "Jo", email: "jo@example.com" };

/** The website's client for an account whose PC hasn't signed in yet. `arrive()` is that PC's app signing in. */
class NewAccount extends DemoClient {
  override readonly kind = "web" as never;
  here = false;
  override account() { return Promise.resolve(jo); }
  override async machines(): Promise<PC[]> { return this.here ? super.machines() : []; }
  arrive() { this.here = true; }
}

describe("no PCs yet", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("links to the download and names the account to sign in with", async () => {
    render(<RigApp client={new NewAccount()} requireAccount />);
    expect(await screen.findByText("No PCs yet.")).toBeTruthy();
    expect(screen.getByText(/sign in there as jo@example\.com\. It shows up here on its own\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download Rig for Windows" }).getAttribute("href")).toBe("/");
  });

  it("shows the PC once its app signs in, with no reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const client = new NewAccount();
    render(<RigApp client={client} requireAccount />);
    await screen.findByText("No PCs yet.");
    client.arrive();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    await vi.waitFor(() => expect(screen.queryByText("No PCs yet.")).toBeNull());
  });

  it("lets someone signed in to the wrong account switch", async () => {
    const client = new NewAccount();
    const signOut = vi.spyOn(client, "signOut").mockResolvedValue();
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
    render(<RigApp client={client} requireAccount />);
    fireEvent.click(await screen.findByRole("button", { name: "Use another account" }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(signOut).toHaveBeenCalledOnce();
  });
});
