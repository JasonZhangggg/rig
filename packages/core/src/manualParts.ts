// Which of a PC's parts are worth a manual, and the maker and model to look
// each one up by. Pure, so the Manuals page and the server agree.

import type { ManualKind, ManualTarget } from "./manuals";
import { manualKinds } from "./manuals";
import type { PC } from "./model";

/** A detected part to find a manual for. */
export interface PartTarget extends ManualTarget {
  /**
   * Windows only knows the chip ("GeForce RTX 4070"), not the exact card
   * ("ASUS DUAL RTX 4070 OC"), and each card maker writes its own manual. The
   * screen asks the person for the card's own model before looking.
   */
  askModel?: boolean;
}

// Company names as Windows reports them, shortened to how people write them.
const makers: [RegExp, string][] = [
  [/^asus(tek)?\b/i, "ASUS"],
  [/^micro-?star|^msi\b/i, "MSI"],
  [/^gigabyte|^giga-byte/i, "Gigabyte"],
  [/^asrock/i, "ASRock"],
  [/^hewlett|^hp\b/i, "HP"],
  [/^dell\b/i, "Dell"],
  [/^lenovo\b/i, "Lenovo"],
  [/^acer\b/i, "Acer"],
  [/^razer\b/i, "Razer"],
  [/^samsung\b/i, "Samsung"],
  [/^microsoft\b/i, "Microsoft"],
  [/^biostar\b/i, "Biostar"],
  [/^evga\b/i, "EVGA"],
  [/^nvidia\b/i, "NVIDIA"],
  [/^(amd|advanced micro devices)\b/i, "AMD"],
  [/^intel\b/i, "Intel"],
];

/** "ASUSTeK COMPUTER INC." reads as "ASUS", "Micro-Star International Co., Ltd." as "MSI". Unknown names lose their company suffix. */
export function makerName(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  for (const [re, name] of makers) if (re.test(s)) return name;
  return s.replace(/,?\s+(co\.?,?\s*ltd\.?|inc\.?|corp(oration)?\.?|ltd\.?|gmbh|llc)$/i, "").trim();
}

// What firmware writes when the maker left a field empty.
const placeholder = /^(to be filled.*|system (product )?name|default string|not applicable|none|n\/a|o\.?e\.?m\.?|base ?board.*|product name|x+|0+|\s*)$/i;
const integratedGpu = /\b(uhd|iris|hd) graphics\b|^(intel\(r\) )?(arc )?graphics$|radeon\(tm\)? graphics$|^amd radeon graphics$|vega \d+ graphics|microsoft basic/i;

const real = (s: string | undefined): s is string => !!s && !placeholder.test(s.trim());

/** The label for a kind of part, like "Graphics card". */
export const kindLabel = (k: ManualKind) => manualKinds.find((x) => x.kind === k)?.label ?? "Part";

/**
 * The PC's detected parts worth a manual: the motherboard (or the laptop
 * itself) and a separate graphics card, plus a case or power supply once Rig
 * knows its model. Generic stand-ins like "Your case" are left out.
 */
export function manualTargets(pc: PC): PartTarget[] {
  const parts = pc.parts ?? {};
  const out: PartTarget[] = [];
  const add = (part: string, kind: ManualKind, maker: string | undefined, model: string | undefined, extra: Partial<PartTarget> = {}) => {
    if (!real(model)) return;
    out.push({ part, kind, maker: real(maker) ? makerName(maker) : "", model: model.trim(), source: "detected", ...extra });
  };

  if (pc.kind === "laptop") {
    const c = parts.chassis;
    add("chassis", "laptop", c?.maker, c?.model);
  } else {
    const b = parts.motherboard;
    add("motherboard", "motherboard", b?.maker, b?.model);
  }
  const g = parts.gpu;
  if (g && !integratedGpu.test(g.name)) add("gpu", "gpu", g.maker, g.model ?? g.name, { askModel: true });
  for (const [key, kind] of [["case", "case"], ["psu", "psu"], ["cooler", "cooler"]] as const) {
    const p = parts[key];
    if (p?.model) add(key, kind, p.maker, p.model);
  }
  return out;
}

/** A key for a part only the person named, like "extra:psu-corsair-rm850x". */
export function extraPartKey(kind: ManualKind, maker: string, model: string): string {
  const slug = `${kind} ${maker} ${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `extra:${slug}`;
}
