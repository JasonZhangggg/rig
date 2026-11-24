// Text checks and quoting shared by the shorthands.

/** Printable ASCII only: anything else could read as a quote, a dash or a different letter to PowerShell. */
export const plain = (s: string) => /^[\x20-\x7e]*$/.test(s);
export const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
/** A file's full path, written out plainly, ending with one of `ends`; or null. No wildcards, no `..`, no short names, nothing that reaches another computer. */
export function filePath(raw: unknown, ends: string[]): string | null {
  if (typeof raw !== "string" || raw.length > 260 || !plain(raw) || /[*?[\]%"`$]/.test(raw) || raw.includes("\\\\") || raw.includes("/")) return null;
  if (!/^[A-Za-z]:\\[^\\]/.test(raw) || /(^|\\)\.\.?(\\|$)/.test(raw) || /[A-Za-z0-9]~\d/.test(raw) || raw !== raw.trim() || raw.endsWith("\\")) return null;
  return ends.some((e) => raw.toLowerCase().endsWith(e)) ? raw : null;
}
