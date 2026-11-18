// Settings: reached from the account menu and Ctrl K, temperatures in the
// chosen unit everywhere, the data download, account deletion and starting
// with Windows.
import rootPackage from "../../../package.json";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataExport } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");

async function open(route: string) {
  await act(async () => { location.hash = route; window.dispatchEvent(new HashChangeEvent("hashchange")); });
}

describe("Settings", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("opens from the account menu and shows the demo account, without deleting it", async () => {
    render(<RigApp client={new DemoClient()} />);
    const side = await screen.findByRole("complementary", { name: "Main" });
    fireEvent.click(await within(side).findByRole("button", { name: /^Account, You/ }));
    fireEvent.click(within(side).getByRole("menuitem", { name: "Settings" }));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const main = await screen.findByRole("main");
    expect(await within(main).findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(within(main).getByText("demo@rig.app")).toBeTruthy();
    expect(within(main).getByText(/demo account, so it can't be deleted/)).toBeTruthy();
    expect((within(main).getByRole("button", { name: "Delete account" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(main).queryByRole("switch", { name: /Start Rig with Windows/ })).toBeNull();
  });

  it("is found by Ctrl K search", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "fahrenheit" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Units/ }));
    await waitFor(() => expect(location.hash).toBe("#settings"));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    expect(await screen.findByRole("group", { name: "Temperatures" })).toBeTruthy();
  });

  it("shows temperatures in °F everywhere once picked, and remembers it", async () => {
    const { unmount } = render(<RigApp client={new DemoClient()} />);
    await open("settings");
    fireEvent.click(within(await screen.findByRole("group", { name: "Temperatures" })).getByRole("button", { name: "°F" }));
    expect(localStorage.getItem("rig.tempUnit")).toBe("f");

    await open("pc");
    const main = await screen.findByRole("main");
    await waitFor(() => expect(main.textContent).toMatch(/\d+°F/));
    expect(main.textContent).not.toMatch(/°C/);
    await open("history");
    await waitFor(() => expect(screen.getByRole("main").textContent).toMatch(/°F limit/));
    expect(screen.getByRole("main").textContent).not.toMatch(/°C/);
    await open("overview");
    await screen.findByText(/Each day, °F/);

    unmount();
    render(<RigApp client={new DemoClient()} />);
    await open("settings");
    expect(within(await screen.findByRole("group", { name: "Temperatures" })).getByRole("button", { name: "°F" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("has a Notifications section with a switch for each kind of alert, found by searching for alerts", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "alerts" } });
    fireEvent.click(await screen.findByRole("button", { name: /^Notifications/ }));
    await waitFor(() => expect(location.hash).toBe("#settings"));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const section = within(await screen.findByRole("region", { name: "Notifications" }));
    expect(section.getAllByRole("switch")).toHaveLength(6);
    expect(section.getByText(/The Rig app on each PC can also send a Windows notification/)).toBeTruthy();
    fireEvent.click(section.getByRole("switch", { name: /A drive is nearly full/ }));
    expect(JSON.parse(localStorage.getItem("rig.alerts.off")!)).toEqual(["drive-full"]);
    const recording = section.getByRole("switch", { name: "A recording finished" });
    expect(recording.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(recording);
    expect(localStorage.getItem("rig.notify.recordingDone")).toBe("off");
    expect(recording.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("navigation", { name: /settings/i }).textContent).toContain("Notifications");
  });

  it("downloads the account's data as a JSON file", async () => {
    let saved: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => { saved = b; return "blob:rig"; });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<RigApp client={new DemoClient()} />);
    await open("settings");
    const data = await screen.findByRole("region", { name: "Your data" });
    expect(within(data).queryByRole("button", { name: "Download my data" })).toBeNull();
    fireEvent.click(within(data).getByRole("button", { name: /^Your data/ }));
    fireEvent.click(within(data).getByRole("button", { name: "Download my data" }));
    await screen.findByText(/^Saved rig-data-\d{4}-\d{2}-\d{2}\.json\.$/);
    expect(click).toHaveBeenCalledTimes(1);
    const text = await new Promise<string>((done) => { const r = new FileReader(); r.onload = () => done(r.result as string); r.readAsText(saved!); });
    const out = JSON.parse(text) as DataExport;
    expect(out.format).toBe("rig-export/1");
    expect(out.machines.map((m) => m.name)).toEqual(["Atlas", "Pebble"]);
    expect(out.machines[0].history.length).toBeGreaterThan(100);
    expect(out.machines[0].recordings[0].samples.length).toBeGreaterThan(10);
    expect(out.machines[0].events.length).toBeGreaterThan(0);
  });

  it("deletes an account only after DELETE is typed", async () => {
    const client = new DemoClient();
    const deleteAccount = vi.fn(async () => {});
    Object.assign(client, { kind: "web", deleteAccount, account: async () => ({ id: "u1", name: "Jo", email: "jo@example.com" }) });
    render(<RigApp client={client} />);
    await open("settings");
    fireEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
    const box = screen.getByRole("group", { name: "Delete your account?" });
    expect(within(box).getByText(/All 3 PCs on it, with their recorded history/)).toBeTruthy();
    const go = within(box).getByRole("button", { name: "Delete my account" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    const input = within(box).getByLabelText("Type DELETE to confirm");
    fireEvent.change(input, { target: { value: "delete" } });
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(deleteAccount).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "DELETE" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(location.hash).toBe("#signin"));
  });

  it("says nothing was removed when deleting fails", async () => {
    const client = new DemoClient();
    Object.assign(client, { kind: "web", deleteAccount: async () => { throw new Error("The server didn't answer."); } });
    render(<RigApp client={client} />);
    await open("settings");
    fireEvent.click(await screen.findByRole("button", { name: "Delete account…" }));
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Rig couldn't delete the account. The server didn't answer. Nothing was removed.");
  });

  it("turns starting with Windows on in the desktop app", async () => {
    const set = vi.fn(async () => {});
    render(<RigApp client={new DemoClient()} host={{ autostart: { get: async () => false, set } }} />);
    await open("settings");
    const sw = await screen.findByRole("switch", { name: /Start Rig with Windows/ });
    await waitFor(() => expect((sw as HTMLButtonElement).disabled).toBe(false));
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(set).toHaveBeenCalledWith(true);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
  });

  it("shows the version from the root package.json, and on desktop the server it signs in to", async () => {
    const { version } = rootPackage;
    const { unmount } = render(<RigApp client={new DemoClient()} />);
    await open("settings");
    const about = await screen.findByRole("region", { name: "About" });
    fireEvent.click(within(about).getByRole("button", { name: /^About/ }));
    expect(within(about).getByText(`Rig ${version}`)).toBeTruthy();
    expect(within(about).queryByText("Server")).toBeNull();
    unmount();

    render(<RigApp client={new DemoClient()} host={{ server: "https://rig.example.com/api" }} />);
    await open("settings");
    const folded = await screen.findByRole("region", { name: "About" });
    fireEvent.click(within(folded).getByRole("button", { name: /^About/ }));
    expect(within(folded).getByText("Signs in and syncs with https://rig.example.com/api")).toBeTruthy();
  });

  it("finds the version in Ctrl K search", async () => {
    render(<RigApp client={new DemoClient()} />);
    await screen.findByText(/Things to look at/i);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(await screen.findByRole("textbox", { name: "Search" }), { target: { value: "version" } });
    fireEvent.click(await screen.findByRole("button", { name: /^About/ }));
    await waitFor(() => expect(location.hash).toBe("#settings"));
    await act(async () => { window.dispatchEvent(new HashChangeEvent("hashchange")); });
    const about = await screen.findByRole("region", { name: "About" });
    expect(within(about).getByRole("button", { name: /^About/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(about).getByText(/^Rig \d/)).toBeTruthy();
  });

  it("puts the settings people change most first and folds the rarely needed ones", async () => {
    render(<RigApp client={new DemoClient()} />);
    await open("settings");
    await screen.findByRole("region", { name: "Appearance" });
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles.slice(0, 4)).toEqual(["Appearance", "Units", "Notifications", "Account"]);
    for (const name of ["Your data", "About"]) {
      const fold = within(screen.getByRole("region", { name }));
      expect(fold.getByRole("button", { name: new RegExp(`^${name}`) }).getAttribute("aria-expanded")).toBe("false");
    }
    fireEvent.click(within(screen.getByRole("navigation", { name: /settings/i })).getByRole("button", { name: "About" }));
    expect(within(screen.getByRole("region", { name: "About" })).getByText(/^Rig \d/)).toBeTruthy();
  });
});
