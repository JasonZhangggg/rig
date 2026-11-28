import { describe, expect, it } from "vitest";
import { CloudClient, LocalClient, MemoryStore, linkSpeed, networkAnswer, wifiGeneration, type HelperLink, type NetworkCheckState, type NetworkReading, type PingResult } from "../src";
import { DemoClient, SimulatedLink, demoNetwork, fixtures } from "../src/demo";

const at = new Date("2026-11-28T20:00:00").getTime();
const ping = (target: string, received: number, avgMs: number | null, sent = 5): PingResult => ({ target, sent, received, avgMs });

/** A good Wi-Fi connection, changed by `over`. */
function wifi(over: Partial<NetworkReading> = {}, signal = 82): NetworkReading {
  return {
    at,
    adapter: { kind: "wifi", name: "Wi-Fi", description: "Intel(R) Wi-Fi 6 AX201", linkMbps: 866, driverDate: "2025-03-01", driverVersion: "23.110.0.5" },
    wifi: { signal, band: "5 GHz", channel: 36, radio: "802.11ax" },
    gateway: ping("192.168.1.1", 5, 4),
    internet: ping("1.1.1.1", 5, 18),
    dns: { name: "www.microsoft.com", ms: 24 },
    vpn: null,
    ...over,
  };
}

function wired(over: Partial<NetworkReading> = {}): NetworkReading {
  return {
    at,
    adapter: { kind: "ethernet", name: "Ethernet", description: "Realtek PCIe GbE Family Controller", linkMbps: 1000, driverDate: "2025-01-10" },
    gateway: ping("192.168.0.1", 5, 1),
    internet: ping("1.1.1.1", 5, 12),
    dns: { name: "www.microsoft.com", ms: 20 },
    vpn: null,
    ...over,
  };
}

const ids = (r: NetworkReading) => networkAnswer(r).findings.map((f) => f.id);

describe("the connection check's answer", () => {
  it("says the PC's side is fine when everything answers quickly", () => {
    const a = networkAnswer(wifi());
    expect(a.verdict).toBe("fine");
    expect(a.headline).toBe("Your PC's connection is fine; any slowness is past your router");
    expect(a.sub).toBe("Wi-Fi is strong (82%), your router answers in 4 ms and the internet in 18 ms. A slow website or your internet provider is the more likely cause.");
    expect(a.findings).toEqual([]);
    expect(a.facts.map((f) => [f.label, f.value, f.sub, f.look])).toEqual([
      ["Wi-Fi", "82%", "5 GHz · Wi-Fi 6", false],
      ["Router", "4 ms", "None lost", false],
      ["Internet", "18 ms", "None lost", false],
      ["Lookups", "24 ms", "Website names", false],
    ]);
  });

  it("says so over a cable too, with the link speed", () => {
    const a = networkAnswer(wired());
    expect(a.verdict).toBe("fine");
    expect(a.sub).toBe("Over the cable, your router answers in 1 ms and the internet in 12 ms. A slow website or your internet provider is the more likely cause.");
    expect(a.facts[0]).toEqual({ label: "Cable", value: "1 Gbps", sub: "Link speed", look: false });
  });

  it("blames a weak Wi-Fi signal, with what to do and a question for Rig", () => {
    const a = networkAnswer(wifi({ wifi: { signal: 32, band: "2.4 GHz", channel: 6, radio: "802.11n" } }, 32));
    expect(a.verdict).toBe("wifi");
    expect(a.headline).toBe("The Wi-Fi signal is weak (32%), which is the likely cause");
    const [weak, band] = a.findings;
    expect(weak).toMatchObject({ id: "wifi-weak", title: "Wi-Fi signal is weak: 32%", next: "Move closer to the router, or clear what's between them", ask: "My Wi-Fi signal is only 32%. How can I make it stronger?" });
    expect(band).toMatchObject({ id: "band", title: "Connected on 2.4 GHz", next: "Use your router's 5 GHz network if it has one" });
    expect(a.facts[0]).toMatchObject({ value: "32%", sub: "2.4 GHz · Wi-Fi 4", look: true });
  });

  it("blames a fair signal when the router answers badly over it", () => {
    const a = networkAnswer(wifi({ wifi: { signal: 52, band: "5 GHz" }, gateway: ping("192.168.1.1", 3, 85) }, 52));
    expect(a.verdict).toBe("wifi");
    expect(a.sub).toBe("Your router lost 2 of 5 pings, which a weak signal explains.");
    expect(a.findings.map((f) => f.id)).toEqual(["router"]);
    expect(a.findings[0].next).toBe("A stronger signal should fix this");
  });

  it("blames the router when it loses pings over a good link", () => {
    const a = networkAnswer(wired({ gateway: ping("192.168.0.1", 3, 2) }));
    expect(a.verdict).toBe("router");
    expect(a.headline).toBe("Your router isn't answering reliably: 40% of pings lost");
    expect(a.findings[0]).toMatchObject({ id: "router", title: "Router lost 2 of 5 pings", next: "Restart the router: unplug it for 30 seconds" });
    expect(a.facts.find((f) => f.label === "Router")).toMatchObject({ sub: "2 of 5 lost", look: true });
  });

  it("blames a router that's slow to answer over a cable", () => {
    const a = networkAnswer(wired({ gateway: ping("192.168.0.1", 5, 45) }));
    expect(a.verdict).toBe("router");
    expect(a.headline).toBe("Your router is slow to answer: 45 ms");
  });

  it("doesn't count one lost ping of five as a problem", () => {
    expect(networkAnswer(wired({ gateway: ping("192.168.0.1", 4, 1), internet: ping("1.1.1.1", 4, 12) })).verdict).toBe("fine");
  });

  it("puts the trouble past the router when only the internet loses pings", () => {
    const a = networkAnswer(wifi({ internet: ping("1.1.1.1", 2, 40) }));
    expect(a.verdict).toBe("internet");
    expect(a.headline).toBe("Your PC's connection is fine; the slowness is past your router");
    expect(a.sub).toBe("Your router answers, but 60% of pings to the internet were lost.");
    expect(a.findings[0]).toMatchObject({ id: "internet", title: "Lost 3 of 5 pings past the router", next: "Restart the router and modem, then call your provider if it stays" });
  });

  it("puts a slow internet past the router too", () => {
    const a = networkAnswer(wired({ internet: ping("1.1.1.1", 5, 240) }));
    expect(a.verdict).toBe("internet");
    expect(a.findings[0].title).toBe("The internet answers in 240 ms");
  });

  it("says when website lookups are slow but the connection is fine", () => {
    const a = networkAnswer(wired({ dns: { name: "www.microsoft.com", ms: 850 } }));
    expect(a.verdict).toBe("dns");
    expect(a.headline).toBe("Looking up websites is slow: 850 ms");
    expect(a.findings[0]).toMatchObject({ id: "dns", title: "Website lookups take 850 ms", ask: "Website lookups (DNS) take 850 ms on my PC. Should I change my DNS server?" });
    expect(a.facts.at(-1)).toMatchObject({ label: "Lookups", value: "850 ms", look: true });
  });

  it("says when website lookups fail", () => {
    const a = networkAnswer(wired({ dns: { name: "www.microsoft.com", ms: null } }));
    expect(a.verdict).toBe("dns");
    expect(a.headline).toBe("Looking up websites isn't working");
    expect(a.facts.at(-1)).toMatchObject({ value: "Failed", look: true });
  });

  it("blames the VPN when it's on and the internet is slow but steady", () => {
    const a = networkAnswer(wired({ internet: ping("1.1.1.1", 5, 180), vpn: { name: "NordLynx" } }));
    expect(a.verdict).toBe("vpn");
    expect(a.headline).toBe("Your VPN adds the delay: the internet answers in 180 ms");
    expect(a.findings[0]).toMatchObject({ id: "vpn", title: "A VPN is on: NordLynx", next: "Turn it off for a moment, then check again" });
  });

  it("mentions a VPN that's on when nothing else is wrong", () => {
    const a = networkAnswer(wifi({ vpn: { name: "WireGuard Tunnel" } }));
    expect(a.verdict).toBe("fine");
    expect(ids(wifi({ vpn: { name: "WireGuard Tunnel" } }))).toEqual(["vpn"]);
  });

  it("doesn't blame a router that never answers pings when the internet does", () => {
    const a = networkAnswer(wired({ gateway: ping("192.168.0.1", 0, null) }));
    expect(a.verdict).toBe("fine");
    expect(a.facts.find((f) => f.label === "Router")).toMatchObject({ value: "—", sub: "Doesn't answer pings", look: false });
  });

  it("doesn't blame the internet when pings are blocked but lookups work", () => {
    const a = networkAnswer(wired({ internet: ping("1.1.1.1", 0, null) }));
    expect(a.verdict).toBe("fine");
    expect(a.facts.find((f) => f.label === "Internet")).toMatchObject({ sub: "Pings blocked", look: false });
  });

  it("says when the router answers but nothing past it does", () => {
    const a = networkAnswer(wired({ internet: ping("1.1.1.1", 0, null), dns: { name: "www.microsoft.com", ms: null } }));
    expect(a.verdict).toBe("internet");
    expect(a.sub).toBe("Your router answers, but nothing on the internet does.");
    expect(a.findings[0].title).toBe("The internet isn't answering");
  });

  it("says when nothing past the PC answers", () => {
    const a = networkAnswer(wired({ gateway: ping("192.168.0.1", 0, null), internet: ping("1.1.1.1", 0, null), dns: { name: "www.microsoft.com", ms: null } }));
    expect(a.verdict).toBe("router");
    expect(a.headline).toBe("This PC can't reach your router or the internet");
    expect(a.findings[0].id).toBe("unreachable");
  });

  it("says when the PC isn't connected at all", () => {
    const a = networkAnswer({ at, adapter: null, gateway: null, internet: ping("1.1.1.1", 0, null), dns: { name: "www.microsoft.com", ms: null }, vpn: null });
    expect(a.verdict).toBe("offline");
    expect(a.headline).toBe("This PC isn't connected to a network");
    expect(a.findings).toHaveLength(1);
  });

  it("names a slow cable link, and an old driver when the link is the problem", () => {
    expect(networkAnswer(wired({ adapter: { kind: "ethernet", name: "Ethernet", linkMbps: 100 } })).findings[0]).toMatchObject({ id: "cable", title: "The cable connects at 100 Mbps" });
    const old = wired({ adapter: { kind: "ethernet", name: "Ethernet", description: "Realtek PCIe GbE", linkMbps: 1000, driverDate: "2019-05-02", driverVersion: "10.35" }, gateway: ping("192.168.0.1", 2, 3) });
    expect(networkAnswer(old).findings.map((f) => f.title)).toEqual(["Router lost 3 of 5 pings", "Network driver is from 2019"]);
    // An old driver on a link that's fine isn't worth a finding.
    expect(ids(wired({ adapter: { kind: "ethernet", name: "Ethernet", linkMbps: 1000, driverDate: "2019-05-02" } }))).toEqual([]);
  });

  it("shows at most three findings, the cause first", () => {
    const r = wifi({
      adapter: { kind: "wifi", name: "Wi-Fi", linkMbps: 54, driverDate: "2018-01-01" },
      wifi: { signal: 20, band: "2.4 GHz", channel: 11 }, gateway: ping("192.168.1.1", 2, 120), vpn: { name: "NordLynx" },
    }, 20);
    expect(ids(r)).toEqual(["wifi-weak", "router", "band"]);
  });

  it("reads the helper's reply, which leaves out what's null, and says under 1 ms for a router on a cable", () => {
    const reply = JSON.parse('{"at":1795825473355,"adapter":{"kind":"ethernet","name":"Ethernet","description":"Intel(R) Ethernet Controller I225-V","linkMbps":1000},"gateway":{"target":"192.168.0.1","sent":5,"received":5,"avgMs":0},"internet":{"target":"1.1.1.1","sent":5,"received":0},"dns":{"name":"www.microsoft.com"}}') as NetworkReading;
    const a = networkAnswer(reply);
    expect(a.verdict).toBe("internet");
    expect(a.sub).toBe("Your router answers, but nothing on the internet does.");
    expect(a.facts.find((f) => f.label === "Router")?.value).toBe("<1 ms");
    expect(networkAnswer(wired({ gateway: ping("192.168.0.1", 5, 0) })).sub).toMatch(/^Over the cable, your router answers in under 1 ms and the internet in 12 ms\./);
  });

  it("names radios and link speeds the way they're sold", () => {
    expect(wifiGeneration("802.11ax")).toBe("Wi-Fi 6");
    expect(wifiGeneration("802.11be")).toBe("Wi-Fi 7");
    expect(wifiGeneration("802.11ac")).toBe("Wi-Fi 5");
    expect(wifiGeneration(undefined)).toBeUndefined();
    expect(linkSpeed(2500)).toBe("2.5 Gbps");
    expect(linkSpeed(1000)).toBe("1 Gbps");
    expect(linkSpeed(100)).toBe("100 Mbps");
  });
});

describe("the connection check on each client", () => {
  it("the demo finds Pebble's Wi-Fi weak and Atlas fine", async () => {
    DemoClient.pace = 0;
    const demo = new DemoClient();
    const pebble = await demo.checkNetwork("demo-pebble");
    const atlas = await demo.checkNetwork("demo-atlas");
    if (pebble.kind !== "done" || atlas.kind !== "done") throw new Error("the demo should check");
    expect(networkAnswer(pebble.reading).headline).toBe("The Wi-Fi signal is weak (34%), which is the likely cause");
    expect(networkAnswer(pebble.reading).findings.map((f) => f.id)).toEqual(["wifi-weak", "band", "driver"]);
    expect(networkAnswer(atlas.reading).verdict).toBe("fine");
    expect(await demo.checkNetwork("demo-den")).toEqual({ kind: "unsupported", reason: "elsewhere" });
  });

  it("the website says it runs from the Rig app on that PC", async () => {
    const cloud = new CloudClient({ base: "https://example.invalid" });
    expect(await cloud.checkNetwork("pc-1")).toEqual({ kind: "unsupported", reason: "elsewhere" });
  });

  function local(network?: HelperLink["network"]) {
    const sim = new SimulatedLink(fixtures.pebble.inv, fixtures.pebble.facts, { now: () => at });
    const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c), ...(network && { network }) };
    return new LocalClient(link, new MemoryStore(), null, { tickMs: 1e9, syncEveryMs: 1e9, now: () => at });
  }

  it("the desktop starts the helper's check and waits for it to finish", async () => {
    const calls: boolean[] = [];
    let polls = 0;
    const reading = demoNetwork(fixtures.pebble.inv, at);
    const client = local(async (start): Promise<NetworkCheckState> => {
      calls.push(start);
      if (start) return { running: true };
      return ++polls < 2 ? { running: true } : { running: false, reading };
    });
    const reply = await client.checkNetwork(fixtures.pebble.inv.machine.id);
    client.stop();
    expect(reply).toEqual({ kind: "done", reading });
    expect(calls).toEqual([true, false, false]);
  });

  it("the desktop asks for an update when the helper doesn't know the check, and sends other PCs to their own app", async () => {
    const client = local();
    expect(await client.checkNetwork(fixtures.pebble.inv.machine.id)).toEqual({ kind: "unsupported", reason: "update" });
    expect(await client.checkNetwork("someone-else")).toEqual({ kind: "unsupported", reason: "elsewhere" });
    client.stop();
  });
});
