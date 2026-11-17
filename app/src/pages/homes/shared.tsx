import type { Issue, PC } from "../../data";

export const partIcon: Record<string, JSX.Element> = {
  cpu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></svg>,
  gpu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="2" y="6" width="20" height="11" rx="2" /><circle cx="9" cy="11.5" r="3" /><circle cx="16.5" cy="11.5" r="2" /><path d="M5 17v3" /></svg>,
  ram: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="2" y="7" width="20" height="9" rx="1.5" /><path d="M6 10.5v2M10 10.5v2M14 10.5v2M18 10.5v2M5 16v3M19 16v3" /></svg>,
  ssd: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 14h18" /><circle cx="17" cy="17" r="1" fill="currentColor" /></svg>,
  fans: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="1.6" /><path d="M12 10.4c0-3 1-5.4 3.5-5.4M13.6 12c3 0 5.4 1 5.4 3.5M12 13.6c0 3-1 5.4-3.5 5.4M10.4 12c-3 0-5.4-1-5.4-3.5" /></svg>,
  psu: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M13 3 5 13h6l-1 8 8-10h-6z" /></svg>,
  battery: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="2" y="7" width="18" height="10" rx="2.5" /><path d="M22 10.5v3" /><rect x="4.5" y="9.5" width="11" height="5" rx="1" fill="currentColor" stroke="none" /></svg>,
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="7" y="7" width="6" height="6" rx="1" /><path d="M16 7h2M16 10h2M7 16h11" strokeLinecap="round" /></svg>,
};
partIcon.motherboard = partIcon.board;

export const shortType = (t: string) => t.replace(" and cooler", "");

// What clicking an issue does everywhere
export function issueGo(i: Issue, pc: PC, set: (p: object) => void, go: (r: never) => void) {
  if (i.part && i.go === "pc") set({ selected: i.part, tab: pc.parts?.[i.part]?.driver ? "drivers" : "live" });
  go(i.go as never);
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// Sample extras for the mockup, per PC
export const extras: Record<string, {
  storage: { label: string; gb: number }[]; totalGb: number;
  fans: { label: string; rpm: number; max: number }[];
  cleanDays: number; cleanEvery: number;
  power: { label: string; w: number }[]; psu: number;
  week: { d: string; peak: number }[];
  uptime: string; boot: string;
}> = {
  atlas: {
    storage: [{ label: "Games", gb: 820 }, { label: "Apps", gb: 210 }, { label: "Other", gb: 190 }, { label: "Free", gb: 780 }], totalGb: 2000,
    fans: [{ label: "Processor", rpm: 1180, max: 2000 }, { label: "Graphics", rpm: 2450, max: 3000 }, { label: "Front 1", rpm: 1320, max: 1800 }, { label: "Front 2", rpm: 1310, max: 1800 }, { label: "Rear", rpm: 1050, max: 1800 }],
    cleanDays: 41, cleanEvery: 60,
    power: [{ label: "Graphics card", w: 220 }, { label: "Processor", w: 98 }, { label: "Everything else", w: 54 }], psu: 750,
    week: [{ d: "Wed", peak: 79 }, { d: "Thu", peak: 80 }, { d: "Fri", peak: 81 }, { d: "Sat", peak: 82 }, { d: "Sun", peak: 81 }, { d: "Mon", peak: 83 }, { d: "Tue", peak: 84 }],
    uptime: "6 d 4 h", boot: "18 s",
  },
  pebble: {
    storage: [{ label: "Apps", gb: 190 }, { label: "Files", gb: 160 }, { label: "Other", gb: 80 }, { label: "Free", gb: 570 }], totalGb: 1000,
    fans: [{ label: "Left fan", rpm: 2900, max: 5200 }, { label: "Right fan", rpm: 2850, max: 5200 }],
    cleanDays: 12, cleanEvery: 180,
    power: [{ label: "Processor", w: 18 }, { label: "Screen", w: 6 }, { label: "Everything else", w: 4 }], psu: 65,
    week: [{ d: "Wed", peak: 71 }, { d: "Thu", peak: 74 }, { d: "Fri", peak: 69 }, { d: "Sat", peak: 55 }, { d: "Sun", peak: 52 }, { d: "Mon", peak: 76 }, { d: "Tue", peak: 72 }],
    uptime: "2 d 9 h", boot: "9 s",
  },
};
