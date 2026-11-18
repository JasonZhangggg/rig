import { describe, expect, it, vi } from "vitest";
import {
  LocalClient, MemoryStore, clampPages, findDiagrams, joinTextItems, makerName, manualLink, manualTargets, parseManualLink, searchPages,
  MANUAL_PAGE_CHARS, type ChatEvent, type HelperLink, type Manual, type ManualPage, type PC,
} from "../src";
import { DemoClient, SimulatedLink, fixtures, renderSampleManual, sampleBoardManual, sampleLaptopGuide } from "../src/demo";
import type { CloudClient } from "../src/cloud";

const pages = (...texts: string[]): ManualPage[] => texts.map((text, i) => ({ n: i + 1, text }));
const kinds = (ps: ManualPage[]) => findDiagrams(ps).map((d) => `${d.page}:${d.kind}`);

describe("manualTargets", () => {
  it("finds the demo tower's board and graphics card, and the laptop itself", async () => {
    const demo = new DemoClient();
    const [atlas, pebble] = await demo.machines();
    expect(manualTargets(atlas)).toEqual([
      { part: "motherboard", kind: "motherboard", maker: "MSI", model: "MAG B650 TOMAHAWK WIFI", source: "detected" },
      { part: "gpu", kind: "gpu", maker: "NVIDIA", model: "GeForce RTX 4070 SUPER", source: "detected", askModel: true },
    ]);
    expect(manualTargets(pebble)).toEqual([{ part: "chassis", kind: "laptop", maker: "ASUS", model: "Zenbook 14 OLED UX3405MA", source: "detected" }]);
  });

  it("skips placeholders, built-in graphics and the generic case and power supply", () => {
    const pc: PC = {
      id: "x", name: "X", kind: "tower", accent: "", nickname: "", os: "", health: 90, lastSync: "", online: true, summary: "",
      parts: {
        motherboard: { name: "To Be Filled By O.E.M.", type: "Motherboard", modelSource: "generic", maker: "To Be Filled By O.E.M.", model: "To Be Filled By O.E.M.", specs: [], manual: [] },
        gpu: { name: "AMD Radeon(TM) Graphics", type: "Graphics card", modelSource: "generic", maker: "AMD", model: "Radeon(TM) Graphics", specs: [], manual: [] },
        case: { name: "Your case", type: "Case", modelSource: "generic", specs: [], manual: [] },
        psu: { name: "Power supply", type: "Power supply", modelSource: "generic", specs: [], manual: [] },
      },
    };
    expect(manualTargets(pc)).toEqual([]);
    pc.parts!.psu.maker = "Corsair"; pc.parts!.psu.model = "RM850x";
    expect(manualTargets(pc)).toEqual([{ part: "psu", kind: "psu", maker: "Corsair", model: "RM850x", source: "detected" }]);
  });

  it("writes makers the way people do", () => {
    expect(makerName("ASUSTeK COMPUTER INC.")).toBe("ASUS");
    expect(makerName("Micro-Star International Co., Ltd.")).toBe("MSI");
    expect(makerName("Gigabyte Technology Co., Ltd.")).toBe("Gigabyte");
    expect(makerName("LENOVO")).toBe("Lenovo");
    expect(makerName("Framework Computer Inc.")).toBe("Framework Computer");
  });
});

// Realistic page texts, written the way pdf.js reads them back: one line per baseline.
const asus = {
  contents: "Contents\nSafety information 4\n1.1 Motherboard layout 12\n1.2 Front panel header 18\n1.3 Fan and pump headers 19\n1.4 Memory configuration 20\n1.5 M.2 slots 22\n1.6 Rear I/O 25",
  layout: "1.1 Motherboard layout\nCPU_FAN CPU_OPT AIO_PUMP\nEATX12V_1 EATX12V_2\nDIMM_A1 DIMM_A2 DIMM_B1 DIMM_B2\nEATXPWR\nM.2_1 M.2_2 M.2_3\nCHA_FAN1 CHA_FAN2\nPANEL\nADD_GEN2_1 AURA_RGB\nU32G2_C\nUSB3_12\nPCIEX16(G5)\nSATA6G_12",
  panel: "1.2 Front panel header (10-1 pin PANEL)\nPWR_LED+\nPWR_LED-\nPWRBTN\nGND\nHDD_LED+\nHDD_LED-\nRESET\nGND\nPIN 1\nConnect the power button, reset button and lights of the chassis.",
  memory: "1.4 Memory configuration\nRecommended memory configurations\nDIMM_A1 DIMM_A2 DIMM_B1 DIMM_B2\n1 DIMM: DIMM_A2\n2 DIMMs: DIMM_A2, DIMM_B2\n4 DIMMs: all slots",
  prose: "Before you proceed\nTake note of the following precautions before you install motherboard components or change any motherboard settings. Unplug the power cord from the wall socket before touching any component. To avoid damaging the motherboard, connect the CPU fan cable to the CPU_FAN connector and make sure it is firmly seated. Connect the chassis front panel header carefully: see the front panel header section for the pin definition. Use a grounded wrist strap or touch a safely grounded object before you handle components. Hold components by the edges to avoid touching the ICs on them.",
};
const msi = {
  layout: "Overview of Components\nCPU_PWR1 CPU_PWR2\nCPU_FAN1 PUMP_FAN1 SYS_FAN1\nDIMMA1 DIMMA2 DIMMB1 DIMMB2\nATX_PWR1\nM2_1 M2_2 M2_3\nJFP1 JFP2\nJRGB1 JARGB_V2_1 JARGB_V2_2\nJUSB1 JUSB2 JUSB3 JUSB4\nSYS_FAN2 SYS_FAN3\nJAUD1 JCI1 JTPM1",
  fans: "CPU_FAN1, PUMP_FAN1, SYS_FAN1~5: Fan Connectors\nCPU_FAN1\nPUMP_FAN1\nSYS_FAN1\n1 Ground\n2 +12V\n3 Sense\n4 Speed Control Signal",
  power: "CPU_PWR1~2, ATX_PWR1: Power Connectors\n8-pin\n24-pin\nCPU_PWR1\nATX_PWR1\nMake sure that all the power cables are securely connected to a proper ATX power supply.",
  rgb: "JRGB1: RGB LED connector\nJARGB_V2_1~3: A-RAINBOW V2 (ARGB Gen2) LED connectors\n+12V G R B\n+5V Data No Pin Ground",
  rear: "Rear I/O Panel\nFlash BIOS Button\nClear CMOS Button\nUSB 2.0 Type-A\nHDMI\nDisplayPort\n2.5Gbps LAN\nUSB 3.2 Gen 2 10Gbps\nWi-Fi antenna\nAudio Connectors\nLine-in\nLine-out\nMic in",
};
const gigabyte = {
  install: "1-3 Installing the CPU\nRead the following guidelines before you begin to install the CPU:\nMake sure that the motherboard supports the CPU.\nAlways turn off the computer and unplug the power cord from the power outlet before installing the CPU to prevent hardware damage.",
  panel: "F_PANEL (Front Panel Header)\nPLED+\nPLED-\nPW+\nPW-\nHD+\nHD-\nRES+\nRES-\nSPEAK+\nSPEAK-\nPower LED\nHDD LED",
  usb: "F_USB30 (USB 3.2 Gen 1 Header)\nF_U32C (USB Type-C Header)\nF_USB1/F_USB2 (USB 2.0/1.1 Headers)\nPin No. Definition\n1 VBUS\n2 SSRX-",
  m2: "1-7 M.2 Sockets\nM2A_CPU\nM2B_SB\nM2C_SB\nInstalling an M.2 SSD\nStep 1: Remove the heatsink.\nStep 2: Insert the M.2 SSD.",
  specs: "Specifications\nCPU AMD Socket AM5\nChipset AMD B650\nMemory 4 x DDR5 DIMM sockets\nStorage Interface 3 x M.2 connectors\nLAN Realtek 2.5GbE\nAudio Realtek ALC897\nForm Factor ATX Form Factor; 30.5cm x 24.4cm",
};
const caseManual = {
  dims: "Dimensions\n495 mm\n240 mm\n485 mm\nNet weight 9.6 kg",
  panel: "Front panel I/O\nPower SW\nReset SW\nPower LED\nHDD LED\nUSB 3.2 Gen 1\nUSB Type-C\nAudio",
  install: "Installing the motherboard\nStep 1: Install the I/O shield.\nStep 2: Lower the motherboard onto the standoffs.\nStep 3: Screw it in with the M3 screws.",
};

describe("findDiagrams", () => {
  it("marks the diagram pages of an ASUS style manual and skips the contents and a page that mentions headers in passing", () => {
    expect(kinds(pages(asus.contents, asus.prose, asus.layout, asus.panel, asus.memory))).toEqual(["3:board-layout", "4:front-panel", "5:memory-slots"]);
    expect(findDiagrams(pages(asus.layout))[0].label).toBe("Board layout");
  });

  it("reads MSI style headings with the header names first", () => {
    expect(kinds(pages(msi.layout, msi.fans, msi.power, msi.rgb, msi.rear))).toEqual(["1:board-layout", "2:fan-headers", "3:power-connectors", "4:rgb-headers", "5:rear-io"]);
  });

  it("reads Gigabyte style pages, naming installation pages by their heading", () => {
    const found = findDiagrams(pages(gigabyte.specs, gigabyte.install, gigabyte.panel, gigabyte.usb, gigabyte.m2));
    expect(found.map((d) => `${d.page}:${d.kind}`)).toEqual(["1:specs", "2:installation", "3:front-panel", "4:usb-headers", "5:m2-slots"]);
    expect(found[1].label).toBe("Installing the CPU");
  });

  it("finds a case manual's dimensions, front panel and installation pages", () => {
    expect(kinds(pages(caseManual.dims, caseManual.panel, caseManual.install))).toEqual(["1:dimensions", "2:front-panel", "3:installation"]);
  });

  it("doesn't count words mentioned in passing", () => {
    const passing = pages(
      asus.prose,
      "Troubleshooting\nIf the PC does not start, check that the 24-pin and 8-pin cables are plugged in, that the memory is in DIMM_A2 and DIMM_B2 as the memory configuration table shows, and that the power switch wires are on the right pins of the F_PANEL header. If the fans spin but nothing shows on screen, try one stick of memory at a time. Update the BIOS with BIOS FLASHBACK if the board is older than your processor.",
      "Warranty\nThis product is covered for three years from the date of purchase. Keep your receipt. The warranty doesn't cover damage from bent socket pins, wrong voltages on the RGB headers, or a USB header plugged in the wrong way.",
    );
    expect(findDiagrams(passing)).toEqual([]);
  });

  it("keeps the best page per kind, or two when they're about as good, in page order", () => {
    const two = findDiagrams(pages(msi.fans, "Introduction\nThank you for buying this board.", msi.fans.replace("CPU_FAN1, PUMP_FAN1, SYS_FAN1~5", "SYS_FAN2~5")));
    expect(two.map((d) => `${d.page}:${d.kind}`)).toEqual(["1:fan-headers", "3:fan-headers"]);
    const one = findDiagrams(pages(msi.fans, "Fan headers\nSee page 1."));
    expect(one.map((d) => d.page)).toEqual([1]);
  });

  it("finds the diagrams in the demo's sample manuals", () => {
    const board = renderSampleManual(sampleBoardManual("MSI", "MAG B650 TOMAHAWK WIFI"));
    expect(findDiagrams(board.pages).map((d) => `${d.page}:${d.kind}`)).toEqual([
      "3:specs", "4:board-layout", "5:rear-io", "6:installation", "7:memory-slots", "8:m2-slots", "9:front-panel", "10:fan-headers", "11:power-connectors", "12:rgb-headers", "12:usb-headers",
    ]);
    const laptop = renderSampleManual(sampleLaptopGuide("ASUS", "Zenbook 14 OLED UX3405MA"));
    expect(findDiagrams(laptop.pages).map((d) => `${d.page}:${d.label}`)).toEqual([
      "2:Dimensions", "2:Specifications", "3:Removing the bottom cover", "4:Inside view", "5:Replacing the battery", "6:M.2 slots",
    ]);
  });
});

describe("searchPages", () => {
  const manual = (id: string, title: string) => ({ id, title, part: "motherboard" });
  const docs = [
    { manual: manual("a", "Board manual"), pages: pages(asus.prose, asus.layout, asus.panel, asus.memory) },
    { manual: manual("b", "Case manual"), pages: pages(caseManual.dims, caseManual.panel, caseManual.install) },
  ];

  it("finds header names however they're typed", () => {
    for (const q of ["F_PANEL", "f panel", "f-panel", "PANEL"]) {
      const hits = searchPages([{ manual: manual("g", "Gigabyte"), pages: pages(gigabyte.install, gigabyte.panel) }], q);
      expect(hits[0]?.page, q).toBe(2);
    }
    expect(searchPages(docs, "cpu fan")[0]).toMatchObject({ manualId: "a", page: 2 });
    expect(searchPages(docs, "m.2")[0]).toMatchObject({ manualId: "a", page: 2 });
  });

  it("ranks the best page first, any case, plurals roughly, and marks the matches", () => {
    const hits = searchPages(docs, "Memory Configurations");
    expect(hits[0]).toMatchObject({ manualId: "a", title: "Board manual", part: "motherboard", page: 4 });
    expect(hits[0].snippet).toContain("«Memory configuration»");
    expect(searchPages(docs, "power leds")[0]).toMatchObject({ manualId: "b", page: 2 });
    expect(searchPages(docs, "where do the screws go")[0]).toMatchObject({ manualId: "b", page: 3 });
  });

  it("keeps snippets short, filters to one manual and stops at the limit", () => {
    const long = "word ".repeat(200) + "the F_PANEL header is here " + "word ".repeat(200);
    const [hit] = searchPages([{ manual: manual("l", "Long"), pages: pages(long) }], "f_panel");
    expect(hit.snippet.length).toBeLessThan(220);
    expect(hit.snippet).toMatch(/^….*«F_PANEL».*…$/);
    expect(searchPages(docs, "panel", { manualId: "b" }).every((h) => h.manualId === "b")).toBe(true);
    expect(searchPages(docs, "panel", { limit: 1 })).toHaveLength(1);
    expect(searchPages(docs, "  ")).toEqual([]);
  });
});

describe("page text", () => {
  it("joins pieces into lines in reading order", () => {
    expect(joinTextItems([
      { str: "Front panel header", x: 48, y: 756, height: 20 },
      { str: "", x: 48, y: 756, hasEOL: true },
      { str: "PWR_LED+", x: 60, y: 700, height: 8 },
      { str: " ", x: 100, y: 700, height: 8 },
      { str: "PWR_LED-", x: 120, y: 700, height: 8 },
      { str: "POWER SW", x: 60, y: 680, height: 8 },
    ])).toBe("Front panel header\nPWR_LED+ PWR_LED-\nPOWER SW");
  });

  it("keeps pages within the limits", () => {
    const out = clampPages([{ n: 1, text: "x".repeat(MANUAL_PAGE_CHARS + 50) }]);
    expect(out[0].text).toHaveLength(MANUAL_PAGE_CHARS);
  });
});

describe("sample PDF", () => {
  it("is a well formed PDF with the right page count and exact cross-reference offsets", () => {
    const { bytes, pages: read } = renderSampleManual(sampleBoardManual("MSI", "MAG B650 TOMAHAWK WIFI"));
    const s = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const [, count] = /xref\n0 (\d+)/.exec(s)!;
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(Number(count) - 1);
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count 12/.test(s)).toBe(true);
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) expect(s.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 10)).toBe("\nendstream");
    expect(read).toHaveLength(12);
    expect(read[3].text).toContain("F_PANEL");
  });
});

describe("demo manuals", () => {
  it("starts Atlas with its board manual read and Pebble with none", async () => {
    const demo = new DemoClient();
    const [board] = await demo.manuals("demo-atlas");
    expect(board).toMatchObject({ part: "motherboard", source: "found", indexed: true, pageCount: 12 });
    expect(board.diagrams.find((d) => d.kind === "board-layout")?.page).toBe(4);
    expect(await demo.manuals("demo-pebble")).toEqual([]);
    expect((await demo.manualPage("demo-atlas", board.id, 9))?.text).toMatch(/^.*\nFront panel header \(F_PANEL\)/);
    expect((await demo.searchManuals("demo-atlas", "f panel"))[0].page).toBe(9);
    const file = new Uint8Array(await demo.manualFile("demo-atlas", board.id));
    expect(String.fromCharCode(...file.slice(0, 5))).toBe("%PDF-");
  });

  it("finds the laptop's guide, reads it and saves it, and finds nothing for an unknown model", async () => {
    vi.useFakeTimers();
    const demo = new DemoClient();
    demo.shelf.delay = 10;
    const target = { part: "chassis", kind: "laptop" as const, maker: "ASUS", model: "Zenbook 14 OLED UX3405MA", source: "detected" as const };
    const find = demo.findManual("demo-pebble", target);
    await vi.advanceTimersByTimeAsync(20);
    const m = (await find)!;
    expect(m).toMatchObject({ part: "chassis", indexed: false, source: "found" });
    const none = demo.findManual("demo-atlas", { part: "gpu", kind: "gpu", maker: "ASUS", model: "DUAL RTX 4070 SUPER", source: "detected" });
    await vi.advanceTimersByTimeAsync(20);
    expect(await none).toBeNull();
    vi.useRealTimers();

    const saved = await demo.saveManualPages("demo-pebble", m.id, [{ n: 1, text: "Inside view\nM.2 2280 SSD slot" }], [{ page: 1, kind: "board-layout", label: "Inside view" }]);
    expect(saved).toMatchObject({ indexed: true, pageCount: 1 });
    expect((await demo.searchManuals("demo-pebble", "ssd"))[0]).toMatchObject({ manualId: m.id, page: 1 });

    const added = await demo.addManualFile("demo-pebble", { part: "extra:monitor", kind: "monitor", maker: "LG", model: "27GP850", source: "added" }, { name: "27GP850 manual.pdf", bytes: 1234 });
    expect(added).toMatchObject({ title: "27GP850 manual", source: "added", indexed: false });
    await expect(demo.manualFile("demo-pebble", added.id)).rejects.toThrow(/added on/);
    await demo.removeManual("demo-pebble", added.id);
    expect((await demo.manuals("demo-pebble")).map((x) => x.id)).toEqual([m.id]);
  });

  it("answers header and memory questions from the manual with a page link", async () => {
    const demo = new DemoClient();
    const ask = async (text: string) => {
      const ev: ChatEvent[] = [];
      await demo.chat("demo-atlas", [{ id: "1", from: "you", text }], (e) => ev.push(e));
      return { text: ev.flatMap((e) => (e.type === "text" ? [e.text] : [])).join(""), sources: ev.flatMap((e) => (e.type === "sources" ? e.sources : [])) };
    };
    const panel = await ask("Where does the power switch go on the front panel header?");
    expect(panel.text).toMatch(/F_PANEL.*page 9/);
    const src = panel.sources[0];
    expect(src.kind).toBe("Manual");
    const [board] = await demo.manuals("demo-atlas");
    expect(parseManualLink(src.url)).toEqual({ manualId: board.id, page: 9 });
    expect(src.url).toBe(manualLink(board.id, 9));
    expect((await ask("Which memory slots should I use?")).text).toMatch(/A2 and B2.*page 7/);
    expect(parseManualLink((await ask("What does page 4 of the manual show?")).sources[0].url)?.page).toBe(4);
    // A loud fan is still about temperatures, not the manual.
    expect((await ask("Why is my fan so loud?")).sources[0]?.kind).toBe("Your PC");
  }, 20000);
});

describe("LocalClient manuals", () => {
  function setup(cloud: CloudClient | null) {
    const sim = new SimulatedLink(fixtures.atlas.inv, fixtures.atlas.facts, { now: () => Date.now() });
    const link: HelperLink = { hello: () => sim.hello(), inventory: () => sim.inventory(), facts: () => sim.facts(), snapshot: () => sim.snapshot(), apply: (c) => sim.apply(c) };
    const store = new MemoryStore();
    return { client: new LocalClient(link, store, cloud, { tickMs: 1e9, syncEveryMs: 1e9 }), store };
  }
  const target = { part: "motherboard", kind: "motherboard" as const, maker: "MSI", model: "MAG B650 TOMAHAWK WIFI", source: "detected" as const };

  it("keeps manuals on this PC while signed out, and can't look them up", async () => {
    const { client, store } = setup(null);
    await client.start();
    const id = client.id;
    await expect(client.findManual(id, target)).rejects.toThrow("Sign in so Rig can look up manuals on the maker's site. You can still add a PDF you have.");
    const m = await client.addManualFile(id, target, { name: "B650 manual.pdf", bytes: 5_000_000 });
    expect(m).toMatchObject({ machineId: id, title: "B650 manual", source: "added", indexed: false });
    await expect(client.manualFile(id, m.id)).rejects.toThrow(/only the copy on this PC/);

    const saved = await client.saveManualPages(id, m.id, pages(asus.prose, asus.panel), [{ page: 2, kind: "front-panel", label: "Front panel header" }]);
    expect(saved).toMatchObject({ indexed: true, pageCount: 2 });
    expect((await client.manuals(id))[0].diagrams).toHaveLength(1);
    expect((await store.get<Manual[]>("manuals"))![0].id).toBe(m.id);
    expect((await client.searchManuals(id, "reset"))[0]).toMatchObject({ manualId: m.id, page: 2 });
    expect((await client.manualPage(id, m.id, 2))?.text).toContain("PWR_LED+");
    expect(await client.manuals("another-pc")).toEqual([]);

    await client.removeManual(id, m.id);
    expect(await client.manuals(id)).toEqual([]);
    expect(await client.searchManuals(id, "reset")).toEqual([]);
    client.stop();
  });

  it("uses the account's manuals while signed in", async () => {
    const found: Manual = { id: "m1", machineId: "pc", part: "motherboard", kind: "motherboard", maker: "MSI", model: "B650", title: "B650 user manual", source: "found", indexed: false, diagrams: [], addedAt: "2026-11-01T00:00:00Z" };
    const cloud = {
      signedIn: async () => true,
      manuals: vi.fn(async () => [found]), findManual: vi.fn(async () => found), addManualFile: vi.fn(async () => found),
      manualFile: vi.fn(async () => new ArrayBuffer(4)), saveManualPages: vi.fn(async () => ({ ...found, indexed: true })),
      searchManuals: vi.fn(async () => []), manualPage: vi.fn(async () => null), removeManual: vi.fn(async () => {}),
    } as unknown as CloudClient;
    const { client, store } = setup(cloud);
    expect(await client.manuals("pc")).toEqual([found]);
    expect(await client.findManual("pc", target)).toBe(found);
    await client.addManualFile("pc", target, { name: "x.pdf", bytes: 1 });
    expect((await client.manualFile("pc", "m1")).byteLength).toBe(4);
    await client.saveManualPages("pc", "m1", [], []);
    await client.searchManuals("pc", "fan", { manualId: "m1" });
    await client.manualPage("pc", "m1", 3);
    await client.removeManual("pc", "m1");
    expect((cloud as unknown as { findManual: unknown }).findManual).toHaveBeenCalledWith("pc", target);
    expect(cloud.searchManuals).toHaveBeenCalledWith("pc", "fan", { manualId: "m1" });
    expect(cloud.manualPage).toHaveBeenCalledWith("pc", "m1", 3);
    expect(cloud.removeManual).toHaveBeenCalledWith("pc", "m1");
    expect(await store.get("manuals")).toBeNull();
  });
});
