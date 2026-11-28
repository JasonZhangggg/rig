// Which of a PC's parts are worth a manual, and the maker and model to look
// each one up by. Pure, so My PC and the server agree.

import type { ManualKind, ManualTarget } from "./manuals";
import { manualKinds } from "./manuals";
import type { StillPC } from "./model";

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
 * The PC's detected parts worth a manual: the motherboard and a separate
 * graphics card (or the laptop itself), plus a case or power supply once Rig
 * knows its model. Generic stand-ins like "Your case" are left out.
 */
export function manualTargets(pc: StillPC): PartTarget[] {
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
  // A laptop's graphics chip is soldered to its board: the laptop's own manual covers it, and there's no card to name.
  const g = parts.gpu;
  if (g && pc.kind !== "laptop" && !integratedGpu.test(g.name)) add("gpu", "gpu", g.maker, g.model ?? g.name, { askModel: true });
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

// ----- Drivers and BIOS -----

/** Each graphics chip maker's own driver page. */
export const chipDriverPages: Record<string, string> = {
  NVIDIA: "https://www.nvidia.com/en-us/drivers/",
  AMD: "https://www.amd.com/en/support/download/drivers.html",
  Intel: "https://www.intel.com/content/www/us/en/support/detect.html",
};

/**
 * Laptop makers' support sites, where the drivers, BIOS and manual for a model are found by typing the model in.
 * Only landing pages, on the domains the server already trusts for each maker's manuals: a page deep inside a
 * maker's site moves too often to keep.
 */
export const laptopSupportPages: Record<string, string> = {
  ASUS: "https://www.asus.com/support/download-center/",
  Lenovo: "https://pcsupport.lenovo.com/",
  Dell: "https://www.dell.com/support/home/",
  HP: "https://support.hp.com/drivers",
  MSI: "https://www.msi.com/support",
  Gigabyte: "https://www.gigabyte.com/Support",
  Razer: "https://mysupport.razer.com/",
};

/** One row of Drivers and BIOS on the Manuals tab. */
export interface DriverRow {
  /** The part's key on My PC; "laptop" for a laptop's support site; "graphics:<chip>" for a chip with no part of its own. */
  id: string;
  /** In bold: the part, chip or laptop. */
  name: string;
  /** What the row is about: "BIOS", "Graphics driver", "Graphics card driver", "Drivers, BIOS and manual". */
  what: string;
  /** The version installed, like "Intel 32.0.101.6078" or "UX3405MA.308". */
  installed?: string;
  /** A newer version Rig knows is out. */
  latest?: string;
  /** What to ask Rig, and the button's words. */
  ask?: { label: string; question: string };
  /** Where to get it on the maker's own site. */
  link?: { label: string; href: string };
}

/** The maker of a laptop as people write it, like "ASUS" for "ASUSTeK COMPUTER INC.". */
const laptopMaker = (pc: StillPC) => makerName(pc.parts?.chassis?.maker);

/**
 * What a laptop's maker says about its graphics driver: its own build is tested on that model, so it can be the
 * safer pick than the chip maker's newer one. Missing on a desktop or a laptop with no graphics row.
 */
export function laptopDriverNote(pc: StillPC): string | null {
  if (pc.kind !== "laptop" || !(pc.parts?.gpu || pc.graphics?.length)) return null;
  const maker = laptopMaker(pc);
  return `${maker ? `${maker}'s` : "The laptop maker's"} own graphics driver is tested on this laptop, so it can be the safer pick than the newest one from the chip maker.`;
}

/**
 * Each driver and BIOS Rig read, with where to get it. A desktop lists its parts' drivers and BIOS. A laptop gets its
 * drivers from its maker, so it leads with the maker's support site for that model, then each graphics chip (the
 * processor's own graphics included, which a laptop shows no part for) and the BIOS.
 */
export function driverRows(pc: StillPC): DriverRow[] {
  const laptop = pc.kind === "laptop";
  const parts = pc.parts ?? {};
  const rows: DriverRow[] = [];

  if (laptop) {
    const c = parts.chassis;
    const maker = laptopMaker(pc);
    const model = c?.model && real(c.model) ? (c.model.toLowerCase().startsWith(maker.toLowerCase()) ? c.model : `${maker} ${c.model}`.trim()) : "";
    if (model) {
      const href = laptopSupportPages[maker];
      rows.push({
        id: "laptop", name: model, what: "Drivers, BIOS and manual",
        link: href ? { label: `${maker} support`, href } : undefined,
        ask: href ? undefined : { label: "Ask where to get them", question: `Where do I get the drivers, BIOS and manual for my ${model}?` },
      });
    }
  }

  const fromParts: DriverRow[] = Object.entries(parts).flatMap(([id, p]): DriverRow[] => {
    const d = p.driver;
    if (!d) return [];
    const isBios = d.installed.startsWith("BIOS");
    const chip = Object.keys(chipDriverPages).find((k) => d.installed.startsWith(k) || p.name.includes(k));
    return [{
      id, name: p.name,
      what: isBios ? "BIOS" : laptop && id === "gpu" ? "Graphics driver" : `${p.type} driver`,
      installed: isBios ? d.installed.replace(/^BIOS\s*/, "") : d.installed,
      latest: d.latest,
      ask: { label: "Ask if there's a newer one", question: `Is there a newer ${isBios ? "BIOS" : "driver"} for my ${p.name}? I have ${d.installed}.` },
      link: chip ? { label: `${chip} downloads`, href: chipDriverPages[chip] } : undefined,
    }];
  });
  // A desktop lists them in its parts' order.
  if (!laptop) return fromParts;

  // The processor's own graphics: a laptop shows no part for it, but its driver matters as much.
  const shown = parts.gpu?.name;
  const chips = (pc.graphics ?? []).filter((g) => g.name !== shown && !/microsoft basic/i.test(g.name)).map((g): DriverRow => {
    const installed = g.driver ? `${g.maker ?? "Driver"} ${g.driver}` : undefined;
    const href = g.maker ? chipDriverPages[g.maker] : undefined;
    return {
      id: `graphics:${g.name}`, name: g.name.replace(/\((tm|r)\)|[®™]/gi, "").replace(/\s+/g, " ").trim(), what: "Graphics driver", installed,
      ask: { label: "Ask if there's a newer one", question: `Is there a newer driver for my ${g.name}?${installed ? ` I have ${installed}.` : ""}` },
      link: href ? { label: `${g.maker} downloads`, href } : undefined,
    };
  });
  // Graphics first, the BIOS last.
  const isBios = (r: DriverRow) => r.what === "BIOS";
  return [...rows, ...fromParts.filter((r) => !isBios(r)), ...chips, ...fromParts.filter(isBios)];
}
