import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { newer, type UpdateRelease } from "../src/routes-updates";
import { ORIGIN } from "./helpers";

/** Just enough of an R2 bucket: get() on a map of names to bytes. */
function bucket(files: Record<string, string>) {
  return {
    get: async (key: string) => {
      if (!(key in files)) return null;
      const bytes = new TextEncoder().encode(files[key]);
      return { size: bytes.length, body: new Blob([bytes]).stream(), json: async () => JSON.parse(files[key]) };
    },
  } as unknown as R2Bucket;
}

const release = (version: string): UpdateRelease => ({ version, file: `Rig-Setup-${version}-x64.exe`, signature: `sig-${version}`, pub_date: "2026-11-19T00:00:00Z" });

function call(path: string, files?: Record<string, string>) {
  const env: Env = { WEB_ORIGIN: ORIGIN, BETTER_AUTH_SECRET: "x".repeat(40), ...(files ? { UPDATES: bucket(files) } : {}) };
  return createApp({ database: () => { throw new Error("updates don't use the database"); } }).request(path, {}, env);
}

describe("app updates", () => {
  const files = { "releases.json": JSON.stringify([release("0.2.0"), release("0.1.3")]), "Rig-Setup-0.2.0-x64.exe": "installer bytes" };

  it("offers the newest release to an older install, without an account", async () => {
    const res = await call("/api/updates/windows/x86_64/0.1.3", files);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: "0.2.0", notes: "", pub_date: "2026-11-19T00:00:00Z",
      url: `${ORIGIN}/api/updates/files/Rig-Setup-0.2.0-x64.exe`, signature: "sig-0.2.0",
    });
  });

  it("says there's nothing to install when the app is current, newer, on another platform, or nothing is published", async () => {
    expect((await call("/api/updates/windows/x86_64/0.2.0", files)).status).toBe(204);
    expect((await call("/api/updates/windows/x86_64/0.3.0", files)).status).toBe(204);
    expect((await call("/api/updates/darwin/aarch64/0.1.0", files)).status).toBe(204);
    expect((await call("/api/updates/windows/x86_64/0.1.0", {})).status).toBe(204);
    expect((await call("/api/updates/windows/x86_64/0.1.0")).status).toBe(204);
  });

  it("serves the installer, and only installer names from the bucket", async () => {
    const res = await call("/api/updates/files/Rig-Setup-0.2.0-x64.exe", files);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("installer bytes");
    expect((await call("/api/updates/files/Rig-Setup-0.1.3-x64.exe", files)).status).toBe(404);
    expect((await call("/api/updates/files/releases.json", files)).status).toBe(404);
  });

  it("orders versions the way an update should go", () => {
    expect(newer("0.1.10", "0.1.9")).toBe(true);
    expect(newer("1.0.0", "0.9.9")).toBe(true);
    expect(newer("0.2.0", "0.2.0-beta.1")).toBe(true);
    expect(newer("0.2.0-beta.2", "0.2.0-beta.1")).toBe(true);
    expect(newer("0.2.0-beta.1", "0.2.0")).toBe(false);
    expect(newer("0.1.2", "0.1.2")).toBe(false);
    expect(newer("0.1.2", "nonsense")).toBe(false);
  });
});
