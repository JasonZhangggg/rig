// Signed notes the server hands to the app and gets back later, so the Worker
// can stay stateless: where an answer left off while the PC reads (resume),
// and whether an answer read outside text (seal). HMAC-SHA-256 with the
// server's CHAT_STATE_SECRET; anything that doesn't verify is refused.

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function key(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keys.set(secret, k);
  }
  return k;
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** The longest signed note the server reads back. */
export const MAX_SIGNED = 4_000_000;

/** `payload` as JSON, signed. */
export async function sign(secret: string, payload: object): Promise<string> {
  const body = enc.encode(JSON.stringify(payload));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), body));
  return `${toB64(body)}.${toB64(mac)}`;
}

/** The payload, when the signature is the server's own. Null for anything else. */
export async function open<T>(secret: string, token: unknown): Promise<T | null> {
  if (typeof token !== "string" || token.length > MAX_SIGNED) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const body = fromB64(token.slice(0, dot));
  const mac = fromB64(token.slice(dot + 1));
  if (!body || !mac) return null;
  if (!(await crypto.subtle.verify("HMAC", await key(secret), mac, body))) return null;
  try { return JSON.parse(new TextDecoder().decode(body)) as T; } catch { return null; }
}

export async function sha256(text: string): Promise<string> {
  return toB64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text))));
}
