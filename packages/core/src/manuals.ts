// Manuals: the maker's own manual for each part, kept with the PC, searchable,
// with the pages that hold the useful diagrams marked, and quoted by page in
// the chat. The shapes here are shared by the server, the clients and the
// screens.
//
// How a manual gets here:
// 1. The person asks to find one from the part's Manual tab on My PC.
//    The server looks it up on the maker's site and records the PDF's address.
// 2. The app downloads the PDF through the server, keeps a copy on the device,
//    reads its text page by page (pdf.js) and marks the diagram pages.
// 3. It sends the page text back, so search and the chat work everywhere the
//    account is signed in. A PDF the person adds from their own files is read
//    the same way; its file stays on the device it was added on.

/** The kinds of part Rig finds manuals for. */
export type ManualKind = "motherboard" | "laptop" | "gpu" | "case" | "psu" | "cooler" | "memory" | "monitor" | "storage" | "other";

export const manualKinds: { kind: ManualKind; label: string }[] = [
  { kind: "motherboard", label: "Motherboard" },
  { kind: "laptop", label: "Laptop" },
  { kind: "gpu", label: "Graphics card" },
  { kind: "case", label: "Case" },
  { kind: "psu", label: "Power supply" },
  { kind: "cooler", label: "CPU cooler" },
  { kind: "memory", label: "Memory" },
  { kind: "monitor", label: "Monitor" },
  { kind: "storage", label: "Drive" },
  { kind: "other", label: "Other" },
];

/** A part Rig can look a manual up for: one it detected, or one the person typed in (case, power supply, cooler…). */
export interface ManualTarget {
  /** Key of PC.parts it belongs to ("motherboard", "board", "chassis", "gpu", "case", "psu"…), or "extra:<slug>" for one only the person named. */
  part: string;
  kind: ManualKind;
  /** The maker, as people write it: "ASUS", "MSI", "Corsair". */
  maker: string;
  /** The exact model: "ROG STRIX B650-A GAMING WIFI". */
  model: string;
  source: "detected" | "added";
}

/** What a diagram page shows. Found from the page's words (see findDiagrams). */
export type DiagramKind =
  | "board-layout" | "front-panel" | "fan-headers" | "memory-slots" | "m2-slots" | "rear-io"
  | "power-connectors" | "rgb-headers" | "usb-headers" | "dimensions" | "installation" | "specs";

export interface ManualDiagram {
  /** 1-based page number. */
  page: number;
  kind: DiagramKind;
  /** Plain words for the person, like "Board layout" or "Front panel header". */
  label: string;
}

/** The text of one page, 1-based. */
export interface ManualPage { n: number; text: string }

export interface Manual {
  id: string;
  machineId: string;
  /** Same as ManualTarget.part. */
  part: string;
  kind: ManualKind;
  maker: string;
  model: string;
  /** Like "ROG STRIX B650-A GAMING WIFI user manual". */
  title: string;
  /** The PDF's address on the maker's site. Missing for a file the person added. */
  url?: string;
  /** The maker site it came from, like "dlcdnets.asus.com". */
  host?: string;
  source: "found" | "added";
  /** Set once the pages have been read. */
  pageCount?: number;
  /** Page text is saved, so search and the chat can use it. */
  indexed: boolean;
  diagrams: ManualDiagram[];
  /** ISO time. */
  addedAt: string;
  bytes?: number;
}

/** One search result: a page and the words around the match. */
export interface ManualHit {
  manualId: string;
  title: string;
  part: string;
  page: number;
  /** About 200 characters around the match. Matched words are wrapped in « and ». */
  snippet: string;
}

/** Where a chat source or a link points when it opens a manual page inside Rig. */
export const manualLink = (manualId: string, page?: number) => `rig:manual/${encodeURIComponent(manualId)}${page ? `#page=${page}` : ""}`;

/** Reads a link made by manualLink. */
export function parseManualLink(url: string | undefined): { manualId: string; page?: number } | null {
  const m = url && /^rig:manual\/([^#]+)(?:#page=(\d+))?$/.exec(url);
  return m ? { manualId: decodeURIComponent(m[1]), page: m[2] ? Number(m[2]) : undefined } : null;
}

/** Largest manual Rig downloads or accepts, in bytes. */
export const MANUAL_MAX_BYTES = 60 * 1024 * 1024;
/** Most pages Rig keeps text for. */
export const MANUAL_MAX_PAGES = 600;
/** Most characters kept per page. */
export const MANUAL_PAGE_CHARS = 6000;
