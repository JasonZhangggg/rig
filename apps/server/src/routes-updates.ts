// Updates for the installed app. Tauri's updater asks
// /api/updates/<target>/<arch>/<its version> and gets the newest release when
// it's newer, or 204 when there's nothing to install. Installers live in the
// UPDATES R2 bucket next to releases.json, which the Release workflow writes
// (tools/publish-update.mjs). No account is needed, as the updater sends none.

import type { AppHono } from "./app";

/** One release in releases.json, newest first. The bucket keeps the latest three. */
export interface UpdateRelease {
  version: string;
  /** The installer's name in the bucket, like Rig-Setup-0.2.0-x64.exe. */
  file: string;
  /** The installer's updater signature (the .sig file's text), checked by the app with the key it was built with. */
  signature: string;
  pub_date: string;
  notes?: string;
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const INSTALLER = /^Rig-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-x64\.exe$/;

/** Whether release `a` should replace an install of `b`. A full release beats its own pre-releases. */
export function newer(a: string, b: string): boolean {
  const x = VERSION.exec(a), y = VERSION.exec(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) if (Number(x[i]) !== Number(y[i])) return Number(x[i]) > Number(y[i]);
  if (!x[4] || !y[4]) return !x[4] && !!y[4];
  return x[4].localeCompare(y[4], "en", { numeric: true }) > 0;
}

export function updateRoutes(app: AppHono) {
  app.get("/api/updates/:target/:arch/:current", async (c) => {
    const bucket = c.env.UPDATES;
    // Only the Windows installer is published.
    if (!bucket || c.req.param("target") !== "windows" || c.req.param("arch") !== "x86_64") return c.body(null, 204);
    const list = await (await bucket.get("releases.json"))?.json<UpdateRelease[]>().catch(() => null);
    const latest = Array.isArray(list) ? list[0] : undefined;
    if (!latest || !INSTALLER.test(latest.file) || !newer(latest.version, c.req.param("current"))) return c.body(null, 204);
    c.header("cache-control", "no-store");
    return c.json({
      version: latest.version,
      notes: latest.notes ?? "",
      pub_date: latest.pub_date,
      url: `${c.env.WEB_ORIGIN}/api/updates/files/${latest.file}`,
      signature: latest.signature,
    });
  });

  app.get("/api/updates/files/:name", async (c) => {
    const name = c.req.param("name");
    const file = c.env.UPDATES && INSTALLER.test(name) ? await c.env.UPDATES.get(name) : null;
    if (!file) return c.json({ message: "That installer isn't here. Rig keeps the latest three." }, 404);
    c.header("content-type", "application/octet-stream");
    c.header("content-length", String(file.size));
    c.header("content-disposition", `attachment; filename="${name}"`);
    c.header("cache-control", "public, max-age=31536000, immutable");
    return c.body(file.body);
  });
}
