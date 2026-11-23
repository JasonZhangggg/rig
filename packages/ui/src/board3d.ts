// A real-looking motherboard built from its layout record (core build.ts BoardShape): a printed circuit
// board with its traces, silkscreen names and mounting holes, and every slot, header, heatsink and
// connector drawn as the part it is. Used by the board view and, lighter, inside the tower.
//
// Board frame (see parts3d.ts): X = u / 100 (rear edge to front edge), Y = -v / 100 (top edge down),
// Z up from the board's surface.
import * as THREE from "three";
import type { BoardItem, BoardShape } from "@rig/core";
import { brushed, canvasTex, decal, rbox, rng, span, type Kit, type MatOpts } from "./parts3d";

export const PITCH = 0.0254; // 2.54 mm between header pins

export interface BoardNode {
  item: BoardItem;
  group: THREE.Group;
  /** Every material the item uses, so the view can light or dim it. */
  mats: THREE.Material[];
  /** Pin meshes by pin index (grid order), for headers with bare pins. */
  pins: (THREE.Mesh | null)[];
  /** Where each pin sits, in the item's own frame. */
  pinAt: THREE.Vector3[];
  /** Height of the item's top above the board. */
  top: number;
}

/** The number printed for a pin. Two-row headers count across the rows, odd pins in the first row (1, 3, 5 over 2, 4, 6). */
export function pinNumber(item: BoardItem, i: number) {
  const { cols, rows } = item.pins!;
  const r = Math.floor(i / cols), c = i % cols;
  return rows === 2 ? c * 2 + r + 1 : i + 1;
}

/** Headers whose pins sit inside a plastic housing (power plugs, the 19-pin USB 3 header) rather than bare. */
export const housed = (it: BoardItem) => it.kind === "power" || it.kind === "sata" || (it.kind === "usb" && !!it.pins && it.pins.cols * it.pins.rows >= 19);

// ---------- the printed circuit board ----------
type Rect = { u: number; v: number; w: number; h: number };
const inside = (r: Rect, u: number, v: number, pad = 0) => u > r.u - pad && u < r.u + r.w + pad && v > r.v - pad && v < r.v + r.h + pad;

/** Where the ATX standoffs go for this board, kept clear of anything on it. */
export function mountHoles(board: BoardShape): [number, number][] {
  const us = [6, board.w * 0.5, board.w - 6], vs = [10, board.h * 0.54, board.h - 10];
  const out: [number, number][] = [];
  for (const u of us) for (const v of vs) {
    let pu = u, pv = v;
    for (let k = 0; k < 12 && board.items.some((it) => inside(it, pu, pv, 4)); k++) { pv += 4; pu += k % 2 ? -3 : 3; }
    if (!board.items.some((it) => inside(it, pu, pv, 4))) out.push([pu, pv]);
  }
  return out;
}

function pcbTexture(board: BoardShape, ppm: number) {
  return canvasTex(`pcb-${board.model}-${ppm}`, Math.round(board.w * ppm), Math.round(board.h * ppm), (g, W, H) => {
    const P = (mmv: number) => mmv * ppm;
    const r = rng(11);
    g.fillStyle = board.color; g.fillRect(0, 0, W, H);
    // Weave of the board material, barely there
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.018})`; g.fillRect(r() * W, r() * H, P(0.6), P(0.6)); }
    const clear = (u: number, v: number, pad = 1.5) => !board.items.some((it) => inside(it, u, v, pad)) && u > 2 && v > 2 && u < board.w - 2 && v < board.h - 2;

    // Copper traces under the solder mask: bundles between the big parts, short runs elsewhere
    g.strokeStyle = "rgba(255,255,255,0.055)"; g.lineWidth = P(0.25); g.lineCap = "round";
    const at = (id: string) => board.items.find((i) => i.id === id);
    const bundle = (u0: number, v0: number, u1: number, v1: number, n: number, gap: number, vertical: boolean) => {
      for (let k = 0; k < n; k++) {
        const o = (k - n / 2) * gap;
        g.beginPath();
        if (vertical) { g.moveTo(P(u0 + o), P(v0)); g.lineTo(P(u0 + o), P((v0 + v1) / 2 - Math.abs(u1 - u0) / 2)); g.lineTo(P(u1 + o), P((v0 + v1) / 2 + Math.abs(u1 - u0) / 2)); g.lineTo(P(u1 + o), P(v1)); }
        else { g.moveTo(P(u0), P(v0 + o)); g.lineTo(P((u0 + u1) / 2 - Math.abs(v1 - v0) / 2), P(v0 + o)); g.lineTo(P((u0 + u1) / 2 + Math.abs(v1 - v0) / 2), P(v1 + o)); g.lineTo(P(u1), P(v1 + o)); }
        g.stroke();
      }
    };
    const sock = at("socket"), dimm = board.items.find((i) => i.kind === "dimm"), pcie = at("pcie1"), chip = at("chipset");
    if (sock && dimm) bundle(sock.u + sock.w, sock.v + sock.h * 0.5, dimm.u - 1, dimm.v + 40, 36, 0.7, false);
    if (sock && pcie) bundle(sock.u + sock.w * 0.5, sock.v + sock.h, pcie.u + pcie.w * 0.55, pcie.v - 1, 28, 0.7, true);
    if (sock) bundle(sock.u + 4, sock.v + sock.h, sock.u - 20, sock.v + sock.h + 30, 14, 0.7, true);
    if (chip) { bundle(chip.u + chip.w, chip.v + 10, board.w - 14, chip.v + 30, 16, 0.7, false); bundle(chip.u, chip.v + 30, chip.u - 18, chip.v + 50, 14, 0.7, false); }
    for (let i = 0; i < 520; i++) {
      let u = r() * board.w, v = r() * board.h;
      if (!clear(u, v, 2)) continue;
      g.beginPath(); g.moveTo(P(u), P(v));
      const horiz = r() < 0.5;
      const l1 = 4 + r() * 18, j = 1.5 + r() * 4, dir = r() < 0.5 ? -1 : 1, dir2 = r() < 0.5 ? -1 : 1;
      if (horiz) { u += l1 * dir; g.lineTo(P(u), P(v)); u += j * dir; v += j * dir2; } else { v += l1 * dir; g.lineTo(P(u), P(v)); v += j * dir; u += j * dir2; }
      g.lineTo(P(u), P(v));
      if (horiz) u += (3 + r() * 10) * dir; else v += (3 + r() * 10) * dir;
      if (clear(u, v, 1)) { g.lineTo(P(u), P(v)); g.stroke(); g.fillStyle = "rgba(255,255,255,0.08)"; g.beginPath(); g.arc(P(u), P(v), P(0.45), 0, Math.PI * 2); g.fill(); }
    }
    // Small surface-mounted parts in the open areas
    for (let i = 0; i < 900; i++) {
      const u = r() * board.w, v = r() * board.h;
      if (!clear(u, v, 1.2)) continue;
      const big = r() < 0.08, w = big ? 1.6 : 0.9 + r() * 0.6, h = big ? 0.8 : 0.45 + r() * 0.2, rot = r() < 0.5;
      g.fillStyle = r() < 0.7 ? "#3a3530" : "#58534a";
      g.fillRect(P(u), P(v), P(rot ? h : w), P(rot ? w : h));
      g.fillStyle = "rgba(205,205,200,0.6)";
      g.fillRect(P(u), P(v), P(rot ? h : 0.2), P(rot ? 0.2 : h));
      g.fillRect(P(u + (rot ? 0 : w - 0.2)), P(v + (rot ? w - 0.2 : 0)), P(rot ? h : 0.2), P(rot ? 0.2 : h));
    }
    // A few chips with their legs
    for (let i = 0, made = 0; i < 300 && made < 7; i++) {
      const u = r() * board.w, v = r() * board.h, s = 5 + r() * 4;
      if (![[u, v], [u + s, v], [u, v + s], [u + s, v + s]].every(([a, b]) => clear(a, b, 2))) continue;
      made++;
      g.fillStyle = "rgba(205,205,200,0.55)";
      for (let k = 0.8; k < s - 0.5; k += 0.65) { g.fillRect(P(u - 0.6), P(v + k), P(s + 1.2), P(0.25)); g.fillRect(P(u + k), P(v - 0.6), P(0.25), P(s + 1.2)); }
      g.fillStyle = "#151617"; g.fillRect(P(u), P(v), P(s), P(s));
      g.fillStyle = "rgba(255,255,255,0.25)"; g.beginPath(); g.arc(P(u + 1), P(v + 1), P(0.4), 0, Math.PI * 2); g.fill();
    }
    // Printed accent lines in the maker's style
    g.strokeStyle = "rgba(150,155,162,0.22)"; g.lineCap = "butt";
    for (const [a, b, c, d, wdt] of [[board.w * 0.55, board.h, board.w, board.h * 0.78, 5], [board.w * 0.62, board.h, board.w, board.h * 0.83, 1.5], [0, board.h * 0.62, board.w * 0.12, board.h * 0.55, 2]]) {
      g.lineWidth = P(wdt); g.beginPath(); g.moveTo(P(a), P(b)); g.lineTo(P(c), P(d)); g.stroke();
    }

    // Silkscreen: outlines round headers and slots, pin 1 marks, printed names
    const silk = "rgba(222,225,228,0.82)";
    g.strokeStyle = silk; g.fillStyle = silk; g.lineWidth = P(0.28);
    g.font = `700 ${P(2.1)}px Arial, Helvetica, sans-serif`;
    g.textBaseline = "middle";
    for (const it of board.items) {
      if (["heatsink", "chipset", "io", "m2", "socket"].includes(it.kind)) continue;
      const m = 0.9;
      g.strokeRect(P(it.u - m), P(it.v - m), P(it.w + m * 2), P(it.h + m * 2));
      if (it.pins) {
        g.beginPath(); g.moveTo(P(it.u - m - 1.4), P(it.v - m)); g.lineTo(P(it.u - m - 1.4), P(it.v - m + 1.6)); g.lineTo(P(it.u - m - 0.2), P(it.v - m)); g.closePath(); g.fill();
      }
      if (!it.name || it.kind === "dimm") continue;
      const tw = g.measureText(it.name).width / ppm;
      let tu = it.u, tv = it.v + it.h + 3;
      if (tv > board.h - 2) tv = it.v - 3;
      if (tu + tw > board.w - 1) tu = board.w - 1 - tw;
      if (it.kind === "pcie") { tu = it.u; tv = it.v - 3; }
      g.fillText(it.name, P(tu), P(tv));
    }
    for (const it of board.items.filter((i) => i.kind === "dimm")) {
      g.save(); g.translate(P(it.u + it.w / 2), P(it.v + it.h + 4)); g.rotate(-Math.PI / 2);
      g.textAlign = "right"; g.fillText(`DIMM${it.name}`, 0, 0); g.restore();
    }
    // Mounting holes: plated rings round each standoff
    for (const [u, v] of mountHoles(board)) {
      g.fillStyle = "#b9b4a1"; g.beginPath(); g.arc(P(u), P(v), P(3.6), 0, Math.PI * 2); g.fill();
      g.fillStyle = "#0c0c0d"; g.beginPath(); g.arc(P(u), P(v), P(1.8), 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = P(0.3);
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.beginPath(); g.arc(P(u + Math.cos(a) * 2.7), P(v + Math.sin(a) * 2.7), P(0.35), 0, Math.PI * 2); g.stroke(); }
    }
  });
}

// ---------- the parts on it ----------
function holeGrid(cols: number, rows: number, color: string) {
  return canvasTex(`holes-${cols}x${rows}-${color}`, cols * 32, rows * 32, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = "#050505";
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { g.beginPath(); g.roundRect(c * 32 + 7, r * 32 + 7, 18, 18, 3); g.fill(); }
  });
}

/** Sockets on an SSD-style heatsink top: angled grooves and a label. */
function m2Art(name: string) {
  return canvasTex(`m2-${name}`, 640, 180, (g, w, h) => {
    g.fillStyle = "#7d8187"; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.06})`; g.fillRect(0, r() * h, w, 1); }
    g.fillStyle = "rgba(20,21,23,0.75)";
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(w * 0.52 + k * 34, h); g.lineTo(w * 0.6 + k * 34, 0); g.lineTo(w * 0.6 + k * 34 + 14, 0); g.lineTo(w * 0.52 + k * 34 + 14, h); g.fill(); }
    g.fillStyle = "rgba(25,26,28,0.85)"; g.font = "800 58px Arial, Helvetica, sans-serif"; g.textBaseline = "middle";
    g.fillText(name.replace("_", " "), 40, h / 2);
  });
}

function chipsetArt(model: string) {
  const name = /TOMAHAWK/i.test(model) ? "TOMAHAWK" : model.split(" ").slice(-1)[0] ?? "";
  return canvasTex(`chipset-${model}`, 512, 460, (g, w, h) => {
    g.fillStyle = "#3d4045"; g.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(0, r() * h, w, 1); }
    g.fillStyle = "#24262a";
    g.beginPath(); g.moveTo(0, h * 0.62); g.lineTo(w, h * 0.3); g.lineTo(w, h * 0.5); g.lineTo(0, h * 0.82); g.fill();
    g.fillStyle = "#8a8f96";
    g.beginPath(); g.moveTo(0, h * 0.84); g.lineTo(w, h * 0.52); g.lineTo(w, h * 0.55); g.lineTo(0, h * 0.87); g.fill();
    g.fillStyle = "rgba(232,234,237,0.92)"; g.font = "italic 800 64px Arial, Helvetica, sans-serif"; g.textBaseline = "middle";
    g.fillText(name, 34, h * 0.24);
    g.fillStyle = "rgba(232,234,237,0.5)"; g.font = "700 30px Arial, Helvetica, sans-serif";
    g.fillText("MAG SERIES", 36, h * 0.38);
  });
}

function sataFace() {
  return canvasTex("sata-face", 256, 256, (g, w, h) => {
    g.fillStyle = "#1a1b1d"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#050505";
    for (const [x, y] of [[20, 24], [20, 140], [136, 24], [136, 140]]) {
      g.fillRect(x, y, 100, 80);
      g.fillStyle = "#1a1b1d"; g.fillRect(x + 14, y + 30, 70, 14); g.fillRect(x + 14, y + 30, 14, 34); g.fillStyle = "#050505";
    }
  });
}

/**
 * The board and every part on it. `pins` draws each header pin (the board view); without it headers are
 * drawn as their plastic bases only (the tower, where pins are too small to see).
 */
export function makeBoard(kit: Kit, board: BoardShape, o: { pins?: boolean; ppm?: number } = {}) {
  const group = new THREE.Group();
  const BW = board.w / 100, BH = board.h / 100;
  const pcbMat = kit.M(board.color, { rough: 0.55, metal: 0.05 });
  const pcb = span(0, BW, -BH, 0, -0.016, 0, pcbMat, 0.003);
  group.add(pcb);
  const art = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), kit.M("#ffffff", { map: pcbTexture(board, o.ppm ?? 7), rough: 0.62, metal: 0.05, envI: 0.35 }));
  art.position.set(BW / 2, -BH / 2, 0.0006);
  art.receiveShadow = true;
  group.add(art);

  const nodes: BoardNode[] = [];
  for (const it of board.items) {
    const g = new THREE.Group();
    const W = it.w / 100, H = it.h / 100;
    g.position.set((it.u + it.w / 2) / 100, -(it.v + it.h / 2) / 100, 0);
    const mats: THREE.Material[] = [];
    const M = (c: THREE.ColorRepresentation, op?: MatOpts) => { const m = kit.M(c, op); mats.push(m); return m; };
    const node: BoardNode = { item: it, group: g, mats, pins: [], pinAt: [], top: 0.05 };
    const black = () => M("#141517", { rough: 0.6 });
    switch (it.kind) {
      case "io": {
        const shape = new THREE.Shape([[-W / 2, -H / 2], [W / 2, -H / 2 + 0.12], [W / 2, H / 2], [-W / 2, H / 2]].map(([x, y]) => new THREE.Vector2(x, y)));
        const cover = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 }), M("#2c2e32", { metal: 0.55, rough: 0.42, roughMap: brushed([1, 3]) }));
        cover.castShadow = true;
        g.add(cover);
        g.add(span(-W / 2 + 0.02, W / 2 - 0.02, -H / 2 + 0.2, H / 2 - 0.04, 0.3, 0.312, M("#8b9097", { metal: 0.9, rough: 0.3 }), 0.003));
        const t = decal({ ...kit, M }, /TOMAHAWK/i.test(board.model) ? "TOMAHAWK" : "", 0.12, { color: "#1c1d20", weight: 800, italic: true, spacing: 0.08 });
        t.rotation.z = Math.PI / 2;
        t.position.set(0, 0.1, 0.314);
        g.add(t);
        if (!kit.lite) {
          // Rear ports sticking out past the board's edge
          const ports: [number, number, string][] = [[0.1, 0.2, "#d7d9dc"], [0.38, 0.14, "#2f6fd6"], [0.58, 0.14, "#d63a3a"], [0.78, 0.16, "#b9bcc0"], [1.0, 0.14, "#2f6fd6"], [1.24, 0.24, "#e2c35a"]];
          for (const [y, h, c] of ports) g.add(span(-W / 2 - 0.08, -W / 2 + 0.02, H / 2 - y - h, H / 2 - y, 0.02, 0.18, M(c, { metal: c === "#e2c35a" ? 0.9 : 0.3, rough: 0.4 }), 0.004));
        }
        node.top = 0.32;
        break;
      }
      case "heatsink": {
        const along = W >= H;
        const body = M("#34373c", { metal: 0.75, rough: 0.38, roughMap: brushed([2, 1]) });
        g.add(rbox(W, H, 0.12, body, 0, 0, 0.06, 0.01));
        const fins: THREE.Vector3[] = [];
        const len = along ? W : H, n = Math.floor((len - 0.04) / 0.032);
        for (let k = 0; k < n; k++) { const p = -len / 2 + 0.03 + k * 0.032; fins.push(along ? new THREE.Vector3(p, 0, 0.185) : new THREE.Vector3(0, p, 0.185)); }
        const fin = new THREE.BoxGeometry(along ? 0.012 : W - 0.02, along ? H - 0.02 : 0.012, 0.13);
        const im = new THREE.InstancedMesh(fin, body, fins.length);
        const mtx = new THREE.Matrix4();
        fins.forEach((p, i) => im.setMatrixAt(i, mtx.makeTranslation(p.x, p.y, p.z)));
        im.castShadow = true;
        g.add(im);
        g.add(span(along ? -W / 2 : -W / 2 - 0.003, along ? W / 2 : -W / 2 + 0.03, along ? H / 2 - 0.03 : -H / 2, along ? H / 2 + 0.003 : H / 2, 0.12, 0.255, M("#8b9097", { metal: 0.9, rough: 0.3 }), 0.004));
        node.top = 0.25;
        break;
      }
      case "socket": {
        const frame = M("#c7cacf", { metal: 1, rough: 0.28, roughMap: brushed([1, 1]) });
        g.add(span(-W / 2, W / 2, -H / 2, -H / 2 + 0.05, 0, 0.03, frame, 0.004));
        g.add(span(-W / 2, W / 2, H / 2 - 0.05, H / 2, 0, 0.03, frame, 0.004));
        g.add(span(-W / 2, -W / 2 + 0.05, -H / 2, H / 2, 0, 0.03, frame, 0.004));
        g.add(span(W / 2 - 0.05, W / 2, -H / 2, H / 2, 0, 0.03, frame, 0.004));
        // The processor's heat spreader, with the notches on its sides
        const s = new THREE.Shape();
        const a = W / 2 - 0.05, b = H / 2 - 0.05, n = 0.025;
        s.moveTo(-a, -b); s.lineTo(a, -b);
        for (const y of [-0.1, 0.06]) { s.lineTo(a, y); s.lineTo(a - n, y); s.lineTo(a - n, y + 0.05); s.lineTo(a, y + 0.05); }
        s.lineTo(a, b); s.lineTo(-a, b);
        for (const y of [0.06, -0.1]) { s.lineTo(-a, y + 0.05); s.lineTo(-a + n, y + 0.05); s.lineTo(-a + n, y); s.lineTo(-a, y); }
        const ihs = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 }), M("#d6d8db", { metal: 1, rough: 0.22, roughMap: brushed([2, 2]) }));
        ihs.position.z = 0.01;
        ihs.castShadow = true;
        g.add(ihs);
        // Load lever along the left side
        const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, H + 0.06, 8), frame);
        lever.position.set(-W / 2 - 0.03, 0.02, 0.025);
        g.add(lever);
        g.add(span(-W / 2 - 0.05, -W / 2 - 0.01, H / 2 + 0.02, H / 2 + 0.06, 0.01, 0.04, frame, 0.004));
        node.top = 0.06;
        break;
      }
      case "dimm": {
        const body = black();
        g.add(span(-W / 2, W / 2, -H / 2, H / 2, 0, 0.075, body, 0.004));
        g.add(span(-0.009, 0.009, -H / 2 + 0.06, H / 2 - 0.06, 0.07, 0.0765, M("#050506", { rough: 0.9 }), 0));
        g.add(span(-W / 2 - 0.006, W / 2 + 0.006, H / 2 - 0.02, H / 2 + 0.06, 0.0, 0.1, M("#2a2c2f", { rough: 0.5 }), 0.006));
        g.add(span(-W / 2, W / 2, -H / 2 - 0.02, -H / 2 + 0.02, 0, 0.085, body, 0.004));
        node.top = 0.1;
        break;
      }
      case "pcie": {
        const long = W > 0.5;
        g.add(span(-W / 2, W / 2, -H / 2, H / 2, 0, 0.11, black(), 0.004));
        g.add(span(-W / 2 + 0.04, W / 2 - 0.04, -0.01, 0.01, 0.105, 0.112, M("#050506", { rough: 0.9 }), 0));
        if (it.id === "pcie1" && long) {
          // Steel armor round the graphics card slot
          const steel = M("#c3c6cb", { metal: 1, rough: 0.3, roughMap: brushed([4, 1]) });
          g.add(span(-W / 2 - 0.01, W / 2 + 0.01, H / 2 - 0.012, H / 2 + 0.006, 0, 0.12, steel, 0.003));
          g.add(span(-W / 2 - 0.01, W / 2 + 0.01, -H / 2 - 0.006, -H / 2 + 0.012, 0, 0.12, steel, 0.003));
        }
        if (long) g.add(span(W / 2 - 0.01, W / 2 + 0.07, -H / 2 - 0.01, H / 2 + 0.01, 0, 0.13, M("#2a2c2f", { rough: 0.5 }), 0.006));
        node.top = 0.13;
        break;
      }
      case "m2": {
        const top = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.02), M("#ffffff", { map: m2Art(it.name), metal: 0.85, rough: 0.35 }));
        g.add(rbox(W, H, 0.045, M("#5e6268", { metal: 0.85, rough: 0.35 }), 0, 0, 0.0225, 0.01));
        top.position.z = 0.0458;
        g.add(top);
        for (const sx of [-1, 1]) {
          const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 16), M("#cfd2d6", { metal: 1, rough: 0.3 }));
          screw.rotation.x = Math.PI / 2; screw.position.set(sx * (W / 2 - 0.04), 0, 0.05);
          g.add(screw);
        }
        node.top = 0.06;
        break;
      }
      case "chipset": {
        g.add(rbox(W, H, 0.09, M("#3d4045", { metal: 0.8, rough: 0.38 }), 0, 0, 0.045, 0.012));
        const top = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.02, H - 0.02), M("#ffffff", { map: chipsetArt(board.model), metal: 0.8, rough: 0.38 }));
        top.position.z = 0.0905;
        g.add(top);
        node.top = 0.1;
        break;
      }
      case "sata": {
        g.add(span(-W / 2, W / 2, -H / 2, H / 2, 0, 0.14, M("#1a1b1d", { rough: 0.6 }), 0.005));
        const face = new THREE.Mesh(new THREE.PlaneGeometry(H - 0.01, 0.13), M("#ffffff", { map: sataFace(), rough: 0.6 }));
        face.rotation.set(Math.PI / 2, Math.PI / 2, 0);
        face.position.set(W / 2 + 0.001, 0, 0.07);
        g.add(face);
        node.top = 0.14;
        break;
      }
      default: {
        const p = it.pins;
        if (housed(it) && p) {
          // A plastic housing with a socket for each pin
          const color = it.kind === "usb" ? "#2c5aa8" : "#16171a";
          const housing = M(color, { rough: 0.55 });
          const hh = it.kind === "power" ? 0.12 : 0.09;
          g.add(span(-W / 2, W / 2, -H / 2, H / 2, 0, hh, housing, 0.005));
          const across = p.cols <= p.rows; // the 24-pin stands on end
          const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.012, H - 0.012), M("#ffffff", { map: holeGrid(across ? p.cols : p.cols, across ? p.rows : p.rows, color), rough: 0.6 }));
          face.position.z = hh + 0.0008;
          g.add(face);
          if (it.kind === "power") g.add(span(W / 2, W / 2 + 0.018, -0.04, 0.04, 0.03, hh - 0.01, housing, 0.003));
          node.top = hh;
        } else if (it.id === "jusb-c") {
          g.add(span(-W / 2, W / 2, -H / 2, H / 2, 0, 0.1, M("#16171a", { rough: 0.55 }), 0.006));
          g.add(span(-0.012, 0.012, -H / 2 + 0.01, H / 2 - 0.01, 0.098, 0.102, M("#050505", { rough: 0.9 }), 0));
          node.top = 0.1;
        } else if (p) {
          // Bare header pins on a black base; fan headers have a wall on one side
          const cols = p.cols, rows = p.rows;
          const bw = cols * PITCH + 0.004, bh = rows * PITCH + 0.004;
          g.add(span(-bw / 2, bw / 2, -bh / 2, bh / 2, 0, 0.025, black(), 0.003));
          if (it.kind === "fan") {
            const wall = M("#f1f1ee", { rough: 0.55 });
            if (rows === 1) { g.add(span(-bw / 2, bw / 2, bh / 2, bh / 2 + 0.008, 0, 0.075, wall, 0.002)); g.add(span(-bw / 2, bw / 2, -bh / 2 - 0.004, bh / 2, 0, 0.026, wall, 0.002)); }
            else { g.add(span(bw / 2, bw / 2 + 0.008, -bh / 2, bh / 2, 0, 0.075, wall, 0.002)); g.add(span(-bw / 2 - 0.004, bw / 2, -bh / 2, bh / 2, 0, 0.026, wall, 0.002)); }
          }
          const missing = p.missing ?? [];
          const gold = M("#d6b35e", { metal: 1, rough: 0.28 });
          const pinGeo = new THREE.BoxGeometry(0.0064, 0.0064, 0.062);
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const at = new THREE.Vector3((c - (cols - 1) / 2) * PITCH, ((rows - 1) / 2 - r) * PITCH, 0.056);
            node.pinAt.push(at);
            if (missing.includes(i) || !o.pins) { node.pins.push(null); continue; }
            const pin = new THREE.Mesh(pinGeo, gold);
            pin.position.copy(at);
            pin.castShadow = true;
            pin.userData.pin = i;
            g.add(pin);
            node.pins.push(pin);
          }
          node.top = o.pins ? 0.088 : 0.03;
        } else {
          g.add(span(-W / 2, W / 2, -H / 2, H / 2, 0, 0.04, black(), 0.003));
        }
      }
    }
    g.traverse((m) => { if (m instanceof THREE.Mesh) m.userData.id = it.id; });
    group.add(g);
    nodes.push(node);
  }

  // Parts that aren't slots or headers: power stage chokes and capacitors by the socket, audio capacitors,
  // the clock battery. They make it read as a real board but can't be picked.
  const deco = new THREE.Group();
  const at = (id: string) => board.items.find((i) => i.id === id);
  const chokes: THREE.Vector3[] = [], caps: THREE.Vector3[] = [];
  const top = at("vrm-top"), left = at("vrm-left");
  if (top) for (let u = top.u + 5; u < top.u + top.w - 4; u += 9) { chokes.push(new THREE.Vector3(u / 100, -(top.v + top.h + 5) / 100, 0.028)); caps.push(new THREE.Vector3(u / 100, -(top.v + top.h + 12) / 100, 0.035)); }
  if (left) for (let v = left.v + 6; v < left.v + left.h - 4; v += 9) { chokes.push(new THREE.Vector3((left.u + left.w + 5) / 100, -v / 100, 0.028)); caps.push(new THREE.Vector3((left.u + left.w + 12) / 100, -v / 100, 0.035)); }
  const occupied = (p: THREE.Vector3) => board.items.some((it) => inside(it, p.x * 100, -p.y * 100, 3));
  const put = (pts: THREE.Vector3[], geo: THREE.BufferGeometry, mat: THREE.Material, rx = 0) => {
    const ok = pts.filter((p) => !occupied(p));
    if (!ok.length) return;
    const im = new THREE.InstancedMesh(geo, mat, ok.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0));
    ok.forEach((p, i) => im.setMatrixAt(i, m4.compose(p, q, new THREE.Vector3(1, 1, 1))));
    im.castShadow = true;
    deco.add(im);
  };
  put(chokes, new THREE.BoxGeometry(0.075, 0.075, 0.056), kit.M("#4b4e53", { metal: 0.6, rough: 0.5 }));
  put(caps, new THREE.CylinderGeometry(0.026, 0.026, 0.07, 16), kit.M("#1c1d20", { metal: 0.4, rough: 0.4 }), Math.PI / 2);
  const audio: THREE.Vector3[] = [];
  for (const [u, v] of [[12, 262], [22, 262], [32, 262], [12, 276], [22, 276], [32, 276]]) if (v < board.h - 10) audio.push(new THREE.Vector3(u / 100, -v / 100, 0.045));
  put(audio, new THREE.CylinderGeometry(0.032, 0.032, 0.09, 18), kit.M("#a8843a", { metal: 0.6, rough: 0.45 }), Math.PI / 2);
  const bat = new THREE.Vector3(1.2, -2.68, 0.016);
  if (board.h > 280 && !occupied(bat)) {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.032, 40), kit.M("#d3d5d8", { metal: 1, rough: 0.25 }));
    coin.rotation.x = Math.PI / 2; coin.position.copy(bat);
    deco.add(coin);
  }
  group.add(deco);
  return { group, nodes, pcb };
}
