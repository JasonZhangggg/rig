// Real-looking PC cases from their records (core build.ts CaseShape): each known case is drawn with its own
// front, top, side glass, feet and inside, so a Fractal North reads as a North and an O11 as an O11.
//
// Tower frame, 1 unit = 100 mm: x across the case (the glass side at -x, the motherboard tray at +x),
// y up from the floor, z toward the front. Looking through the glass, the front is on the right, as on a real PC.
import * as THREE from "three";
import type { CaseShape } from "@rig/core";
import { brushed, canvasTex, decal, makeFan, mm, perforated, plainFan, rbox, rng, span, type FanLook, type Kit } from "./parts3d";

export interface CaseColors { caseColor: string; glass: string; glassOpacity: number; trim: string; fanFrame: string }

export interface CaseParts {
  /** Panels that stay put. */
  shell: THREE.Group;
  /** Top panel, front panel and glass, which move away when the PC is opened up. */
  top: THREE.Group; front: THREE.Group; glass: THREE.Group;
  /** The motherboard's surface (x), its top edge (y) and its rear edge (z). */
  surf: number; yTop: number; zBack: number;
  /** Power supply shroud top, or 0 in a dual-chamber case. */
  shroud: number;
  fan: FanLook;
}

function walnut() {
  return canvasTex("walnut", 128, 1024, (g, w, h) => {
    const r = rng(21);
    g.fillStyle = "#5a3820"; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = r() * w, wd = 1 + r() * 5, light = r() < 0.4;
      g.strokeStyle = light ? `rgba(160,110,70,${0.15 + r() * 0.25})` : `rgba(30,16,8,${0.15 + r() * 0.3})`;
      g.lineWidth = wd;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= h; y += 64) g.lineTo(x + Math.sin(y / (90 + r() * 60) + i) * (2 + r() * 5), y);
      g.stroke();
    }
    for (let i = 0; i < 6; i++) { const y = r() * h; g.fillStyle = "rgba(40,22,10,0.25)"; g.beginPath(); g.ellipse(r() * w, y, 6 + r() * 8, 18 + r() * 30, 0, 0, Math.PI * 2); g.fill(); }
  });
}

/** A perforated sheet facing +z (front panels, top vents). */
function sheet(kit: Kit, w: number, h: number, color: string, holes: { key: string; per: number; size?: number; hex?: boolean }, o: { metal?: number; rough?: number } = {}) {
  const alpha = perforated(holes.key, [Math.max(1, Math.round(w * holes.per)), Math.max(1, Math.round(h * holes.per))], holes.size ?? 0.32, holes.hex ?? true);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), kit.M(color, { alphaMap: alpha, side: THREE.DoubleSide, metal: o.metal ?? 0.3, rough: o.rough ?? 0.55 }));
  m.castShadow = true;
  return m;
}

/** Glass that keeps its reflections, framed by `border` (the printed black edge on many side panels). */
function glassPanel(kit: Kit, h: number, d: number, color: string, op: number, border = 0, borderColor = "#101113") {
  const g = new THREE.Group();
  const pane = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, d), kit.M(color, { op, glass: true }));
  g.add(pane);
  if (border > 0) {
    const b = kit.M(borderColor, { rough: 0.3, op: 0.97 });
    g.add(span(-0.008, 0.008, h / 2 - border, h / 2, -d / 2, d / 2, b, 0));
    g.add(span(-0.008, 0.008, -h / 2, -h / 2 + border, -d / 2, d / 2, b, 0));
    g.add(span(-0.008, 0.008, -h / 2, h / 2, -d / 2, -d / 2 + border, b, 0));
    g.add(span(-0.008, 0.008, -h / 2, h / 2, d / 2 - border, d / 2, b, 0));
  }
  return g;
}

export function makeCase(kit: Kit, c: CaseShape, col: CaseColors): CaseParts {
  const W = mm(c.w), H = mm(c.h), D = mm(c.d);
  const look = c.look ?? "generic";
  const dual = c.layout === "dual-chamber";
  const bodyColor = look === "generic" ? col.caseColor : c.color;
  const light = new THREE.Color(bodyColor).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
  const body = kit.M(bodyColor, { metal: look === "o11-evo" ? 0.6 : 0.25, rough: look === "o11-evo" ? 0.38 : 0.5, roughMap: look === "o11-evo" ? brushed([2, 2]) : undefined });
  const inner = kit.M(bodyColor, { metal: 0.2, rough: 0.6 });
  const shell = new THREE.Group(), top = new THREE.Group(), front = new THREE.Group(), glass = new THREE.Group();
  const surf = dual ? W / 2 - 0.95 : W / 2 - 0.24;
  const yTop = H - (dual ? 0.72 : 0.26);
  const zBack = -D / 2 + 0.12;
  const t = 0.02;

  // Steel: the right side, floor and back
  shell.add(span(W / 2 - t, W / 2, t, H - t, -D / 2, D / 2, body, 0.004));
  shell.add(span(-W / 2, W / 2, 0.05, 0.05 + t, -D / 2, D / 2, inner, 0.004));
  shell.add(span(-W / 2, W / 2, 0.05, H - t, -D / 2, -D / 2 + t, inner, 0.004));
  // Motherboard tray, with rubber grommets for the cables by the board's front edge
  shell.add(span(surf + 0.07, surf + 0.09, 0.05, H - t, -D / 2, D / 2 - 0.06, inner, 0.004));
  const grom = kit.M("#0d0d0e", { rough: 0.9 });
  for (let i = 0; i < 3; i++) shell.add(span(surf + 0.065, surf + 0.072, yTop - 1.05 - i * 0.95, yTop - 0.4 - i * 0.95, zBack + 2.56, zBack + 2.74, grom, 0.01));
  // Expansion slot covers on the back, below the rear ports
  const slotMat = kit.M(light ? "#e6e6e3" : "#2a2b2e", { metal: 0.6, rough: 0.45 });
  for (let i = 1; i < 7; i++) {
    const y = yTop - 1.58 - i * 0.2032;
    if (y < (dual ? 0.3 : 1.0)) break;
    shell.add(span(surf - 1.25, surf - 0.05, y - 0.17, y, -D / 2 + t, -D / 2 + t + 0.01, slotMat, 0.002));
  }
  // Power supply shroud
  let shroud = 0;
  if (!dual) {
    shroud = 0.95;
    const sh = span(-W / 2 + 0.03, W / 2 - t, 0.05, shroud, -D / 2 + t, D / 2 - 0.08, look === "h5-flow" ? body : inner, 0.01);
    shell.add(sh);
    if (look === "h5-flow" || look === "generic") {
      const vent = sheet(kit, 1.1, 0.5, bodyColor, { key: "shroud", per: 30, size: 0.3 });
      vent.rotation.x = -Math.PI / 2;
      vent.position.set(-0.1, shroud + 0.002, D / 2 - 0.5);
      shell.add(vent);
      shell.add(span(-0.65, 0.45, shroud - 0.001, shroud, D / 2 - 0.75, D / 2 - 0.25, kit.M("#111113", { rough: 0.9 }), 0));
    }
    if (look === "north") {
      const slit = kit.M("#0c0c0d", { rough: 0.9 });
      for (let i = 0; i < 5; i++) shell.add(span(-W / 2 + 0.003, -W / 2 + 0.03, 0.25 + i * 0.12, 0.3 + i * 0.12, D / 2 - 1.0, D / 2 - 0.2, slit, 0.01));
    }
  } else {
    // Bottom intake grill in the main chamber
    const grill = sheet(kit, W - 1.0, D - 0.2, bodyColor, { key: "o11-bottom", per: 34, size: 0.33 });
    grill.rotation.x = -Math.PI / 2;
    grill.position.set(-0.45, 0.075, 0);
    shell.add(grill);
  }

  // Feet
  if (look === "o11-evo") {
    for (const fx of [-W / 2 + 0.25, W / 2 - 0.25]) shell.add(span(fx - 0.12, fx + 0.12, 0, 0.05, -D / 2 + 0.1, D / 2 - 0.1, kit.M("#121214", { metal: 0.6, rough: 0.4 }), 0.015));
  } else if (look === "north") {
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.05, 24), kit.M("#141416", { metal: 0.5, rough: 0.4 }));
      foot.position.set(fx * (W / 2 - 0.25), 0.025, fz * (D / 2 - 0.35));
      shell.add(foot);
    }
  } else {
    for (const [fx, fz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) shell.add(span(fx * (W / 2 - 0.3) - 0.15, fx * (W / 2 - 0.3) + 0.15, 0, 0.05, fz * (D / 2 - 0.42) - 0.2, fz * (D / 2 - 0.42) + 0.2, kit.M(light ? "#dcdcd8" : "#141416", { rough: 0.7 }), 0.02));
  }

  // Top panel
  top.add(span(-W / 2, W / 2, H - t, H, -D / 2, D / 2, body, 0.006));
  if (look === "o11-evo" || look === "north" || look === "h5-flow") {
    const len = look === "o11-evo" ? D - 0.5 : D * 0.62, z0 = look === "o11-evo" ? 0 : -D / 2 + 0.2 + len / 2;
    const vent = sheet(kit, W - 0.3, len, bodyColor, { key: `top-${look}`, per: look === "o11-evo" ? 34 : 26, size: 0.34 });
    vent.rotation.x = -Math.PI / 2;
    vent.position.set(0, H + 0.003, z0);
    top.add(vent);
    top.add(span(-W / 2 + 0.15, W / 2 - 0.15, H - 0.004, H + 0.001, z0 - len / 2, z0 + len / 2, kit.M("#060607", { rough: 1 }), 0));
  }
  // Front I/O on the top front edge: power button and ports
  if (look !== "o11-evo") {
    const io = new THREE.Group();
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 32), kit.M(look === "north" ? "#b39058" : light ? "#f0f0ee" : "#202124", { metal: look === "north" ? 0.9 : 0.2, rough: 0.3 }));
    btn.position.set(-W / 2 + 0.3, H + 0.008, D / 2 - 0.2);
    io.add(btn);
    const port = kit.M("#0a0a0b", { rough: 0.8 });
    io.add(span(-W / 2 + 0.5, -W / 2 + 0.62, H - 0.001, H + 0.003, D / 2 - 0.24, D / 2 - 0.18, port, 0));
    io.add(span(-W / 2 + 0.7, -W / 2 + 0.82, H - 0.001, H + 0.003, D / 2 - 0.24, D / 2 - 0.18, port, 0));
    io.add(span(-W / 2 + 0.9, -W / 2 + 0.98, H - 0.001, H + 0.003, D / 2 - 0.24, D / 2 - 0.18, port, 0));
    top.add(io);
  } else {
    top.add(span(W / 2 - 0.15, W / 2 - 0.01, H - 0.4, H - 0.05, D / 2 - 0.06, D / 2, kit.M("#202124", { metal: 0.6, rough: 0.35 }), 0.01));
  }

  // Front
  if (look === "north") {
    // Walnut slats over a black mesh, in a black steel frame
    const back = sheet(kit, W - 0.08, H - 0.22, "#111113", { key: "north-mesh", per: 40, size: 0.3 });
    back.position.set(0, H / 2 + 0.04, D / 2 - 0.02);
    front.add(back);
    front.add(span(-W / 2, W / 2, 0.05, 0.16, D / 2 - 0.04, D / 2, body, 0.006));
    front.add(span(-W / 2, W / 2, H - 0.07, H, D / 2 - 0.04, D / 2, body, 0.006));
    for (const sx of [-1, 1]) front.add(span(sx * W / 2 - sx * 0.05, sx * W / 2, 0.05, H, D / 2 - 0.04, D / 2, body, 0.004));
    const wood = kit.M("#ffffff", { map: walnut(), rough: 0.55, clearcoat: 0.15 });
    const n = 9, slat = 0.13, gap = (W - 0.12 - n * slat) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.06 + slat / 2 + i * (slat + gap);
      front.add(rbox(slat, H - 0.25, 0.06, wood, x, H / 2 + 0.035, D / 2 + 0.01, 0.012));
    }
  } else if (look === "o11-evo") {
    // Glass front meeting the side glass with no pillar in the corner
    const pane = new THREE.Mesh(new THREE.BoxGeometry(W - 0.16, H - 0.2, 0.012), kit.M(col.glass, { op: col.glassOpacity, glass: true }));
    pane.position.set(-0.07, H / 2, D / 2 - 0.006);
    front.add(pane);
    front.add(span(-W / 2, W / 2, 0.05, 0.12, D / 2 - 0.05, D / 2, body, 0.006));
    front.add(span(W / 2 - 0.15, W / 2, 0.05, H, D / 2 - 0.05, D / 2, body, 0.006));
    const name = decal(kit, "LIAN LI", 0.05, { color: "#bfc2c6", weight: 700, spacing: 0.3 });
    name.position.set(-0.07, 0.085, D / 2 + 0.001);
    front.add(name);
  } else {
    const mesh = sheet(kit, W - 0.1, H - 0.1, bodyColor, { key: `front-${look}`, per: look === "h5-flow" ? 30 : 16, size: look === "h5-flow" ? 0.28 : 0.32 });
    mesh.position.set(0, H / 2, D / 2 + 0.005);
    front.add(mesh);
    for (const [x0, x1, y0, y1] of [[-W / 2, W / 2, 0.05, 0.1], [-W / 2, W / 2, H - 0.05, H], [-W / 2, -W / 2 + 0.05, 0.05, H], [W / 2 - 0.05, W / 2, 0.05, H]]) front.add(span(x0, x1, y0, y1, D / 2 - 0.03, D / 2 + 0.01, body, 0.006));
    if (look === "h5-flow") {
      const name = decal(kit, "NZXT", 0.06, { color: "#9a9b9d", weight: 800, spacing: 0.2 });
      name.position.set(0, 0.2, D / 2 + 0.012);
      front.add(name);
    } else {
      front.add(span(W / 2 - 0.15, W / 2 - 0.1, H * 0.09, H * 0.91, D / 2 + 0.01, D / 2 + 0.03, kit.M(kit.accent, { emissive: kit.accent, ei: 1.3 }), 0.004));
    }
  }

  // Glass side
  if (look === "o11-evo") {
    const pane = glassPanel(kit, H - 0.2, D - 0.06, col.glass, col.glassOpacity);
    pane.position.set(-W / 2 + 0.006, H / 2, -0.03);
    glass.add(pane);
    glass.add(span(-W / 2, -W / 2 + 0.05, 0.05, 0.12, -D / 2, D / 2, body, 0.006));
    glass.add(span(-W / 2, -W / 2 + 0.05, H - 0.1, H, -D / 2, D / 2, body, 0.006));
  } else {
    const pane = glassPanel(kit, H - 0.12, D - 0.12, look === "north" ? "#3a3d42" : col.glass, look === "north" ? 0.28 : col.glassOpacity, look === "north" ? 0.08 : 0, bodyColor);
    pane.position.set(-W / 2 + 0.006, H / 2 + 0.02, 0);
    glass.add(pane);
    // The steel edge round the glass
    glass.add(span(-W / 2, -W / 2 + t, 0.05, 0.1, -D / 2, D / 2, body, 0.004));
    glass.add(span(-W / 2, -W / 2 + t, H - 0.04, H, -D / 2, D / 2, body, 0.004));
    glass.add(span(-W / 2, -W / 2 + t, 0.05, H, -D / 2, -D / 2 + 0.05, body, 0.004));
  }

  const fan: FanLook = look === "h5-flow" ? { ...plainFan("#ebebe9", "#f2f2f0"), blades: 7 }
    : look === "north" ? plainFan("#17181a", "#1d1e20")
    : look === "o11-evo" ? { ...plainFan("#141517", "#1a1b1d"), rgb: kit.accent }
    : { ...plainFan(col.fanFrame), rgb: kit.accent };
  return { shell, top, front, glass, surf, yTop, zBack, shroud, fan };
}

/** A power supply: matte black with a fan grille underneath. */
export function makePsu(kit: Kit, w: number, h: number, d: number) {
  const g = new THREE.Group();
  g.add(rbox(w, h, d, kit.M("#17181a", { metal: 0.3, rough: 0.55 }), 0, 0, 0, 0.02));
  const grille = new THREE.Mesh(new THREE.CircleGeometry(Math.min(w, d) * 0.42, 48), kit.M("#0b0b0c", { alphaMap: perforated("psu", [12, 12], 0.36, true), side: THREE.DoubleSide, metal: 0.6, rough: 0.4 }));
  grille.rotation.x = Math.PI / 2;
  grille.position.y = -h / 2 - 0.002;
  g.add(grille);
  return g;
}

export { makeFan };
