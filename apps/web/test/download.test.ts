import { describe, expect, it } from "vitest";
import { builtDownload, fromRelease, megabytes, onWindows } from "../src/download";

const page = "https://github.com/JasonZhangggg/rig/releases";

describe("the install page's Download button", () => {
  it("starts on Rig Setup for the version the site was built from", () => {
    expect(builtDownload("0.2.2")).toEqual({
      version: "0.2.2",
      url: `${page}/download/v0.2.2/Rig-Setup-0.2.2-x64.exe`,
      page: `${page}/tag/v0.2.2`,
    });
  });

  it("switches to Rig Setup from GitHub's latest release, with its size", () => {
    const d = fromRelease({
      html_url: `${page}/tag/v0.2.3`,
      assets: [
        { name: "SHA256SUMS.txt", size: 90, browser_download_url: `${page}/download/v0.2.3/SHA256SUMS.txt` },
        { name: "Rig-Setup-0.2.3-x64.exe", size: 33_721_413, browser_download_url: `${page}/download/v0.2.3/Rig-Setup-0.2.3-x64.exe` },
      ],
    });
    expect(d).toEqual({ version: "0.2.3", url: `${page}/download/v0.2.3/Rig-Setup-0.2.3-x64.exe`, page: `${page}/tag/v0.2.3`, size: 33_721_413 });
    expect(megabytes(d!.size!)).toBe("34 MB");
  });

  it("keeps the built link for a pre-release, a release without Rig Setup, or a file somewhere else", () => {
    const setup = { name: "Rig-Setup-0.3.0-x64.exe", browser_download_url: `${page}/download/v0.3.0/Rig-Setup-0.3.0-x64.exe` };
    expect(fromRelease({ prerelease: true, assets: [setup] })).toBeNull();
    expect(fromRelease({ assets: [{ name: "SHA256SUMS.txt", browser_download_url: `${page}/download/v0.3.0/SHA256SUMS.txt` }] })).toBeNull();
    expect(fromRelease({ assets: [{ ...setup, browser_download_url: "https://example.com/Rig-Setup-0.3.0-x64.exe" }] })).toBeNull();
  });
});

describe("leading with the download", () => {
  it("leads with it on Windows and with the demo elsewhere", () => {
    expect(onWindows({ userAgentData: { platform: "Windows" } })).toBe(true);
    expect(onWindows({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" })).toBe(true);
    expect(onWindows({ userAgentData: { platform: "macOS" }, userAgent: "Windows NT" })).toBe(false);
    expect(onWindows({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" })).toBe(false);
    expect(onWindows({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" })).toBe(false);
  });
});
