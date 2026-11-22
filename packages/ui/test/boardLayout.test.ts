// The board's layout read from its manual without asking: kept on the device,
// shared by the server for every PC with the board, and read only when nobody has.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardLayout, BoardLayoutReply, Manual, ManualTarget, RigClient } from "@rig/core";

vi.mock("../src/manuals/cache", () => ({ getCopy: async () => null, putCopy: async () => {} }));
const { ensureBoardLayout, keptLayout } = await import("../src/manuals/boardLayout");
type Deps = Parameters<typeof ensureBoardLayout>[1];

const target: ManualTarget = { part: "board", kind: "motherboard", maker: "Micro-Star International Co., Ltd.", model: "PRO B650-A WIFI (MS-7D78)", source: "detected" };
const layout: BoardLayout = { maker: "MSI", model: "PRO B650-A WIFI", page: 27, reading: { board: [0, 0, 400, 500], items: [["JFP1", "fp", 380, 480, 395, 490]] } };
const unread: Manual = { id: "m1", part: "board", kind: "motherboard", maker: "MSI", model: "PRO B650-A WIFI", title: "PRO B650-A WIFI user guide", source: "found", url: "https://download-2.msi.com/x.pdf", host: "download-2.msi.com", indexed: false, diagrams: [], addedAt: "" } as unknown as Manual;
const read: Manual = { ...unread, indexed: true, pageCount: 90, diagrams: [{ page: 27, kind: "board-layout", label: "Board layout" }] } as Manual;

/** A pretend server and manual list. `shared` is what the server keeps for the board. */
function world(shared: BoardLayoutReply[] = [{ status: "none" }], readReply: BoardLayoutReply = { status: "done", layout }) {
  const calls: string[] = [];
  let manuals: Manual[] = [];
  const client = {
    boardLayout: async () => { calls.push("look"); return shared.length > 1 ? shared.shift()! : shared[0]; },
    readBoardLayout: async (_id: string, mid: string, page: { page: number; text?: string; width: number }) => { calls.push(`read ${mid} p${page.page} ${page.text} ${page.width}`); return readReply; },
    manualFile: async () => { calls.push("download"); return new ArrayBuffer(8); },
    manualPage: async (_id: string, _mid: string, n: number) => ({ n, text: n === 27 ? "Overview of Components" : "JFP1 front panel" }),
  } as unknown as RigClient;
  const store = {
    load: async () => {},
    get: () => ({ manuals }),
    find: async () => { calls.push("find"); manuals = [read]; },
    read: async () => { calls.push("index"); manuals = [read]; },
  };
  const deps: Deps = { client, pcId: "pc1", manuals: store as unknown as Deps["manuals"], render: async (_b, page) => { calls.push(`render p${page}`); return { image: "abc", mediaType: "image/png", width: 1400, height: 1000 }; }, wait: async () => {} };
  return { calls, deps, setManuals: (m: Manual[]) => { manuals = m; } };
}

beforeEach(() => { localStorage.clear(); });

describe("the board's layout, read automatically", () => {
  it("finds the manual, reads its layout page once, and keeps it so the next launch does nothing", async () => {
    const w = world();
    expect(await ensureBoardLayout(target, w.deps)).toEqual(layout);
    expect(w.calls).toEqual(["look", "find", "download", "render p27", "read m1 p27 Overview of Components\nJFP1 front panel 1400"]);
    expect(keptLayout("MSI", "pro b650-a wifi")).toEqual(layout);

    const again = world();
    expect(await ensureBoardLayout(target, again.deps)).toEqual(layout);
    expect(again.calls).toEqual([]);
  });

  it("takes the layout the server already has for the board, without the manual", async () => {
    const w = world([{ status: "done", layout }]);
    expect(await ensureBoardLayout(target, w.deps)).toEqual(layout);
    expect(w.calls).toEqual(["look"]);
  });

  it("waits for another PC's read of the same board instead of reading it again", async () => {
    const w = world([{ status: "reading" }, { status: "reading" }, { status: "done", layout }]);
    expect(await ensureBoardLayout(target, w.deps)).toEqual(layout);
    expect(w.calls).toEqual(["look", "look", "look"]);
  });

  it("reads a manual it has but hasn't read, and stops where there's no drawing to read", async () => {
    const w = world();
    w.setManuals([unread]);
    expect(await ensureBoardLayout(target, w.deps)).toEqual(layout);
    expect(w.calls.slice(0, 2)).toEqual(["look", "index"]);

    localStorage.clear();
    const none = world();
    none.setManuals([{ ...read, diagrams: [] }]);
    expect(await ensureBoardLayout(target, none.deps)).toBeNull();
    expect(none.calls).toEqual(["look"]);

    const failed = world([{ status: "failed" }]);
    expect(await ensureBoardLayout(target, failed.deps)).toBeNull();
    expect(failed.calls).toEqual(["look"]);
  });
});
