// Sources under an answer: one quiet line, each manual named once with its pages.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manualLink, type Source } from "@rig/core";

const opened: string[] = [];
vi.mock("../src/manuals/viewerState", () => ({ openManualLink: (url: string) => { opened.push(url); return true; } }));
const { Sources } = await import("../src/pages/chat/Sources");

afterEach(() => { cleanup(); opened.length = 0; });

const page = (n: number): Source => ({ kind: "Manual", label: `H670M Pro RS manual, page ${n}`, url: manualLink("asrock-h670m", n) });

describe("Sources", () => {
  it("names a manual once and lists its pages in order, each opening that page", () => {
    const { container } = render(<Sources sources={[{ kind: "Your PC", label: "Atlas's readings" }, page(43), page(89), page(45), page(43)]} />);
    expect(container.textContent).toBe("SourcesAtlas's readings · H670M Pro RS manual, p. 43, 45, 89");
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["43", "45", "89"]);
    fireEvent.click(screen.getByRole("button", { name: "H670M Pro RS manual, page 89" }));
    expect(opened).toEqual([manualLink("asrock-h670m", 89)]);
  });

  it("keeps two manuals apart and web pages as links", () => {
    render(<Sources sources={[page(7), { kind: "Manual", label: "Case manual, p. 3", url: manualLink("case", 3) }, { kind: "Maker", label: "ASRock support", url: "https://www.asrock.com/support" }]} />);
    expect(screen.getByRole("button", { name: "H670M Pro RS manual, page 7" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Case manual, page 3" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ASRock support" }).getAttribute("href")).toBe("https://www.asrock.com/support");
  });
});
