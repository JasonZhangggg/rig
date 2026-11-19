// Checks an installer's updater signature against Rig's updater public key, the
// way the installed app will before it installs an update:
//   node tools/updater-sig.mjs <installer> <installer.sig> <updater.pub>
// The Release workflow runs it, so an update signed with the wrong key never
// reaches the server (installed copies would refuse it). Tauri writes both the
// .sig and the public key as base64 of minisign's text format.
import crypto from "node:crypto";
import fs from "node:fs";

const unwrap = (file) => Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64").toString("utf8").split(/\r?\n/);
const b64 = (line) => Buffer.from(line.trim(), "base64");

function verify(data, sigLines, pubLines) {
  const pub = b64(pubLines[1]); // "Ed" + key id (8) + key (32)
  const sig = b64(sigLines[1]); // "ED" (hashed) or "Ed" + key id (8) + signature (64)
  const trusted = sigLines[2].replace(/^trusted comment: /, "");
  const global = b64(sigLines[3]);
  if (pub.length !== 42 || sig.length !== 74) return "the signature or key isn't in minisign's format";
  if (!pub.subarray(2, 10).equals(sig.subarray(2, 10))) {
    return `it was signed with key ${sig.subarray(2, 10).reverse().toString("hex").toUpperCase()}, but updater.pub is key ${pub.subarray(2, 10).reverse().toString("hex").toUpperCase()}`;
  }
  const key = crypto.createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pub.subarray(10).toString("base64url") }, format: "jwk" });
  const hashed = sig.subarray(0, 2).toString() === "ED";
  const message = hashed ? crypto.createHash("blake2b512").update(data).digest() : data;
  if (!crypto.verify(null, message, key, sig.subarray(10))) return "the signature doesn't match the file";
  if (!crypto.verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, global)) return "the signature's comment was changed";
  return null;
}

const [file, sigFile, pubFile] = process.argv.slice(2);
if (!pubFile) { console.error("Usage: node tools/updater-sig.mjs <installer> <installer.sig> <updater.pub>"); process.exit(2); }
const problem = verify(fs.readFileSync(file), unwrap(sigFile), unwrap(pubFile));
if (problem) { console.error(`${file}: ${problem}.`); process.exit(1); }
console.log(`${file}: signed with the updater key in ${pubFile}.`);
