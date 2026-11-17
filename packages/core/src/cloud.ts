// Talks to the Rig server. The website signs in with a cookie; the desktop
// app signs in through the browser and keeps a token in the OS keychain.
// Changes are only made from the Rig app on the PC itself, so preview, apply
// and undo aren't available through here.

import type { ActionCall } from "./actions";
import {
  ApiError, desktopClientId, errorText, paths, readChatStream, unreachableText,
  type ChatRequest, type MachineSync, type SyncReply,
} from "./api";
import type { Account, Change, ChatEvent, ChatMessage, Range, RigClient } from "./client";
import type { DiffRow, Game, HistoryPoint, PC, Upgrade } from "./model";
import type { SystemFacts } from "./telemetry";

const POLL_MS = 15_000;
/** The browser page (the website only). */
const page = () => (globalThis as unknown as { location: { href: string } }).location;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface CloudOptions {
  /** Where the API lives, like "/api" on the website or "https://…/api" in the desktop app. */
  base: string;
  /** Desktop: the saved sign-in token. Without these, the browser's cookie is used. */
  token?: { get(): Promise<string | null>; set(token: string | null): Promise<void> };
  /** Desktop: opens a page in the person's browser. */
  openUrl?: (url: string) => void;
  /** Website: the server has Google sign-in turned on. */
  google?: boolean;
}

export class CloudClient implements RigClient {
  readonly kind = "web" as const;
  readonly caps = { local: false, applyChanges: false };

  constructor(private opts: CloudOptions) {
    // Offer only the sign-in that fits: browser code on the desktop, email and Google on the web.
    const self = this as Partial<Record<"signInWithBrowser" | "signInEmail" | "signInGoogle" | "approveDevice", unknown>>;
    if (!(opts.token && opts.openUrl)) self.signInWithBrowser = undefined;
    if (opts.token) { self.signInEmail = undefined; self.signInGoogle = undefined; self.approveDevice = undefined; }
    if (!opts.google) self.signInGoogle = undefined;
  }

  private async headers(json: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = json ? { "content-type": "application/json" } : {};
    const t = await this.opts.token?.get();
    if (t) h.authorization = `Bearer ${t}`;
    return h;
  }

  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    // `credentials` is a browser option; written this way so the server can share this file's types.
    const credentials = { credentials: this.opts.token ? "omit" : "include" } as RequestInit;
    const headers = { ...(await this.headers(init.body != null)), ...init.headers };
    try {
      return await fetch(this.opts.base + path, { ...credentials, ...init, headers });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      throw new ApiError(0, unreachableText);
    }
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.send(path, init);
    if (!res.ok) throw new ApiError(res.status, await errorText(res));
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  async signedIn() { return this.opts.token ? (await this.opts.token.get()) != null : true; }

  async account(): Promise<Account | null> {
    if (!(await this.signedIn())) return null;
    try { return await this.req<Account>(paths.me); } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await this.opts.token?.set(null); return null; }
      throw e;
    }
  }

  async signOut() {
    try { await this.req(paths.signOut, { method: "POST", body: "{}" }); } finally { await this.opts.token?.set(null); }
  }

  async signInEmail(email: string, password: string, create?: { name: string }): Promise<Account> {
    const r = await this.req<{ user: Account }>(create ? paths.signUpEmail : paths.signInEmail, {
      method: "POST",
      body: JSON.stringify(create ? { email, password, name: create.name } : { email, password }),
    });
    return { id: r.user.id, name: r.user.name, email: r.user.email };
  }

  async signInGoogle() {
    const r = await this.req<{ url: string }>(paths.signInSocial, {
      method: "POST",
      body: JSON.stringify({ provider: "google", callbackURL: page().href.split("#")[0] }),
    });
    page().href = r.url;
  }

  /** Desktop: shows a code, opens the website to approve it, and saves the token once approved. */
  async signInWithBrowser(): Promise<{ code: string; url: string; done: Promise<Account> }> {
    const { token, openUrl } = this.opts;
    const start = await this.req<{ device_code: string; user_code: string; verification_uri_complete?: string; verification_uri: string; interval?: number; expires_in: number }>(
      paths.deviceCode, { method: "POST", body: JSON.stringify({ client_id: desktopClientId }) });
    const url = start.verification_uri_complete ?? start.verification_uri;
    openUrl!(url);
    const done = (async () => {
      let wait = (start.interval ?? 5) * 1000;
      const until = Date.now() + start.expires_in * 1000;
      while (Date.now() < until) {
        await sleep(wait);
        const res = await fetch(this.opts.base + paths.deviceToken, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code, client_id: desktopClientId }),
        });
        const body = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
        if (res.ok && body.access_token) {
          await token!.set(body.access_token);
          const me = await this.account();
          if (me) return me;
          throw new Error("Signed in, but Rig couldn't read the account.");
        }
        if (body.error === "slow_down") wait += 5000;
        else if (body.error !== "authorization_pending") throw new Error(body.error === "access_denied" ? "Sign-in was cancelled in the browser." : body.error_description ?? "Sign-in didn't finish.");
      }
      throw new Error("The sign-in code ran out. Try again.");
    })();
    return { code: start.user_code, url, done };
  }

  /** Website: checks the code from the desktop's link, then approves or refuses it. */
  async approveDevice(userCode: string, approve: boolean) {
    const code = userCode.trim().toUpperCase();
    const check = await this.send(paths.deviceCheck(code));
    if (!check.ok) throw new Error("That sign-in code isn't valid or has run out. Start again from the Rig app.");
    await this.req(approve ? paths.deviceApprove : paths.deviceDeny, { method: "POST", body: JSON.stringify({ userCode: code }) });
  }

  machines() { return this.req<PC[]>(paths.machines); }

  watch(id: string, cb: (pc: PC) => void) {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try { const pc = await this.req<PC>(paths.machine(id)); if (!stopped) cb(pc); } catch { /* keep showing the last view */ }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
  }

  async rename(id: string, patch: { name?: string; accent?: string; cleanedAt?: string }) {
    await this.req(paths.machine(id), { method: "PATCH", body: JSON.stringify(patch) });
  }

  history(id: string, range: Range) { return this.req<HistoryPoint[]>(paths.history(id, range)); }
  upgrades(id: string) { return this.req<Upgrade[]>(paths.upgrades(id)); }
  games(id: string) { return this.req<Game[]>(paths.games(id)); }
  changes(id: string) { return this.req<Change[]>(paths.changes(id)); }

  private local(): never { throw new Error("Changes are made from the Rig app on the PC itself."); }
  preview(_id: string, _calls: ActionCall[]): Promise<DiffRow[]> { return this.local(); }
  apply(): Promise<Change> { return this.local(); }
  undo(): Promise<Change> { return this.local(); }
  redo(): Promise<Change> { return this.local(); }

  /** Desktop: uploads this PC's latest view so the website shows it. */
  sync(id: string, payload: MachineSync) {
    return this.req<SyncReply>(paths.sync(id), { method: "PUT", body: JSON.stringify(payload) });
  }

  /** Asks Rig. The desktop passes its live view and settings so answers use the latest readings. */
  async chat(machineId: string, history: ChatMessage[], onEvent: (e: ChatEvent) => void, signal?: AbortSignal, live?: { view: PC; facts: SystemFacts }) {
    const body: ChatRequest = { machineId, messages: history.map(({ from, text }) => ({ from, text })), ...live };
    const res = await this.send(paths.chat, { method: "POST", headers: { accept: "text/event-stream" }, body: JSON.stringify(body), signal });
    await readChatStream(res, onEvent);
  }
}
