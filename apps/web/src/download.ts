// Where the Download button points. Rig Setup is published on the repository's GitHub
// releases (see docs/releasing.md). The page starts with this build's own version, then
// asks GitHub for the newest full release, so a site built before its release is
// published, or left running after a newer one, still offers the newest Rig Setup.

export const repo = "JasonZhangggg/rig";
export const releasesPage = `https://github.com/${repo}/releases`;

export interface Download {
  version: string;
  url: string;
  /** The release page, for the checksums and what changed. */
  page: string;
  /** Bytes, when GitHub said. */
  size?: number;
}

const SETUP = /^Rig-Setup-(\d+\.\d+\.\d+)-x64\.exe$/;

/** The download for this build's version, before GitHub answers. */
export function builtDownload(version: string): Download {
  const tag = `v${version}`;
  return { version, url: `${releasesPage}/download/${tag}/Rig-Setup-${version}-x64.exe`, page: `${releasesPage}/tag/${tag}` };
}

interface GitHubRelease { prerelease?: boolean; draft?: boolean; html_url?: string; assets?: { name?: string; size?: number; browser_download_url?: string }[] }

/** Rig Setup from GitHub's latest release, or null when the answer doesn't have one. */
export function fromRelease(release: GitHubRelease): Download | null {
  if (!release || release.prerelease || release.draft) return null;
  for (const a of release.assets ?? []) {
    const m = a.name ? SETUP.exec(a.name) : null;
    const url = a.browser_download_url;
    if (!m || !url || !url.startsWith(`https://github.com/${repo}/releases/download/`)) continue;
    const page = release.html_url?.startsWith(`${releasesPage}/`) ? release.html_url : releasesPage;
    return { version: m[1], url, page, size: typeof a.size === "number" ? a.size : undefined };
  }
  return null;
}

export async function latestDownload(signal?: AbortSignal): Promise<Download | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { accept: "application/vnd.github+json" }, signal });
    return r.ok ? fromRelease(await r.json() as GitHubRelease) : null;
  } catch {
    return null;
  }
}

export const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
