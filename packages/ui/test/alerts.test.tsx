// Alerts in Things to look at, and the switches that turn each kind off on this device.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAlerts, type Alert, type PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

vi.mock("../src/scene", () => ({ createScene: () => new Proxy({}, { get: () => () => {} }) }));
vi.mock("../src/styles/index.css", () => ({}));

const { RigApp } = await import("../src/App");
const { NotificationSettings } = await import("../src/components/NotificationSettings");
const { setAlertKind } = await import("../src/state");

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const full: Alert = { id: "drive-full:C:", kind: "drive-full", part: "ssd", severity: "warn", title: "Drive C: is nearly full", detail: "40 GB free of 1.9 TB.", since: hoursAgo(1), covers: ["vol-C:"] };
const hot: Alert = { id: "too-hot:gpu", kind: "too-hot", part: "gpu", severity: "bad", title: "Graphics card is staying at its 88°C limit", detail: "It's at 89°C.", since: hoursAgo(2), ask: "My graphics card has been at 89°C for a while. What should I do?" };

/** The demo, with these alerts and issues on every reading of the PC on screen. */
function demoWith(alerts: Alert[], issues?: (pc: PC) => PC["issues"]) {
  const client = new DemoClient();
  const watch = client.watch.bind(client);
  client.watch = (id, cb) => watch(id, (pc) => cb({ ...pc, alerts, issues: issues ? issues(pc) : pc.issues }));
  return client;
}

/** The demo with only these alerts, its summary counted the way the PC counts it. */
function demoCounting(alerts: Alert[]) {
  const client = new DemoClient();
  const watch = client.watch.bind(client);
  client.watch = (id, cb) => watch(id, (pc) => cb(withAlerts({ ...pc, alerts: undefined, issues: (pc.issues ?? []).filter((i) => i.severity === "ok") }, alerts)));
  return client;
}

const todo = async () => within((await screen.findByText("Things to look at")).closest("section")!);
const rows = async () => within((await todo()).getByRole("list")).getAllByRole("button").map((b) => b.querySelector("b")!.textContent);

describe("alerts in Things to look at", () => {
  beforeEach(() => { location.hash = ""; localStorage.clear(); window.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {}; });
  afterEach(() => cleanup());

  it("shows the demo desktop's graphics card running hotter than it used to", async () => {
    render(<RigApp client={new DemoClient()} />);
    const list = await todo();
    expect(await list.findByText("Graphics card runs hotter than it used to")).toBeTruthy();
    expect(list.getByText(/^Since .+\. In .+ it's been at \d+°C lately/)).toBeTruthy();
  });

  it("puts the most severe first and leaves out the issues an alert already covers", async () => {
    render(<RigApp client={demoWith([full, hot], (pc) => [
      { id: "vol-C:", severity: "warn", title: "Drive C: is almost full", body: "", action: "", go: "chat" },
      ...(pc.issues ?? []).filter((i) => i.severity !== "ok"),
    ])} />);
    await (await todo()).findByText(hot.title);
    const titles = await rows();
    expect(titles.slice(0, 2)).toEqual([hot.title, full.title]);
    expect(titles).not.toContain("Drive C: is almost full");
  });

  it("takes the place of 'Nothing needs a look'", async () => {
    render(<RigApp client={demoWith([full], () => [{ id: "all-good", severity: "ok", title: "Nothing needs a look", body: "", action: "", go: "chat" }])} />);
    await (await todo()).findByText(full.title);
    expect(await rows()).toEqual([full.title]);
  });

  it("asks Rig about an alert when it's opened", async () => {
    render(<RigApp client={demoWith([hot])} />);
    fireEvent.click(await (await todo()).findByText(hot.title));
    expect(await screen.findByText(hot.ask!)).toBeTruthy();
  });

  it("shows an alert's temperatures in °F once picked, and asks in °F", async () => {
    localStorage.setItem("rig.tempUnit", "f");
    render(<RigApp client={demoWith([hot])} />);
    const list = await todo();
    expect(await list.findByText("Graphics card is staying at its 190°F limit")).toBeTruthy();
    expect(list.getByText(/It's at 192°F\.$/)).toBeTruthy();
    expect(list.queryByText(/°C/)).toBeNull();
    fireEvent.click(list.getByText("Graphics card is staying at its 190°F limit"));
    expect(await screen.findByText("My graphics card has been at 192°F for a while. What should I do?")).toBeTruthy();
  });

  it("counts only the kinds left on in Home's status line", async () => {
    render(<RigApp client={demoCounting([full, hot])} />);
    await (await todo()).findByText(hot.title);
    const health = within(screen.getByRole("heading", { level: 1 }).closest("header")!);
    expect(health.getByText(/2 things need a look\./)).toBeTruthy();
    await act(async () => { setAlertKind("too-hot", false); });
    await waitFor(() => expect(health.getByText(/One thing needs a look\./)).toBeTruthy());
    await act(async () => { setAlertKind("drive-full", false); });
    await waitFor(() => expect(health.getByText(/Nothing needs a look\./)).toBeTruthy());
  });

  it("hides a kind that was turned off on this device", async () => {
    render(<><RigApp client={demoWith([full, hot])} /><NotificationSettings /></>);
    await (await todo()).findByText(hot.title);
    const sw = screen.getByRole("switch", { name: /A part stays at its safe limit/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await act(async () => { fireEvent.click(sw); });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect((await todo()).queryByText(hot.title)).toBeNull();
    expect((await todo()).getByText(full.title)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("rig.alerts.off")!)).toEqual(["too-hot"]);
  });
});

describe("NotificationSettings", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it("lists every kind, on until turned off, and remembers the choice", () => {
    const { unmount } = render(<NotificationSettings />);
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(5);
    expect(switches.every((s) => s.getAttribute("aria-checked") === "true")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: /A drive is nearly full/ }));
    unmount();
    render(<NotificationSettings desktop />);
    expect(screen.getByRole("switch", { name: /A drive is nearly full/ }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/Windows notification when one starts while Rig's window isn't in front/)).toBeTruthy();
  });

  it("turns everything back on when the saved choice is damaged", () => {
    localStorage.setItem("rig.alerts.off", "{not json");
    render(<NotificationSettings />);
    expect(screen.getAllByRole("switch").every((s) => s.getAttribute("aria-checked") === "true")).toBe(true);
  });
});
