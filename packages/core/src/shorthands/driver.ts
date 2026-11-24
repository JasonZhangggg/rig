// The driver shorthand: install a driver from a signed .inf already on this
// PC, with Windows' own pnputil. Nothing is downloaded. A driver runs inside
// Windows and pnputil can't put back the one it replaces, so this is always
// tier 3. The read shows who signed it and both files' fingerprints; the INF
// and its catalog are touches, so the helper keeps a copy of each.

import type { Command } from "../change";
import { filePath, quote } from "./text";

export interface DriverShorthand {
  /** The driver's .inf, by full path. */
  inf: string;
  /** Its signed catalog (.cat), in the same folder. */
  catalog: string;
}

const folderOf = (p: string) => p.slice(0, p.lastIndexOf("\\")).toLowerCase();

/** A command that installs one driver from files on this PC. */
export function driverCommand(raw: unknown): Command | string {
  const d = (raw ?? {}) as Partial<DriverShorthand>;
  const inf = filePath(d.inf, [".inf"]);
  if (!inf) return "inf must be the driver's .inf file by its full path, like C:\\Drivers\\Realtek\\rt640x64.inf, in plain letters with no wildcards";
  const cat = filePath(d.catalog, [".cat"]);
  if (!cat) return "catalog must be the driver's signed .cat file by its full path, in plain letters with no wildcards";
  if (folderOf(inf) !== folderOf(cat)) return "catalog must be in the same folder as the .inf";
  const i = quote(inf), c = quote(cat);
  return {
    does: `Installs the driver ${inf} with Windows' pnputil, after checking its catalog is validly signed. A driver runs inside Windows and Rig can't promise to take it back, so this always gets Rig's strongest check.`,
    read: [
      `Get-FileHash -LiteralPath ${i} -Algorithm SHA256 | Format-List -Property Path, Hash`,
      `Get-FileHash -LiteralPath ${c} -Algorithm SHA256 | Format-List -Property Path, Hash`,
      `Get-AuthenticodeSignature -LiteralPath ${c} | Format-List -Property Status, StatusMessage`,
      `Get-AuthenticodeSignature -LiteralPath ${c} | Select-Object -ExpandProperty SignerCertificate | Format-List -Property Subject, Issuer, NotAfter, Thumbprint`,
    ].join("\n"),
    run: [
      `if (Get-AuthenticodeSignature -LiteralPath ${c} | Where-Object -Property Status -NE -Value 'Valid') { throw ${quote("This driver's catalog isn't validly signed, so Rig won't install it.")} }`,
      `pnputil /add-driver ${i} /install`,
      `if ($LASTEXITCODE -notin @(0, 259, 3010)) { throw ${quote("Windows didn't add the driver. pnputil says why above.")} }`,
    ].join("\n"),
    touches: [{ kind: "file", path: inf }, { kind: "file", path: cat }, { kind: "other", name: "Windows' driver store and the devices that use this driver" }],
  };
}
