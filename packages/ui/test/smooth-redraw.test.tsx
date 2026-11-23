// A new reading every two seconds draws again only what shows it: screens that show names, chat or buttons stay as they are.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PC } from "@rig/core";
import { DemoClient } from "@rig/core/demo";

const { AppProvider, keepUnchanged, useActions, useApp, useData, useStillPC } = await import("../src/state");

const draws: Record<string, number> = {};
const drew = (k: string) => { draws[k] = (draws[k] ?? 0) + 1; };

function Buttons() { useActions(); drew("buttons"); return null; }
function Name() { const pc = useStillPC(); drew("name"); return <p>{pc.name}: {pc.issues?.length ?? 0} issues</p>; }
function Chat() { const { chat } = useData("chat"); drew("chat"); return <p>{chat.length} messages</p>; }
function Live() { const { pc } = useApp(); drew("live"); return <p>CPU {pc.parts?.cpu?.temp}</p>; }

/** Renders the four screens on a demo PC and hands back a way to send it a new reading. */
async function setup() {
  const client = new DemoClient();
  let send!: (pc: PC) => void;
  let last!: PC;
  const real = client.watch.bind(client);
  vi.spyOn(client, "watch").mockImplementation((id, cb) => {
    send = cb;
    return real(id, (pc) => { if (!last) cb(pc); last = pc; });
  });
  render(<AppProvider client={client} fallback={(s) => <p>{s}</p>}><Buttons /><Name /><Chat /><Live /></AppProvider>);
  await screen.findByText(/^CPU/);
  const reading = (change: (pc: PC) => PC) => act(async () => { last = change(structuredClone(last)); send(last); });
  return { reading };
}

/** A new reading: the processor a degree warmer, seen a second later. */
const warmer = (pc: PC): PC => ({
  ...pc,
  seenAt: new Date(Date.parse(pc.seenAt ?? "2026-01-01") + 1000).toISOString(),
  parts: { ...pc.parts, cpu: { ...pc.parts!.cpu, temp: (pc.parts!.cpu.temp ?? 50) + 1 } },
});

beforeEach(() => { for (const k of Object.keys(draws)) delete draws[k]; localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Drawing again on a new reading", () => {
  it("draws only the live reading again when temperatures change", async () => {
    const { reading } = await setup();
    const before = { ...draws };
    for (let i = 0; i < 3; i++) await reading(warmer);
    expect(draws.live - before.live).toBe(3);
    expect(draws.buttons).toBe(before.buttons);
    expect(draws.name).toBe(before.name);
    expect(draws.chat).toBe(before.chat);
  });

  it("draws the PC's name and issues again when an issue comes or goes", async () => {
    const { reading } = await setup();
    const before = { ...draws };
    await reading((pc) => ({ ...warmer(pc), issues: (pc.issues ?? []).slice(1) }));
    expect(draws.name).toBe(before.name + 1);
    expect(draws.buttons).toBe(before.buttons);
  });
});

describe("keepUnchanged", () => {
  it("keeps the parts that didn't change as the same objects", () => {
    const prev = { a: { b: [1, 2] }, c: { d: 1 }, e: [{ f: 1 }] };
    const next = keepUnchanged(prev, structuredClone({ ...prev, c: { d: 2 } }));
    expect(next.a).toBe(prev.a);
    expect(next.e).toBe(prev.e);
    expect(next.c).not.toBe(prev.c);
    expect(keepUnchanged(prev, structuredClone(prev))).toBe(prev);
  });
});
