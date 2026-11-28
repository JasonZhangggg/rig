// The demo's connection check: Pebble, the laptop, sits far from its router on 2.4 GHz Wi-Fi; Atlas, the tower, is on
// a cable and fine. The milliseconds move a little between checks, as real ones do; the signal and losses don't.

import type { NetworkReading } from "../network";
import type { Inventory } from "../telemetry";

const wobble = (base: number, spread: number) => Math.round((base + (Math.random() - 0.5) * spread) * 10) / 10;

export function demoNetwork(inv: Inventory, now: number): NetworkReading {
  if (inv.machine.kind === "laptop") {
    return {
      at: now,
      adapter: { kind: "wifi", name: "Wi-Fi", description: "Intel(R) Wi-Fi 6E AX211 160MHz", linkMbps: 72, driverDate: "2023-08-14", driverVersion: "22.250.1.2" },
      wifi: { signal: 34, band: "2.4 GHz", channel: 6, radio: "802.11ac" },
      gateway: { target: "192.168.1.1", sent: 5, received: 4, avgMs: wobble(46, 8) },
      internet: { target: "1.1.1.1", sent: 5, received: 4, avgMs: wobble(71, 10) },
      dns: { name: "www.microsoft.com", ms: wobble(58, 12) },
      vpn: null,
    };
  }
  return {
    at: now,
    adapter: { kind: "ethernet", name: "Ethernet", description: "Realtek Gaming 2.5GbE Family Controller", linkMbps: 2500, driverDate: "2025-06-03", driverVersion: "10.72.603.2025" },
    gateway: { target: "192.168.1.1", sent: 5, received: 5, avgMs: wobble(1.2, 0.4) },
    internet: { target: "1.1.1.1", sent: 5, received: 5, avgMs: wobble(14, 3) },
    dns: { name: "www.microsoft.com", ms: wobble(21, 6) },
    vpn: null,
  };
}
