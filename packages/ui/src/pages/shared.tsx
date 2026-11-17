import type { Issue, PC } from "@rig/core";
import type { Ctx } from "../state";

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
export function issueGo(i: Issue, pc: PC, ctx: Pick<Ctx, "set" | "go" | "ask" | "review">) {
  if (i.fix) { ctx.review(i.fix, { by: "you", why: i.title }); return; }
  if (i.ask) { ctx.ask(i.ask); return; }
  if (i.part && i.go === "pc") ctx.set({ selected: i.part, tab: pc.parts?.[i.part]?.driver ? "drivers" : "live" });
  ctx.go(i.go);
}

/** How often Rig suggests cleaning the dust out, in days. */
export const CLEAN_EVERY = 90;

export const daysSince = (iso?: string) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : null);

/** A reminder in Things to look at once the last dust clean is overdue. */
export function dustIssue(pc: PC): Issue | null {
  const days = daysSince(pc.cleanedAt);
  if (days == null || days < CLEAN_EVERY || !pc.parts?.fans) return null;
  return {
    id: "dust", severity: "info", part: "fans", go: "pc", action: "Open Cooling",
    title: "Time to clean the dust out",
    body: `Last cleaned ${days} days ago. Dust makes fans work harder and parts run warmer.`,
  };
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

