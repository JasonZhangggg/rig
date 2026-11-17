// Sample data for the design mockups. Every number here is made up.
// Nothing is read from a real computer yet.

export type Severity = "warn" | "info" | "ok" | "bad";
export type Route = "overview" | "pc" | "chat" | "changes" | "upgrades" | "games" | "history" | "web" | "signin";

export interface Driver { installed: string; latest: string; note: string }
export interface Part {
  name: string;
  type: string;
  sub?: string;
  modelSource: "library" | "generic";
  dims?: string;
  temp?: number;
  tempMax?: number;
  load?: number;
  clock?: string;
  fan?: number;
  warn?: boolean;
  soldered?: boolean;
  specs: [string, string][];
  manual: [string, string][];
  driver?: Driver;
}
export interface Issue { id: string; severity: Severity; title: string; body: string; action: string; part?: string; go: Route }
export interface Stat { label: string; value: number; unit: string; note: string; warn?: boolean }
export interface PC {
  id: string;
  name: string;
  kind: "tower" | "laptop";
  accent: string;
  nickname: string;
  os: string;
  health: number;
  lastSync: string;
  online: boolean;
  summary: string;
  stats?: Stat[];
  issues?: Issue[];
  model?: { source: "library" | "generic"; label: string };
  parts?: Record<string, Part>;
}
export type DiffRow = [string, string, string];
export interface Proposal { title: string; changes: DiffRow[] }
export interface ChatMessage {
  from: "you" | "claude";
  text: string;
  text2?: string;
  sources?: { label: string; kind: string }[];
  steps?: string[];
  proposal?: Proposal;
}
export interface Change {
  id: string; when: string; title: string; by: string; status: "applied" | "undone";
  why: string; diff: DiffRow[]; result: string; restore: string;
}
export interface Upgrade { part: string; title: string; fit: "fits" | "check" | "no" | "later"; detail: string; gain: string; price: string }
export interface Game {
  name: string; res: string; now: { avg: number; low: number }; tuned: { avg: number; low: number };
  settings: DiffRow[]; measured: string;
}
export interface HistoryPoint { h: number; cpu: number; gpu: number; gaming: boolean }
export const user = { name: "Jason", email: "you@example.com" };

export const pcs: Record<string, PC> = {
  atlas: {
    id: "atlas",
    name: "Atlas",
    kind: "tower",
    accent: "#E8692E",
    nickname: "Gaming desktop",
    os: "Windows 11 Pro 24H2",
    health: 82,
    lastSync: "Synced 2 min ago",
    online: true,
    summary: "Running well. One thing needs a look.",
    stats: [
      { label: "CPU", value: 61, unit: "°C", note: "idle 41°C" },
      { label: "GPU", value: 84, unit: "°C", note: "in Cyberpunk 2077", warn: true },
      { label: "Storage", value: 61, unit: "%", note: "1.22 of 2 TB used" },
      { label: "Memory", value: 38, unit: "%", note: "12 of 32 GB in use" },
    ],
    issues: [
      {
        id: "dust",
        severity: "warn",
        title: "Graphics card runs 9°C hotter than a month ago",
        body: "Same game, same settings, same room temperature. That pattern usually means dust on the front intake filter.",
        action: "See how to clean it",
        part: "gpu",
        go: "chat",
      },
      {
        id: "driver",
        severity: "info",
        title: "Graphics driver update available",
        body: "NVIDIA 566.36 fixes stutter in two games you play. You have 565.90.",
        action: "Review update",
        part: "gpu",
        go: "pc",
      },
      {
        id: "boot",
        severity: "ok",
        title: "Startup is 11 seconds faster",
        body: "Since you turned off 4 startup apps on Nov 12.",
        action: "View change",
        go: "changes",
      },
    ],
    model: {
      source: "library",
      label: "NZXT H5 Flow, matched from the model library",
    },
    parts: {
      case: {
        name: "NZXT H5 Flow",
        type: "Case",
        modelSource: "library",
        specs: [["Form factor", "ATX mid tower"], ["Size", "446 × 227 × 464 mm"], ["GPU clearance", "365 mm"], ["CPU cooler clearance", "165 mm"], ["Fans", "2 × 120 mm front, 1 × 120 mm rear"]],
        manual: [["Removing the front filter", "p. 14"], ["Fan and radiator support", "p. 9"], ["Cable routing", "p. 18"]],
      },
      motherboard: {
        name: "MSI MAG B650 Tomahawk WiFi",
        type: "Motherboard",
        modelSource: "library",
        temp: 44, tempMax: 58,
        specs: [["Socket", "AM5"], ["Memory slots", "4 (2 used)"], ["M.2 slots", "3 (1 used)"], ["BIOS", "7D75v1H (latest is 7D75v1J)"], ["Wi-Fi", "Wi-Fi 6E"]],
        manual: [["Memory install order", "p. 32"], ["M.2 slot locations", "p. 35"], ["Updating the BIOS", "p. 61"]],
        driver: { installed: "BIOS 7D75v1H", latest: "BIOS 7D75v1J", note: "Improves memory stability with DDR5-6000 kits." },
      },
      cpu: {
        name: "AMD Ryzen 7 7800X3D",
        type: "Processor and cooler",
        sub: "Thermalright Peerless Assassin 120",
        modelSource: "generic",
        temp: 61, tempMax: 79, load: 34, clock: "4.85 GHz", fan: 1180,
        specs: [["Cores", "8 cores, 16 threads"], ["Boost clock", "5.0 GHz"], ["Safe limit", "89°C"], ["Cooler", "Dual tower air cooler, 2 × 120 mm"]],
        manual: [["Thermal paste application", "Cooler p. 6"], ["Precision Boost Overdrive", "AMD guide"]],
      },
      gpu: {
        name: "ASUS Dual RTX 4070 SUPER",
        type: "Graphics card",
        modelSource: "generic",
        dims: "267 × 134 × 50 mm",
        temp: 84, tempMax: 88, load: 97, clock: "2.61 GHz", fan: 2450, warn: true,
        specs: [["Memory", "12 GB GDDR6X"], ["Power", "220 W, one 8-pin"], ["Length", "267 mm (fits, 98 mm to spare)"], ["Safe limit", "90°C"]],
        manual: [["Fan curve and 0 dB mode", "p. 4"], ["Cleaning the heatsink", "p. 7"]],
        driver: { installed: "NVIDIA 565.90", latest: "NVIDIA 566.36", note: "Fixes stutter in Cyberpunk 2077 and Baldur's Gate 3." },
      },
      ram: {
        name: "Corsair Vengeance 2 × 16 GB",
        type: "Memory",
        modelSource: "generic",
        temp: 47, tempMax: 52,
        specs: [["Type", "DDR5-6000 CL30"], ["Profile", "EXPO enabled"], ["Slots used", "A2 and B2 of 4"]],
        manual: [["Enabling EXPO", "Board manual p. 48"]],
      },
      ssd: {
        name: "Samsung 990 Pro 2 TB",
        type: "Storage",
        modelSource: "generic",
        temp: 52, tempMax: 63,
        specs: [["Interface", "PCIe 4.0 NVMe, M.2 2280"], ["Health", "98% (good)"], ["Written so far", "14.2 TB"], ["Free", "780 GB"]],
        manual: [["Firmware updates with Samsung Magician", "p. 3"]],
        driver: { installed: "Firmware 4B2QJXD7", latest: "Firmware 4B2QJXD7", note: "Up to date." },
      },
      psu: {
        name: "Corsair RM750e",
        type: "Power supply",
        modelSource: "generic",
        specs: [["Wattage", "750 W, 80+ Gold"], ["Peak draw seen", "412 W while gaming"], ["Headroom", "45%"]],
        manual: [["Cable compatibility", "p. 11"]],
      },
      fans: {
        name: "Case fans",
        type: "Cooling",
        modelSource: "generic",
        fan: 1320,
        specs: [["Front intake", "2 × 120 mm at 1,320 RPM"], ["Rear exhaust", "1 × 120 mm at 1,180 RPM"], ["Curve", "Default (Silent)"]],
        manual: [["Fan headers", "Board manual p. 27"]],
      },
    },
  },
  pebble: {
    id: "pebble",
    name: "Pebble",
    kind: "laptop",
    accent: "#3C7BF0",
    nickname: "Work laptop",
    os: "Windows 11 Home 24H2",
    health: 91,
    lastSync: "Synced 14 min ago",
    online: true,
    summary: "Healthy. Battery is at 89% of its original capacity.",
    stats: [
      { label: "CPU", value: 58, unit: "°C", note: "on a video call" },
      { label: "Battery", value: 89, unit: "%", note: "of original capacity" },
      { label: "Storage", value: 43, unit: "%", note: "430 of 1,000 GB used" },
      { label: "Memory", value: 71, unit: "%", note: "11.4 of 16 GB in use" },
    ],
    issues: [
      {
        id: "throttle",
        severity: "info",
        title: "Slows down briefly on battery",
        body: "The processor drops to 1.2 GHz for a few seconds when it reaches 95°C on battery power. Normal for thin laptops, but a cooler power mode helps.",
        action: "Ask about it",
        part: "cpu",
        go: "chat",
      },
      {
        id: "ram",
        severity: "ok",
        title: "Memory can't be upgraded",
        body: "The 16 GB is soldered to the board. Storage can be upgraded.",
        action: "See upgrades",
        go: "upgrades",
      },
    ],
    model: { source: "generic", label: "Built from your laptop's size and color" },
    parts: {
      chassis: { name: "ASUS Zenbook 14 OLED (UX3405MA)", type: "Laptop", modelSource: "generic", specs: [["Size", "312 × 220 × 15 mm"], ["Weight", "1.2 kg"], ["Screen", "14\" 2880 × 1800 OLED"]], manual: [["Opening the bottom cover", "Service guide p. 5"]] },
      cpu: { name: "Intel Core Ultra 7 155H", type: "Processor", modelSource: "generic", temp: 58, tempMax: 95, load: 22, clock: "3.1 GHz", warn: false, specs: [["Cores", "16 cores, 22 threads"], ["Safe limit", "110°C"], ["Graphics", "Intel Arc (built in)"]], manual: [["Power modes in MyASUS", "p. 12"]] },
      ram: { name: "16 GB LPDDR5X", type: "Memory", modelSource: "generic", soldered: true, specs: [["Type", "LPDDR5X-7467"], ["Upgradable", "No, soldered to the board"]], manual: [] },
      ssd: { name: "WD SN560 1 TB", type: "Storage", modelSource: "generic", temp: 41, tempMax: 55, specs: [["Slot", "M.2 2280, PCIe 4.0"], ["Upgradable", "Yes"], ["Health", "100%"]], manual: [["Replacing the SSD", "Service guide p. 9"]] },
      fans: { name: "Dual fans", type: "Cooling", modelSource: "generic", fan: 2900, specs: [["Fans", "2 blower fans"], ["Heat pipes", "2"]], manual: [] },
      battery: { name: "75 Wh battery", type: "Battery", modelSource: "generic", specs: [["Capacity now", "66.8 Wh (89%)"], ["Cycles", "212"]], manual: [["Battery care mode", "MyASUS p. 20"]] },
      board: { name: "Mainboard", type: "Motherboard", modelSource: "generic", temp: 49, tempMax: 66, specs: [["BIOS", "UX3405MA.308"]], manual: [], driver: { installed: "BIOS 308", latest: "BIOS 310", note: "Improves fan noise at idle." } },
    },
  },
  den: {
    id: "den", name: "Den PC", kind: "tower", accent: "#2E9E6B", nickname: "Family desktop",
    os: "Windows 10 Home 22H2", health: 64, lastSync: "Last seen 3 days ago", online: false,
    summary: "Windows 10 support has ended. Two updates are waiting.",
  },
};

export const chat: ChatMessage[] = [
  { from: "you", text: "My PC gets really loud when I play Cyberpunk. Is that normal?" },
  {
    from: "claude",
    text: "Some noise is normal, but yours is louder than it should be. Your graphics card reaches 84°C with its fans at 2,450 RPM in Cyberpunk 2077. That's under its 90°C limit, but it's 9°C hotter than on Oct 15 at the same settings and room temperature.",
    text2: "A steady rise like this usually means dust. Your case has a removable front filter, and cleaning it takes about five minutes.",
    sources: [
      { label: "NZXT H5 Flow manual, p. 14", kind: "Manual" },
      { label: "ASUS Dual RTX 4070 SUPER manual, p. 7", kind: "Manual" },
      { label: "Your temperature history, 30 days", kind: "Your PC" },
    ],
    steps: ["Shut down and unplug the PC.", "Pull the front panel off from the bottom edge.", "Slide the mesh filter out and rinse or vacuum it.", "Let it dry fully, then put it back."],
  },
  {
    from: "claude",
    text: "I can also make it quieter right away with a gentler fan curve. It keeps the card under 86°C and lowers fan speed by about 300 RPM.",
    proposal: {
      title: "Quieter graphics card fans",
      changes: [
        ["GPU fan curve", "Default", "Quiet curve, max 2,150 RPM"],
        ["GPU power limit", "220 W", "205 W (about 2% fewer FPS)"],
      ],
    },
  },
];

export const changes: Change[] = [
  {
    id: "c1", when: "Nov 12, 9:41 PM", title: "Turned off 4 startup apps", by: "Claude, after you said yes", status: "applied",
    why: "Startup took 38 seconds.",
    diff: [["Steam", "Starts with Windows", "Off"], ["Discord", "Starts with Windows", "Off"], ["Adobe Updater", "Starts with Windows", "Off"], ["Spotify", "Starts with Windows", "Off"]],
    result: "Startup now takes 27 seconds.", restore: "Restore point made Nov 12, 9:40 PM",
  },
  {
    id: "c2", when: "Nov 9, 6:02 PM", title: "Rolled back the Realtek audio driver", by: "Claude, after you said yes", status: "applied",
    why: "Audio crackled after driver 6.0.9733 installed.",
    diff: [["Realtek audio driver", "6.0.9733.1", "6.0.9700.1"]],
    result: "No crackling reported since.", restore: "Restore point made Nov 9, 6:01 PM",
  },
  {
    id: "c3", when: "Nov 2, 3:15 PM", title: "Changed power plan", by: "You", status: "undone",
    why: "Tried for better FPS.",
    diff: [["Power plan", "Balanced", "Ultimate Performance"]],
    result: "Undone on Nov 3. Idle temperature went up 6°C with no FPS gain.", restore: "Restore point made Nov 2, 3:14 PM",
  },
];

export const upgrades: Record<string, Upgrade[]> = {
  atlas: [
    { part: "Memory", title: "Add 2 × 16 GB DDR5-6000", fit: "fits", detail: "Slots A1 and B1 are free. Match your current kit to keep EXPO stable.", gain: "Helps with heavy multitasking and some sims", price: "$95" },
    { part: "Storage", title: "Add a 2 TB NVMe SSD", fit: "fits", detail: "2 free M.2 slots. Slot M2_2 shares bandwidth with SATA port 3, which you don't use.", gain: "More room for games", price: "$130" },
    { part: "Graphics", title: "RTX 4080 SUPER", fit: "check", detail: "Fits the case (304 mm, 61 mm to spare). Your 750 W supply is right at the recommended minimum.", gain: "About 45% more FPS at 1440p", price: "$999" },
    { part: "Cooling", title: "Third front fan", fit: "fits", detail: "The H5 Flow takes one more 120 mm fan in front. Fan header SYS_FAN3 is free.", gain: "About 3 to 4°C cooler graphics card", price: "$18" },
  ],
  pebble: [
    { part: "Memory", title: "Memory can't be upgraded", fit: "no", detail: "The 16 GB of LPDDR5X is soldered to the board, like most thin laptops.", gain: "", price: "" },
    { part: "Storage", title: "Swap to a 2 TB NVMe SSD", fit: "fits", detail: "One M.2 2280 slot, PCIe 4.0. Back up first; we can walk you through cloning.", gain: "Double the space", price: "$120" },
    { part: "Battery", title: "Replacement battery", fit: "later", detail: "At 89% capacity there's no need yet. Most people replace around 70 to 75%.", gain: "", price: "$85" },
  ],
};

export const games: Game[] = [
  { name: "Cyberpunk 2077", res: "2560 × 1440", now: { avg: 78, low: 61 }, tuned: { avg: 96, low: 74 }, settings: [["DLSS", "Off", "Quality"], ["Ray tracing", "Ultra", "Medium"], ["Crowd density", "High", "Medium"]], measured: "Measured with the built-in benchmark, 3 runs each" },
  { name: "Counter-Strike 2", res: "2560 × 1440", now: { avg: 312, low: 168 }, tuned: { avg: 341, low: 205 }, settings: [["NVIDIA Reflex", "On", "On + Boost"], ["Shader detail", "High", "Low"]], measured: "Measured over a 60-second demo, 3 runs each" },
  { name: "Baldur's Gate 3", res: "2560 × 1440", now: { avg: 92, low: 54 }, tuned: { avg: 101, low: 66 }, settings: [["DLSS", "Quality", "Quality"], ["Shadow quality", "Ultra", "High"]], measured: "Measured in the Lower City, 3 runs each" },
];

// Deterministic fake history so charts look the same every load.
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function history(days = 7): HistoryPoint[] {
  const r = rng(42);
  const points: HistoryPoint[] = [];
  const hours = days * 24;
  for (let h = 0; h <= hours; h++) {
    const day = Math.floor(h / 24);
    const hour = h % 24;
    const gaming = hour >= 19 && hour <= 22 && day % 7 !== 2;
    const work = hour >= 9 && hour <= 17;
    const drift = (day / days) * 3; // slow upward trend: dust
    const cpu = (gaming ? 66 : work ? 50 : 41) + r() * 5 + drift * 0.5;
    const gpu = (gaming ? 79 : work ? 42 : 36) + r() * 4 + (gaming ? drift : 0);
    points.push({ h, cpu: +cpu.toFixed(1), gpu: +gpu.toFixed(1), gaming });
  }
  return points;
}

export function sparkData(base: number, n = 30, seed = 7, spread = 6): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => base - spread / 2 + r() * spread + Math.sin(i / 4) * 2);
}
