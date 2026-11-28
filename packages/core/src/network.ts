// "Is it my PC or my internet?": a check the person starts, which reads this PC's network adapter and Wi-Fi and pings
// the router and the internet from the PC itself (helper/RigHelper/Network.cs), and the plain answer Rig makes of it.
// It only reads: nothing on the PC or the router changes.
import type { PC } from "./model";
import { machineWord } from "./machineWord";

/** Five pings to one place: how many came back and how long they took on average. */
export interface PingResult {
  /** What was pinged, like "192.168.1.1" or "1.1.1.1". */
  target: string;
  sent: number;
  received: number;
  /** The average of the pings that came back, in milliseconds. Null when none did. */
  avgMs: number | null;
}

export type NetworkKind = "wifi" | "ethernet" | "other";

/** What the helper's `network` read found. Missing fields are ones Windows didn't say; the helper leaves nulls out, so read them loosely (`== null`). */
export interface NetworkReading {
  /** When it was read, in milliseconds. */
  at: number;
  /** The adapter that carries the PC's traffic: the one with the default route. Null when nothing is connected. */
  adapter: {
    kind: NetworkKind;
    /** Windows' name for the connection, like "Wi-Fi" or "Ethernet 2". */
    name: string;
    /** The adapter itself, like "Intel(R) Wi-Fi 6 AX201 160MHz". */
    description?: string;
    /** The speed the link was made at, in megabits a second. */
    linkMbps?: number;
    /** The driver's date as the driver gives it, YYYY-MM-DD. */
    driverDate?: string;
    driverVersion?: string;
  } | null;
  /** Only on Wi-Fi. */
  wifi?: {
    /** Windows' signal quality, 0 to 100. */
    signal: number;
    band?: "2.4 GHz" | "5 GHz" | "6 GHz";
    channel?: number;
    /** "802.11ax" and the like. */
    radio?: string;
  };
  /** The router (the default gateway). Null when the PC has none. */
  gateway: PingResult | null;
  /** A well-known address on the internet. */
  internet: PingResult;
  /** How long looking up a well-known website's address took, skipping Windows' cache. Null ms: the lookup failed. */
  dns: { name: string; ms: number | null };
  /** A VPN adapter that's connected, by its name. Null when none is. */
  vpn: { name: string } | null;
}

/** What the helper answers: whether a check is still running, and the last one it finished. */
export interface NetworkCheckState {
  running: boolean;
  reading?: NetworkReading;
}

/** The check's reply to the screens: a reading, or why it can't run from here. */
export type NetworkCheckReply =
  | { kind: "done"; reading: NetworkReading }
  /** elsewhere: it has to run from the Rig app on that PC. update: this PC's helper is too old to know the check. */
  | { kind: "unsupported"; reason: "elsewhere" | "update" };

/** What the answer blames: nothing on this PC, the Wi-Fi, the router, past the router, the VPN, the lookups, or no connection. */
export type NetworkVerdict = "fine" | "wifi" | "router" | "internet" | "vpn" | "dns" | "offline";

export interface NetworkFinding {
  id: "wifi-weak" | "band" | "router" | "internet" | "vpn" | "dns" | "cable" | "driver" | "offline" | "unreachable";
  /** What it found, with the number that shows it. */
  title: string;
  /** What to do next, in a few words. */
  next: string;
  /** Why, in a sentence or two, for Details. */
  why: string;
  /** The question for Ask Rig, when Rig can help with the next step. */
  ask: string;
}

/** One measured figure for the summary: "Router", "48 ms", "2 of 5 lost". */
export interface NetworkFact { label: string; value: string; sub: string; look: boolean }

export interface NetworkAnswer {
  verdict: NetworkVerdict;
  headline: string;
  /** One or two sentences under the headline. */
  sub: string;
  /** At most three, most likely cause first. */
  findings: NetworkFinding[];
  facts: NetworkFact[];
}

/** Below this Wi-Fi signal (Windows' 0 to 100) the signal alone makes things slow. */
export const WEAK_SIGNAL = 40;
/** Below this, a signal is only fair: it's the likely cause when the router answers badly too. */
export const FAIR_SIGNAL = 60;
/** A share of lost pings, in percent, that counts as unreliable. One lost of five (20%) happens; two (40%) is a problem. */
export const LOSS_BAD = 30;
/** How long a router may take to answer before it counts as slow, over a cable and over Wi-Fi. */
export const ROUTER_SLOW_MS = { wired: 30, wifi: 60 };
/** How long the internet may take to answer before it counts as slow. */
export const INTERNET_SLOW_MS = 120;
/** How long a website lookup may take before it counts as slow. */
export const DNS_SLOW_MS = 300;
/** A network driver older than this many years is worth updating when the link is the problem. */
export const OLD_DRIVER_YEARS = 3;

export const lossPct = (p: PingResult) => (p.sent > 0 ? Math.round(((p.sent - p.received) / p.sent) * 100) : 0);
const lost = (p: PingResult) => p.sent - p.received;
/** Pings to a router over a cable often come back in under a millisecond, which Windows reports as 0. */
const ms = (n: number) => (n < 0.5 ? "under 1 ms" : `${Math.round(n)} ms`);
const figureMs = (n: number) => (n < 0.5 ? "<1 ms" : `${Math.round(n)} ms`);
const none = (p: PingResult | null) => !p || p.sent === 0 || p.received === 0;

/** "Wi-Fi 6" from "802.11ax", so the radio reads the way routers are sold. */
export function wifiGeneration(radio?: string): string | undefined {
  const m = radio?.toLowerCase().match(/802\.11\s*(be|ax|ac|n|g|a|b)\b/);
  if (!m) return undefined;
  return { be: "Wi-Fi 7", ax: "Wi-Fi 6", ac: "Wi-Fi 5", n: "Wi-Fi 4", g: "802.11g", a: "802.11a", b: "802.11b" }[m[1]];
}

/** "1 Gbps", "100 Mbps", "2.5 Gbps". */
export function linkSpeed(mbps: number): string {
  if (mbps >= 1000) { const g = mbps / 1000; return `${Number.isInteger(g) ? g : g.toFixed(1)} Gbps`; }
  return `${Math.round(mbps)} Mbps`;
}

/** How a set of pings went, in the words of the summary: "none lost", "2 of 5 lost", "no answer". */
function pingSub(p: PingResult): string {
  if (p.received === 0) return "No answer";
  return lost(p) === 0 ? "None lost" : `${lost(p)} of ${p.sent} lost`;
}

interface Read {
  wifi: boolean;
  signal?: number;
  /** The router answered at least one ping. Routers that never answer pings are common, so no answer alone isn't a fault. */
  routerSeen: boolean;
  routerBad: boolean;
  routerLossy: boolean;
  internetSeen: boolean;
  internetBad: boolean;
  internetLossy: boolean;
  dnsFailed: boolean;
  dnsSlow: boolean;
}

function read(r: NetworkReading): Read {
  const wifi = r.adapter?.kind === "wifi";
  const g = r.gateway;
  const routerSeen = !none(g);
  const routerLossy = routerSeen && lossPct(g!) >= LOSS_BAD;
  const routerSlow = routerSeen && g!.avgMs != null && g!.avgMs > (wifi ? ROUTER_SLOW_MS.wifi : ROUTER_SLOW_MS.wired);
  const i = r.internet;
  const internetSeen = !none(i);
  const internetLossy = internetSeen && lossPct(i) >= LOSS_BAD;
  const internetSlow = internetSeen && i.avgMs != null && i.avgMs > INTERNET_SLOW_MS;
  return {
    wifi, signal: r.wifi?.signal, routerSeen, routerLossy, routerBad: routerLossy || routerSlow,
    internetSeen, internetLossy, internetBad: internetLossy || internetSlow,
    dnsFailed: r.dns.ms == null, dnsSlow: r.dns.ms != null && r.dns.ms > DNS_SLOW_MS,
  };
}

/** The year a driver was made in, from its date. */
const driverYear = (d?: string) => { const y = d ? Number(d.slice(0, 4)) : NaN; return Number.isFinite(y) && y > 1990 ? y : null; };

/**
 * Turns a reading into the answer the dialog shows: what's to blame, in one line, then at most three findings, each
 * with what shows it and what to do next. Pure, so the same reading always gets the same answer.
 */
export function networkAnswer(r: NetworkReading, kind?: PC["kind"]): NetworkAnswer {
  const w = machineWord(kind);
  const facts = networkFacts(r);
  if (!r.adapter) {
    return {
      verdict: "offline", headline: `This ${w} isn't connected to a network`, facts,
      sub: `Windows shows no connected Wi-Fi or cable, so nothing past the ${w} is being checked.`,
      findings: [{ id: "offline", title: "No network connection", next: "Plug in the cable, or pick your Wi-Fi network", why: "Windows has no network adapter with a way out to the internet right now.", ask: `My ${w} says it isn't connected to a network. What should I check?` }],
    };
  }
  const s = read(r);
  const findings: NetworkFinding[] = [];
  const signal = s.signal;
  const weak = s.wifi && signal != null && signal < WEAK_SIGNAL;
  const fair = s.wifi && signal != null && signal < FAIR_SIGNAL;
  const g = r.gateway, i = r.internet;
  const lookupsWork = !s.dnsFailed;

  // What the answer blames, most local first: a cause close to the PC explains everything past it too.
  let verdict: NetworkVerdict;
  let headline: string;
  let sub: string;
  const reachesNothing = !s.routerSeen && !s.internetSeen && !lookupsWork;
  if (reachesNothing) {
    verdict = weak ? "wifi" : "router";
    headline = weak ? `The Wi-Fi signal is too weak to reach your router (${signal}%)` : `This ${w} can't reach your router or the internet`;
    sub = weak ? `Nothing past the ${w} answered, and the signal is the likeliest reason.` : `Nothing past the ${w} answered: not the router, the internet or website lookups.`;
  } else if ((s.routerBad && fair) || weak) {
    verdict = "wifi";
    headline = `The Wi-Fi signal is weak (${signal}%), which is the likely cause`;
    sub = s.routerBad ? `Your router ${routerWords(g!)}, which a weak signal explains.` : "A weak signal slows everything down, even when the router answers.";
  } else if (s.routerBad) {
    verdict = "router";
    headline = s.routerLossy ? `Your router isn't answering reliably: ${lossPct(g!)}% of pings lost` : `Your router is slow to answer: ${ms(g!.avgMs!)}`;
    sub = s.wifi ? "The Wi-Fi signal is fine, so the router itself is struggling." : "Over a cable it should answer in a few milliseconds, every time.";
  } else if (s.internetBad && r.vpn && !s.internetLossy) {
    verdict = "vpn";
    headline = `Your VPN adds the delay: the internet answers in ${ms(i.avgMs!)}`;
    sub = `This ${w} and your router are fine. Traffic goes through ${r.vpn.name} first, which takes longer.`;
  } else if (s.internetBad || (!s.internetSeen && !lookupsWork)) {
    verdict = "internet";
    headline = `Your ${w}'s connection is fine; the slowness is past your router`;
    const near = s.routerSeen ? "Your router answers" : `This ${w} is connected`;
    sub = !s.internetSeen ? `${near}, but nothing on the internet does.` : s.internetLossy ? `${near}, but ${lossPct(i)}% of pings to the internet were lost.` : `${near}, but the internet takes ${ms(i.avgMs!)} to answer.`;
  } else if (s.dnsFailed || s.dnsSlow) {
    verdict = "dns";
    headline = s.dnsFailed ? "Looking up websites isn't working" : `Looking up websites is slow: ${ms(r.dns.ms!)}`;
    sub = "The connection itself is fine. Each new website waits on this lookup (DNS) before it starts to load.";
  } else {
    verdict = "fine";
    headline = `Your ${w}'s connection is fine; any slowness is past your router`;
    sub = fineWords(r, s);
  }

  // The findings: the cause first, then what adds to it.
  if (reachesNothing && !weak) {
    findings.push({ id: "unreachable", title: `Nothing past this ${w} answered`, next: "Restart the router: unplug it for 30 seconds", why: `The router${g ? ` (${g.target})` : ""} and the internet (${i.target}) didn't answer any pings, and website lookups failed.`, ask: `My ${w} can't reach my router or the internet. What should I try?` });
  }
  if (weak) {
    findings.push({ id: "wifi-weak", title: `Wi-Fi signal is weak: ${signal}%`, next: "Move closer to the router, or clear what's between them", why: `Windows rates the signal ${signal} out of 100. Under ${WEAK_SIGNAL}, Wi-Fi slows down and drops data. Walls, floors and metal in the way weaken it most.`, ask: `My Wi-Fi signal is only ${signal}%. How can I make it stronger?` });
  }
  if (s.routerBad && g) {
    findings.push({
      id: "router", title: s.routerLossy ? `Router lost ${lost(g)} of ${g.sent} pings` : `Router answers in ${ms(g.avgMs!)}`,
      next: verdict === "wifi" ? "A stronger signal should fix this" : "Restart the router: unplug it for 30 seconds",
      why: `Rig pinged your router (${g.target}) ${g.sent} times${g.avgMs != null ? `; the answers took ${ms(g.avgMs)} on average` : ""}. ${s.wifi ? "Over good Wi-Fi it answers in under 10 ms" : "Over a cable it answers in a few milliseconds"}, and loses none.`,
      ask: s.routerLossy ? `My router loses ${lossPct(g)}% of pings. What can I do?` : `My router takes ${ms(g.avgMs!)} to answer pings. Is that a problem?`,
    });
  }
  if (s.wifi && r.wifi?.band === "2.4 GHz" && (fair || s.routerBad)) {
    findings.push({ id: "band", title: "Connected on 2.4 GHz", next: "Use your router's 5 GHz network if it has one", why: `2.4 GHz${r.wifi.channel ? ` (channel ${r.wifi.channel})` : ""} reaches further but is slower and shared with neighbors' networks. Close to the router, 5 GHz is usually much faster.`, ask: `How do I switch my ${w} to my router's 5 GHz Wi-Fi?` });
  }
  if (s.internetBad || (verdict === "internet" && !s.internetSeen)) {
    if (verdict === "vpn" && r.vpn) {
      findings.push({ id: "vpn", title: `A VPN is on: ${r.vpn.name}`, next: "Turn it off for a moment, then check again", why: `With the VPN on, pings to the internet (${i.target}) take ${ms(i.avgMs!)}. Under ${INTERNET_SLOW_MS} ms is usual. A VPN server further away adds to every request.`, ask: "Is my VPN slowing down my internet? What can I change?" });
    } else {
      findings.push({
        id: "internet", title: !s.internetSeen ? "The internet isn't answering" : s.internetLossy ? `Lost ${lost(i)} of ${i.sent} pings past the router` : `The internet answers in ${ms(i.avgMs!)}`,
        next: "Restart the router and modem, then call your provider if it stays",
        why: `Rig pinged ${i.target} on the internet ${i.sent} times${i.avgMs != null ? `; the answers took ${ms(i.avgMs)} on average` : " and none came back"}. ${s.routerSeen && g?.avgMs != null ? `Your router answered in ${ms(g.avgMs)}, so the trouble is between it and the internet.` : `The trouble is past this ${w}'s own connection.`}`,
        ask: "My internet is slow past my router. What can I check before calling my provider?",
      });
    }
  }
  if (s.dnsFailed || s.dnsSlow) {
    if (verdict === "dns" || verdict === "fine") {
      findings.push({ id: "dns", title: s.dnsFailed ? `Couldn't look up ${r.dns.name}` : `Website lookups take ${ms(r.dns.ms!)}`, next: "Restart the router, or ask Rig about a faster DNS server", why: `Before a website loads, Windows asks a DNS server for its address. Rig asked for ${r.dns.name}${s.dnsFailed ? " and got no answer" : ` and waited ${ms(r.dns.ms!)}`}; under 100 ms is usual.`, ask: s.dnsFailed ? `Website lookups (DNS) fail on my ${w}. What should I check?` : `Website lookups (DNS) take ${ms(r.dns.ms!)} on my ${w}. Should I change my DNS server?` });
    }
  }
  if (r.vpn && verdict !== "vpn") {
    findings.push({ id: "vpn", title: `A VPN is on: ${r.vpn.name}`, next: "Turn it off for a moment, then check again", why: "Traffic goes through the VPN's server first, which can slow things down and change which servers you reach.", ask: "Is my VPN slowing down my internet?" });
  }
  if (r.adapter.kind === "ethernet" && r.adapter.linkMbps != null && r.adapter.linkMbps < 1000) {
    findings.push({ id: "cable", title: `The cable connects at ${linkSpeed(r.adapter.linkMbps)}`, next: "Try another cable or router port", why: "Most cables and ports connect at 1 Gbps or faster. A slower link usually means a worn cable, an old one, or a loose plug.", ask: `My network cable only connects at ${linkSpeed(r.adapter.linkMbps)}. How do I fix that?` });
  }
  const year = driverYear(r.adapter.driverDate);
  if (year != null && new Date(r.at).getFullYear() - year >= OLD_DRIVER_YEARS && (verdict === "wifi" || verdict === "router")) {
    findings.push({ id: "driver", title: `Network driver is from ${year}`, next: "Update the network driver", why: `${r.adapter.description ?? "The adapter"} runs a driver${r.adapter.driverVersion ? ` (${r.adapter.driverVersion})` : ""} from ${year}. Newer drivers often fix dropouts and slow links.`, ask: `How do I update the network driver on my ${w}? It's from ${year}.` });
  }
  return { verdict, headline, sub, findings: findings.slice(0, 3), facts };
}

function routerWords(g: PingResult) {
  return lossPct(g) >= LOSS_BAD ? `lost ${lost(g)} of ${g.sent} pings` : `took ${ms(g.avgMs!)} to answer`;
}

function fineWords(r: NetworkReading, s: Read) {
  const router = s.routerSeen && r.gateway?.avgMs != null ? `your router answers in ${ms(r.gateway.avgMs)}` : null;
  const net = s.internetSeen && r.internet.avgMs != null ? `the internet ${router ? "in" : "answers in"} ${ms(r.internet.avgMs)}` : null;
  const said = [router, net].filter(Boolean).join(" and ");
  const lead = s.wifi && s.signal != null ? `Wi-Fi is ${s.signal >= 75 ? "strong" : "good"} (${s.signal}%)${said ? `, ${said}` : ""}.`
    : r.adapter?.kind === "ethernet" ? (said ? `Over the cable, ${said}.` : "The cable is connected.")
    : said ? `${said.charAt(0).toUpperCase()}${said.slice(1)}.` : "";
  return `${lead ? `${lead} ` : ""}A slow website or your internet provider is the more likely cause.`;
}

/** The measured figures, for the line of numbers under the findings. */
export function networkFacts(r: NetworkReading): NetworkFact[] {
  const out: NetworkFact[] = [];
  const wifi = r.adapter?.kind === "wifi";
  if (wifi && r.wifi) {
    out.push({ label: "Wi-Fi", value: `${r.wifi.signal}%`, sub: [r.wifi.band, wifiGeneration(r.wifi.radio)].filter(Boolean).join(" · ") || "Signal", look: r.wifi.signal < WEAK_SIGNAL });
  } else if (r.adapter?.kind === "ethernet") {
    out.push({ label: "Cable", value: r.adapter.linkMbps != null ? linkSpeed(r.adapter.linkMbps) : "Connected", sub: "Link speed", look: r.adapter.linkMbps != null && r.adapter.linkMbps < 1000 });
  }
  const s = r.adapter ? read(r) : null;
  if (r.gateway) {
    out.push({ label: "Router", value: r.gateway.avgMs != null ? figureMs(r.gateway.avgMs) : "—", sub: r.gateway.received === 0 && s?.internetSeen ? "Doesn't answer pings" : pingSub(r.gateway), look: !!s?.routerBad || (r.gateway.received === 0 && !s?.internetSeen) });
  }
  out.push({ label: "Internet", value: r.internet.avgMs != null ? figureMs(r.internet.avgMs) : "—", sub: r.internet.received === 0 && r.dns.ms != null ? "Pings blocked" : pingSub(r.internet), look: !!s?.internetBad || (r.internet.received === 0 && r.dns.ms == null) });
  out.push({ label: "Lookups", value: r.dns.ms != null ? figureMs(r.dns.ms) : "Failed", sub: "Website names", look: r.dns.ms == null || r.dns.ms > DNS_SLOW_MS });
  return out;
}
