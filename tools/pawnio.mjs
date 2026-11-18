// Fetches the official, signed PawnIO installer that Rig's Windows installer
// bundles. PawnIO is the driver LibreHardwareMonitor reads processor
// temperatures and board fans through (https://pawnio.eu, GPL-2.0, by namazso).
// The file is checked against a pinned SHA-256, so a changed download fails the build.
//   node tools/pawnio.mjs     writes apps/desktop/src-tauri/pawnio/
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PAWNIO = {
  version: "2.2.0",
  url: "https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe",
  sha256: "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032",
  source: "https://github.com/namazso/PawnIO",
};

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/desktop/src-tauri/pawnio");
const exe = path.join(out, "PawnIO_setup.exe");
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

if (fs.existsSync(exe) && sha(fs.readFileSync(exe)) === PAWNIO.sha256) {
  console.log(`PawnIO ${PAWNIO.version} is already in ${out}`);
} else {
  const res = await fetch(PAWNIO.url);
  if (!res.ok) throw new Error(`Downloading PawnIO failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== PAWNIO.sha256) throw new Error(`PawnIO ${PAWNIO.version} has SHA-256 ${got}, expected ${PAWNIO.sha256}. Check the release before changing the pin.`);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(exe, buf);
  console.log(`Fetched PawnIO ${PAWNIO.version} (${buf.length} bytes) into ${out}`);
}
fs.writeFileSync(
  path.join(out, "PAWNIO-NOTICE.txt"),
  `Rig installs PawnIO ${PAWNIO.version}, a driver by namazso (https://pawnio.eu), so it can read processor temperatures and board fans.\r\n` +
    `PawnIO_setup.exe is the official signed installer, unchanged. PawnIO is free software under the GNU General Public License, version 2 or later.\r\n` +
    `Its source code is at ${PAWNIO.source}. The license is at https://www.gnu.org/licenses/old-licenses/gpl-2.0.html.\r\n`,
);
