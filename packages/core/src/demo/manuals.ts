// The demo's two sample manuals, drawn in code: a motherboard manual for
// Atlas's board and a short service guide for Pebble. Everything in them is
// made up for the demo; the header names follow the common conventions so
// search, the diagram finder and the chat have something real to work on.

import type { ManualPage } from "../manuals";
import { PAGE_W, PdfPage, textWidth, writePdf } from "./pdf";

type RGB = [number, number, number];
const ink: RGB = [0.11, 0.11, 0.13];
const grey: RGB = [0.42, 0.42, 0.4];
const faint: RGB = [0.62, 0.62, 0.6];
const board: RGB = [0.86, 0.89, 0.86];
const boardEdge: RGB = [0.3, 0.34, 0.32];
const part: RGB = [0.27, 0.29, 0.31];
const slot: RGB = [0.97, 0.97, 0.95];
const accent: RGB = [0.85, 0.5, 0.31];
const pale: RGB = [0.98, 0.9, 0.84];

export interface SampleManual { title: string; pages: PdfPage[] }

function page(doc: string, heading: string, sub?: string): PdfPage {
  const p = new PdfPage();
  p.text(48, 40, doc, { size: 8, color: faint });
  p.text(PAGE_W - 48, 40, "Made up for the Rig demo", { size: 8, color: faint, align: "right" });
  p.line(48, 48, PAGE_W - 48, 48, { stroke: [0.85, 0.85, 0.83], width: 0.6 });
  p.text(48, 86, heading, { size: 20, bold: true, color: ink });
  if (sub) p.para(48, 108, PAGE_W - 96, sub, { size: 10, color: grey });
  // The page number is drawn last so pdf.js reads it after the page's own text.
  return p;
}
const finish = (p: PdfPage, n: number) => p.text(PAGE_W / 2, 812, `Page ${n}`, { size: 8, color: faint, align: "center" });

/** A labelled box: the shape with its name inside or beside it. */
function box(p: PdfPage, x: number, y: number, w: number, h: number, fill: RGB, label?: string, size = 7) {
  p.rect(x, y, w, h, { fill, stroke: boardEdge, width: 0.6 });
  if (label) p.text(x + w / 2, y + h / 2 + size / 3, label, { size, bold: true, color: fill[0] + fill[1] + fill[2] < 1.5 ? [1, 1, 1] : ink, align: "center" });
}

/** A label outside the board with a thin line to what it names. */
function callout(p: PdfPage, label: string, lx: number, ly: number, tx: number, ty: number, side: "left" | "right" | "below" | "above") {
  const ax = side === "left" ? lx + 4 : side === "right" ? lx - 4 : lx;
  const ay = side === "below" ? ly - 9 : side === "above" ? ly + 3 : ly - 3;
  p.line(ax, ay, tx, ty, { stroke: grey, width: 0.5 });
  p.circle(tx, ty, 1.4, { fill: grey });
  p.text(lx, ly, label, { size: 7.5, bold: true, color: ink, align: side === "left" ? "right" : side === "right" ? "left" : "center" });
}

function table(p: PdfPage, x: number, y: number, rows: [string, string][], widths: [number, number], size = 9.5) {
  let top = y;
  for (const [i, [a, b]] of rows.entries()) {
    if (i) p.line(x, top - size * 1.25, x + widths[0] + widths[1], top - size * 1.25, { stroke: [0.88, 0.88, 0.86], width: 0.5 });
    p.text(x, top, a, { size, bold: true, color: ink });
    const end = p.para(x + widths[0], top, widths[1], b, { size, color: ink, lead: size * 1.3 });
    top = end + size * 0.8;
  }
  return top;
}

function steps(p: PdfPage, x: number, y: number, width: number, list: string[]) {
  let top = y;
  list.forEach((s, i) => {
    p.circle(x + 8, top - 3.5, 8, { fill: ink });
    p.text(x + 8, top, String(i + 1), { size: 8.5, bold: true, color: [1, 1, 1], align: "center" });
    top = p.para(x + 24, top, width - 24, s, { size: 10, color: ink }) + 6;
  });
  return top;
}

/** A row of header pins, `cols` wide and `rows` high, with pin 1 marked square. */
function pins(p: PdfPage, x: number, y: number, cols: number, rows: number, pitch: number, missing: number[] = []) {
  p.rect(x - pitch * 0.5, y - pitch * 0.5, cols * pitch, rows * pitch, { fill: [0.2, 0.21, 0.23], stroke: boardEdge, width: 0.6 });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (missing.includes(i)) continue;
    const cx = x + c * pitch, cy = y + r * pitch;
    if (i === 0) p.rect(cx - pitch * 0.22, cy - pitch * 0.22, pitch * 0.44, pitch * 0.44, { fill: [0.93, 0.8, 0.45] });
    else p.circle(cx, cy, pitch * 0.22, { fill: [0.93, 0.8, 0.45] });
  }
}

/** Atlas's board manual: twelve pages with the board layout, the headers, memory order, M.2, rear ports and specs. */
export function sampleBoardManual(maker: string, model: string): SampleManual {
  const doc = `${model} sample manual`;
  const pages: PdfPage[] = [];
  const next = (heading: string, sub?: string) => { const p = page(doc, heading, sub); pages.push(p); return p; };

  // 1. Cover
  let p = next("Sample motherboard manual (demo)");
  p.text(48, 130, `${maker} ${model}`, { size: 14, bold: true, color: grey });
  p.para(48, 160, 499, "Rig made this sample for its demo so you can try the Manuals page. It is not the maker's manual. The drawings, header names and numbers follow common conventions but are made up.", { size: 11, color: ink });
  p.rect(48, 230, 499, 250, { fill: board, stroke: boardEdge, width: 0.8 });
  box(p, 220, 285, 110, 110, slot, "CPU");
  for (let i = 0; i < 4; i++) p.rect(360 + i * 16, 260, 9, 190, { fill: slot, stroke: boardEdge, width: 0.6 });
  p.rect(90, 420, 230, 14, { fill: part });
  p.text(48, 520, "Contents", { size: 13, bold: true, color: ink });
  const toc: [string, number][] = [["Before you start", 2], ["Specifications", 3], ["Board layout", 4], ["Rear I/O panel", 5], ["Installing the CPU", 6], ["Memory slot order", 7], ["M.2 slots", 8], ["Front panel header", 9], ["Fan and pump headers", 10], ["Power connectors", 11], ["RGB and USB headers", 12]];
  toc.forEach(([t, n], i) => {
    p.text(48, 545 + i * 19, t, { size: 10.5, color: ink });
    p.line(48 + textWidth(t, 10.5) + 6, 545 + i * 19 - 3, 520, 545 + i * 19 - 3, { stroke: [0.8, 0.8, 0.78], width: 0.5, dash: [1, 2.5] });
    p.text(547, 545 + i * 19, String(n), { size: 10.5, color: ink, align: "right" });
  });
  finish(p, 1);

  // 2. Prose: mentions headers only in passing.
  p = next("Before you start");
  let y = 130;
  for (const s of [
    "Unplug the power cable and press the power button once to drain any charge before you touch anything inside the case. Touch a bare metal part of the case first so static electricity goes there rather than into the board.",
    "Handle the board by its edges. Keep it on the anti-static bag it came in, never on carpet. Do not force any connector; every plug on this board only fits one way.",
    "Most first builds that do not start have one of three causes: the 8-pin processor power cable is missing, the memory is not pushed fully into its slot, or the power switch wire is on the wrong pins of the front panel header. Check those three before anything else.",
    "Your processor cooler's fan goes on CPU_FAN, near the top of the board. If the board cannot see a fan there, it shows a warning when it starts, which is there to protect the processor.",
    "Keep this manual. The board layout on page 4 shows where every header is, and the pages after it explain each one.",
  ]) y = p.para(48, y, 499, s, { size: 11, color: ink, lead: 16 }) + 10;
  finish(p, 2);

  // 3. Specifications
  p = next("Specifications");
  table(p, 48, 135, [
    ["CPU", "AMD Ryzen processors for socket AM5"],
    ["Chipset", "AMD B650"],
    ["Memory", "4 DDR5 slots, up to 192 GB. Dual channel. Speeds above 5200 MT/s use the EXPO profile."],
    ["Expansion slots", "PCI_E1: PCIe 4.0 x16 for the graphics card. PCI_E2: PCIe 4.0 x4."],
    ["Storage", "2 M.2 slots (M2_1 from the processor, M2_2 from the chipset), 4 SATA ports"],
    ["LAN", "2.5 Gb Ethernet"],
    ["Wireless", "Wi-Fi 6E and Bluetooth 5.3"],
    ["Audio", "7.1 channel audio with optical S/PDIF out"],
    ["Rear panel", "8 USB ports, HDMI, DisplayPort, BIOS FLASHBACK button"],
    ["Internal connectors", "F_PANEL, CPU_FAN, PUMP_FAN, CHA_FAN1-3, ARGB_1-2, RGB_1, JUSB1-4"],
    ["BIOS", "One 256 Mb flash chip with BIOS FLASHBACK"],
    ["Form factor", "ATX, 305 x 244 mm"],
  ], [130, 369]);
  finish(p, 3);

  // 4. Board layout
  p = next("Board layout", "Where each slot and header is. Header names are printed on the board next to each one.");
  const bx = 170, by = 150, bw = 260, bh = 330;
  p.rect(bx, by, bw, bh, { fill: board, stroke: boardEdge, width: 1 });
  box(p, bx, by + 12, 30, 150, part, "");
  box(p, bx + 50, by + 6, 40, 12, part, "");
  box(p, bx + 70, by + 42, 90, 90, slot, "CPU socket", 8);
  box(p, bx + 130, by + 8, 18, 7, part);
  box(p, bx + 156, by + 8, 18, 7, part);
  const dimm = ["A1", "A2", "B1", "B2"];
  dimm.forEach((d, i) => { p.rect(bx + 182 + i * 13, by + 28, 8, 140, { fill: slot, stroke: boardEdge, width: 0.6 }); p.text(bx + 186 + i * 13, by + 24, d, { size: 5.5, bold: true, color: ink, align: "center" }); });
  box(p, bx + 240, by + 50, 14, 100, part);
  box(p, bx + 236, by + 168, 18, 7, part);
  box(p, bx + 232, by + 188, 22, 9, part);
  box(p, bx + 60, by + 150, 100, 12, slot, "", 6);
  box(p, bx + 20, by + 180, 200, 10, part);
  box(p, bx + 60, by + 214, 100, 12, slot, "", 6);
  box(p, bx + 20, by + 245, 150, 8, part);
  box(p, bx + 185, by + 225, 40, 40, slot, "Chipset", 6.5);
  box(p, bx + 244, by + 222, 10, 50, part);
  const bottom = [["JAUD1", 10], ["ARGB_1", 40], ["RGB_1", 70], ["JUSB1", 100], ["CHA_FAN2", 135], ["CHA_FAN3", 168], ["F_PANEL", 205]] as const;
  for (const [, x] of bottom) box(p, bx + x, by + bh - 16, 24, 8, part);
  box(p, bx + 236, by + bh - 70, 18, 7, part);
  // Callouts
  callout(p, "Rear I/O", bx - 14, by + 90, bx + 14, by + 90, "left");
  callout(p, "CPU_PWR1 (8-pin)", bx - 14, by + 12, bx + 70, by + 12, "left");
  callout(p, "M2_1 (M.2, CPU)", bx - 14, by + 160, bx + 60, by + 156, "left");
  callout(p, "PCI_E1 (graphics card)", bx - 14, by + 188, bx + 20, by + 185, "left");
  callout(p, "M2_2 (M.2, chipset)", bx - 14, by + 222, bx + 60, by + 220, "left");
  callout(p, "PCI_E2", bx - 14, by + 252, bx + 20, by + 249, "left");
  callout(p, "CPU_FAN", bx + 139, by - 18, bx + 139, by + 11, "above");
  callout(p, "PUMP_FAN", bx + 190, by - 30, bx + 165, by + 11, "above");
  callout(p, "DIMM A1 A2 B1 B2", bx + bw + 14, by + 34, bx + 220, by + 40, "right");
  callout(p, "ATX_PWR1 (24-pin)", bx + bw + 14, by + 100, bx + 254, by + 100, "right");
  callout(p, "CHA_FAN1", bx + bw + 14, by + 172, bx + 254, by + 171, "right");
  callout(p, "JUSB3 (USB 3.2 header)", bx + bw + 14, by + 193, bx + 254, by + 192, "right");
  callout(p, "SATA1-4", bx + bw + 14, by + 247, bx + 254, by + 247, "right");
  callout(p, "JUSB4 (USB Type-C)", bx + bw + 14, by + bh - 62, bx + 254, by + bh - 66, "right");
  bottom.forEach(([name, x], i) => callout(p, name, bx + x + 12, by + bh + 22 + (i % 2) * 12, bx + x + 12, by + bh - 8, "below"));
  table(p, 48, 560, [
    ["CPU_FAN, PUMP_FAN", "Processor cooler fan and liquid cooler pump"],
    ["CHA_FAN1-3", "Case fans"],
    ["F_PANEL", "Case power button, reset button and lights"],
    ["ARGB_1, RGB_1", "Lighting: 5V addressable and 12V RGB"],
    ["JUSB1, JUSB3, JUSB4", "Front USB ports on the case"],
    ["ATX_PWR1, CPU_PWR1", "Power from the power supply"],
  ], [150, 349], 9);
  finish(p, 4);

  // 5. Rear I/O
  p = next("Rear I/O panel", "The ports on the back of the PC, from left to right.");
  p.rect(48, 200, 499, 110, { fill: [0.82, 0.83, 0.82], stroke: boardEdge, width: 1 });
  const ports: [string, number, number, number][] = [
    ["BIOS FLASHBACK", 62, 14, 14], ["USB 2.0", 92, 22, 26], ["LAN", 130, 26, 24], ["HDMI", 172, 34, 12], ["DisplayPort", 220, 30, 12],
    ["USB 3.2 Gen 2", 266, 22, 30], ["USB Type-C", 304, 22, 9], ["Wi-Fi antenna", 345, 14, 14], ["Optical S/PDIF out", 395, 18, 16], ["Line-in, Line-out, Mic-in", 440, 30, 70],
  ];
  ports.forEach(([name, x, w, h], i) => {
    p.rect(x, 225, w, h, { fill: [0.18, 0.19, 0.21], stroke: boardEdge, width: 0.5 });
    callout(p, name, x + w / 2, 340 + (i % 2) * 14 + (i % 3 === 2 ? 0 : 0), x + w / 2, 225 + h, "below");
  });
  table(p, 48, 410, [
    ["BIOS FLASHBACK", "Updates the BIOS from a USB stick, even with no processor fitted."],
    ["USB 3.2 Gen 2", "The fastest ports: use them for external drives."],
    ["LAN", "2.5 Gb Ethernet. The light on the left shows the link."],
    ["HDMI and DisplayPort", "Only work with a processor that has graphics. Plug screens into the graphics card instead."],
    ["Wi-Fi antenna", "Screw both antennas on, finger tight."],
  ], [140, 359]);
  finish(p, 5);

  // 6. Installing the CPU
  p = next("Installing the CPU");
  p.rect(150, 140, 200, 200, { fill: slot, stroke: boardEdge, width: 1 });
  p.rect(170, 160, 160, 160, { fill: [0.93, 0.85, 0.6], stroke: boardEdge, width: 0.6 });
  p.poly([[170, 320], [190, 320], [170, 300]], { fill: accent });
  p.line(360, 330, 360, 150, { stroke: part, width: 4 });
  p.arrow(380, 170, 380, 320, accent);
  p.text(388, 250, "Lever", { size: 8, bold: true, color: ink });
  p.text(176, 336, "Triangle marks pin 1", { size: 8, bold: true, color: ink });
  steps(p, 48, 380, 499, [
    "Push the socket lever down and out, then lift it all the way up. The load plate lifts with it.",
    "Line up the triangle on the corner of the processor with the triangle on the socket. The notches on two sides only fit one way.",
    "Lower the processor straight down. Do not slide it or press on it.",
    "Close the load plate and push the lever back under its clip. The plastic cover pops off by itself; keep it in case you send the board back.",
    "Put a pea-sized drop of thermal paste in the middle, then fit the cooler and plug its fan into CPU_FAN.",
  ]);
  finish(p, 6);

  // 7. Memory slot order
  p = next("Memory slot order", "Which slots to use for the number of memory sticks you have.");
  dimm.forEach((d, i) => {
    const on = d === "A2" || d === "B2";
    p.rect(150 + i * 70, 160, 34, 240, { fill: on ? pale : slot, stroke: on ? accent : boardEdge, width: on ? 1.6 : 0.8 });
    p.text(167 + i * 70, 150, `DIMM_${d}`, { size: 9, bold: true, color: ink, align: "center" });
    if (on) p.text(167 + i * 70, 420, "Use first", { size: 8, bold: true, color: accent, align: "center" });
  });
  p.text(120, 280, "CPU", { size: 9, bold: true, color: grey, align: "center" });
  p.arrow(135, 290, 145, 290, grey);
  table(p, 48, 470, [
    ["1 stick", "A2"],
    ["2 sticks", "A2 and B2"],
    ["4 sticks", "A1, A2, B1 and B2"],
  ], [140, 359], 11);
  p.para(48, 560, 499, "With two sticks use A2 and B2, the second and fourth slots from the processor. That runs them in dual channel, which is noticeably faster than putting both in A1 and A2.", { size: 10.5, color: ink, lead: 15 });
  finish(p, 7);

  // 8. M.2 slots
  p = next("M.2 slots", "Fast SSDs go in the M.2 slots. Each slot takes a 2280 size drive (22 mm wide, 80 mm long).");
  for (const [i, name] of ["M2_1", "M2_2"].entries()) {
    const top = 160 + i * 120;
    p.rect(80, top, 30, 40, { fill: part, stroke: boardEdge });
    p.rect(110, top + 6, 260, 28, { fill: [0.16, 0.38, 0.3], stroke: boardEdge, width: 0.6 });
    for (let k = 0; k < 4; k++) p.rect(150 + k * 50, top + 11, 36, 18, { fill: [0.2, 0.2, 0.22] });
    p.circle(400, top + 20, 6, { fill: [0.75, 0.75, 0.72], stroke: boardEdge, width: 0.6 });
    p.text(80, top - 8, name, { size: 10, bold: true, color: ink });
    p.text(400, top - 8, "Standoff at 2280", { size: 8, color: grey, align: "center" });
  }
  table(p, 48, 430, [["M2_1", "From the processor. PCIe 4.0 x4. Use it for the drive Windows is on."], ["M2_2", "From the chipset. PCIe 4.0 x4. Shares nothing with SATA."]], [80, 419]);
  steps(p, 48, 500, 499, [
    "Remove the heatsink over the slot (one screw) and peel the film off its thermal pad.",
    "Slide the drive into the slot at a slight angle, label up.",
    "Press the end down onto the standoff and turn the latch to hold it.",
    "Put the heatsink back.",
  ]);
  finish(p, 8);

  // 9. Front panel header
  p = next("Front panel header (F_PANEL)", "The case's power button, reset button and lights. Pins with + are positive; the colored wire usually is.");
  pins(p, 225, 225, 5, 2, 36, [9]);
  const topRow = ["HDD_LED+", "HDD_LED-", "RESET SW", "RESET SW", "Reserved"];
  const botRow = ["PWR_LED+", "PWR_LED-", "POWER SW", "POWER SW", "No pin"];
  topRow.forEach((l, i) => { p.text(225 + i * 36, 190 - (i % 2) * 13, l, { size: 8, bold: true, color: ink, align: "center" }); p.line(225 + i * 36, 193 - (i % 2) * 13, 225 + i * 36, 205, { stroke: faint, width: 0.4 }); });
  botRow.forEach((l, i) => { p.text(225 + i * 36, 300 + (i % 2) * 13, l, { size: 8, bold: true, color: ink, align: "center" }); p.line(225 + i * 36, 279, 225 + i * 36, 291 + (i % 2) * 13, { stroke: faint, width: 0.4 }); });
  p.text(200, 229, "Pin 1", { size: 7, color: grey, align: "right" });
  table(p, 48, 360, [
    ["POWER SW", "Power button. Either way round works."],
    ["RESET SW", "Reset button. Either way round works."],
    ["PWR_LED+ / PWR_LED-", "Power light. If it stays dark, turn the plug round."],
    ["HDD_LED+ / HDD_LED-", "Drive activity light."],
  ], [150, 349]);
  finish(p, 9);

  // 10. Fan and pump headers
  p = next("Fan and pump headers", "All fan headers are 4-pin. A 3-pin fan fits too and is controlled by voltage instead.");
  pins(p, 240, 190, 4, 1, 34);
  ["Ground", "+12V", "Sense", "PWM control"].forEach((l, i) => p.text(240 + i * 34, 228 + (i % 2) * 12, l, { size: 8, color: ink, align: "center" }));
  table(p, 48, 280, [
    ["CPU_FAN", "Processor cooler fan, 1 A. Needs a fan or the board warns at start."],
    ["PUMP_FAN", "Liquid cooler pump, 3 A. Runs at full speed by default."],
    ["CHA_FAN1", "Case fan, 1 A. Next to the memory slots."],
    ["CHA_FAN2", "Case fan, 1 A. Bottom edge."],
    ["CHA_FAN3", "Case fan, 1 A. Bottom edge."],
  ], [110, 389]);
  finish(p, 10);

  // 11. Power connectors
  p = next("Power connectors", "Both must be plugged in or the PC won't start.");
  pins(p, 90, 170, 12, 2, 16);
  p.text(90, 155, "ATX_PWR1 (24-pin)", { size: 9, bold: true, color: ink });
  pins(p, 90, 270, 4, 2, 16);
  p.text(90, 255, "CPU_PWR1 (8-pin)", { size: 9, bold: true, color: ink });
  table(p, 48, 340, [
    ["ATX_PWR1", "24-pin main power, on the right edge. Push until the clip clicks."],
    ["CPU_PWR1", "8-pin processor power, top left. Use the cable marked CPU or EPS, not PCIe."],
  ], [110, 389]);
  finish(p, 11);

  // 12. RGB and USB headers
  p = next("RGB and USB headers");
  p.text(48, 130, "RGB headers", { size: 13, bold: true, color: ink });
  pins(p, 90, 165, 4, 1, 22, [2]);
  ["+5V", "Data", "", "Ground"].forEach((l, i) => l && p.text(90 + i * 22, 192, l, { size: 7.5, color: ink, align: "center" }));
  p.text(90, 150, "ARGB_1, ARGB_2 (5V addressable)", { size: 8, bold: true, color: ink });
  pins(p, 340, 165, 4, 1, 22);
  ["+12V", "G", "R", "B"].forEach((l, i) => p.text(340 + i * 22, 192, l, { size: 7.5, color: ink, align: "center" }));
  p.text(340, 150, "RGB_1 (12V)", { size: 8, bold: true, color: ink });
  p.para(48, 220, 499, "Plugging a 5V strip into the 12V RGB header damages it. Check the plug: 5V ARGB plugs have three wires and a gap.", { size: 10, color: ink });
  p.text(48, 290, "USB headers", { size: 13, bold: true, color: ink });
  pins(p, 90, 330, 5, 2, 16, [9]);
  p.text(90, 315, "JUSB1 (USB 2.0 header)", { size: 8, bold: true, color: ink });
  pins(p, 300, 330, 10, 2, 14, [0]);
  p.text(300, 315, "JUSB3 (USB 3.2 Gen 1 header)", { size: 8, bold: true, color: ink });
  p.rect(90, 380, 40, 14, { fill: part });
  p.text(90, 372, "JUSB4 (USB Type-C header)", { size: 8, bold: true, color: ink });
  table(p, 48, 430, [
    ["JUSB1", "Two USB 2.0 ports on the front of the case."],
    ["JUSB3", "Two USB 3.2 Gen 1 ports on the front. The plug only fits one way."],
    ["JUSB4", "The front USB Type-C port, 10 Gb/s."],
  ], [110, 389]);
  finish(p, 12);

  return { title: `${model} sample manual (demo)`, pages };
}

/** Pebble's service guide: the bottom cover, what's inside, the battery and the SSD. */
export function sampleLaptopGuide(maker: string, model: string): SampleManual {
  const doc = `${model} sample service guide`;
  const pages: PdfPage[] = [];
  const next = (heading: string, sub?: string) => { const p = page(doc, heading, sub); pages.push(p); return p; };

  let p = next("Sample service guide (demo)");
  p.text(48, 130, `${maker} ${model}`, { size: 14, bold: true, color: grey });
  p.para(48, 160, 499, "Rig made this sample for its demo. It is not the maker's guide; the steps and numbers are made up. It shows what Rig keeps for a laptop: how to open it, what's inside and which parts can be changed.", { size: 11, color: ink, lead: 16 });
  p.para(48, 240, 499, "Before you open the laptop, shut it down fully (hold Shift while you choose Shut down), unplug the charger and close the lid. Work on a soft cloth so the lid doesn't scratch.", { size: 11, color: ink, lead: 16 });
  finish(p, 1);

  p = next("Specifications");
  table(p, 48, 135, [
    ["Processor", "Intel Core Ultra 7 155H"],
    ["Memory", "16 GB LPDDR5X, soldered to the board"],
    ["Storage", "One M.2 2280 PCIe 4.0 SSD slot"],
    ["Display", "14 inch OLED, 2880 x 1800, 120 Hz"],
    ["Battery", "75 Wh, 4 cells"],
    ["Ports", "2 USB Type-C (Thunderbolt 4), 1 USB 3.2 Gen 1, HDMI 2.1, audio"],
    ["Weight", "1.2 kg"],
  ], [130, 369]);
  p.text(48, 330, "Dimensions", { size: 13, bold: true, color: ink });
  p.rect(120, 360, 300, 200, { fill: slot, stroke: boardEdge, width: 1 });
  p.arrow(120, 580, 420, 580, grey); p.arrow(420, 580, 120, 580, grey);
  p.text(270, 596, "313.6 mm", { size: 9, bold: true, color: ink, align: "center" });
  p.arrow(440, 360, 440, 560, grey); p.arrow(440, 560, 440, 360, grey);
  p.text(448, 464, "220.1 mm", { size: 9, bold: true, color: ink });
  p.text(270, 630, "Thickness 14.9 mm", { size: 9, bold: true, color: ink, align: "center" });
  finish(p, 2);

  p = next("Removing the bottom cover", "Seven Torx T5 screws hold the cover. Two of them are shorter.");
  p.rect(110, 160, 375, 240, { fill: [0.84, 0.85, 0.86], stroke: boardEdge, width: 1 });
  const screws: [number, number][] = [[130, 180], [297, 180], [465, 180], [130, 380], [297, 380], [465, 380], [297, 280]];
  screws.forEach(([x, y], i) => { p.circle(x, y, 7, { fill: slot, stroke: boardEdge, width: 0.8 }); p.text(x, y + 2.5, String(i + 1), { size: 7, bold: true, color: ink, align: "center" }); });
  p.text(297, 420, "Screws 4 and 6 are short (3 mm)", { size: 8, bold: true, color: ink, align: "center" });
  steps(p, 48, 460, 499, [
    "Turn the laptop over on a soft cloth, hinge away from you.",
    "Undo all seven T5 screws. Keep the two short ones apart.",
    "Start at the hinge: slide a plastic pick into the gap and run it along the edge to release the clips.",
    "Lift the cover off from the hinge side.",
  ]);
  finish(p, 3);

  p = next("Inside view", "What you see with the cover off.");
  p.rect(110, 150, 375, 250, { fill: board, stroke: boardEdge, width: 1 });
  box(p, 130, 290, 335, 95, [0.3, 0.32, 0.36], "Battery", 9);
  box(p, 330, 165, 120, 30, [0.16, 0.38, 0.3], "M.2 2280", 7);
  box(p, 140, 165, 70, 70, slot, "FAN1", 8);
  box(p, 230, 170, 80, 40, part, "Memory", 7);
  box(p, 250, 262, 40, 12, part);
  callout(p, "M.2 2280 SSD slot", 500, 185, 450, 180, "right");
  callout(p, "FAN1", 98, 200, 140, 200, "left");
  callout(p, "Memory (soldered, 16 GB)", 270, 140, 270, 170, "above");
  callout(p, "Battery connector", 500, 268, 290, 268, "right");
  p.para(48, 440, 499, "Memory is soldered to the board and can't be upgraded. The SSD and the battery can be replaced.", { size: 10.5, color: ink });
  finish(p, 4);

  p = next("Replacing the battery");
  steps(p, 48, 140, 499, [
    "Unplug the battery connector first: lift it straight up by its pull tab.",
    "Undo the five Phillips screws along the battery's edge.",
    "Lift the battery out. Do not bend or puncture it.",
    "Fit the new battery, do up the screws and plug the connector back in last.",
  ]);
  p.para(48, 300, 499, "A battery that holds less than about 75% of its first charge is worth replacing.", { size: 10.5, color: ink });
  finish(p, 5);

  p = next("Replacing the SSD", "The SSD is in the M.2 slot at the top right, under a thin metal shield.");
  p.rect(80, 170, 30, 40, { fill: part, stroke: boardEdge });
  p.rect(110, 176, 260, 28, { fill: [0.16, 0.38, 0.3], stroke: boardEdge, width: 0.6 });
  p.circle(400, 190, 6, { fill: [0.75, 0.75, 0.72], stroke: boardEdge, width: 0.6 });
  p.text(80, 160, "M.2 2280 slot", { size: 10, bold: true, color: ink });
  steps(p, 48, 260, 499, [
    "Unplug the battery connector before you touch the SSD.",
    "Undo the one screw at the end of the drive. It springs up at an angle.",
    "Pull the drive straight out of the slot.",
    "Slide the new drive in at the same angle, press it down and do up the screw.",
  ]);
  finish(p, 6);

  return { title: `${model} sample service guide (demo)`, pages };
}

/** The file and the page text pdf.js reads from it. */
export function render(m: SampleManual): { bytes: Uint8Array; pages: ManualPage[] } {
  return { bytes: writePdf(m.pages, m.title), pages: m.pages.map((p, i) => ({ n: i + 1, text: p.textContent() })) };
}
