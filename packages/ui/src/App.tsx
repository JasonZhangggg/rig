import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Account, RigClient } from "@rig/core";
import { AppProvider, useApp, useAppearance, useUI, type AppHost } from "./state";
import { applyAppearance } from "./appearance";
import { getStage } from "./components/Stage";
import { ReviewSheet, Toast, UpdateNotice, navItems } from "./components/Shell";
import { CardAsk } from "./pages/gpu/CardPick";
import { Sidebar } from "./components/Sidebar";
import { Palette } from "./components/Palette";
import { SlowLoudSheet } from "./components/SlowLoud";
import { StartupApps } from "./components/StartupApps";
import { sceneThemeFor } from "./themes";
import type { SceneTheme } from "./scene";
import { Overview } from "./pages/Overview";
import { PCPage } from "./pages/PCPage";
import { Chat } from "./pages/Chat";
import { Changes } from "./pages/Changes";
import { Games } from "./pages/Games";
import { EventLog } from "./pages/logs/EventLog";
import { Readings } from "./pages/logs/Readings";
import { Web } from "./pages/Web";
import { SignIn } from "./pages/SignIn";
import { DeviceApprove } from "./pages/DeviceApprove";
import { Settings } from "./pages/settings/Settings";
import { ManualViewer } from "./manuals/Viewer";
import { useBoardLayout } from "./manuals/boardLayout";

export interface RigAppProps {
  client: RigClient;
  /** Website: show the sign-in screen until there's an account. */
  requireAccount?: boolean;
  /** Desktop: what the app itself can do, like starting with Windows. */
  host?: AppHost;
}

/** The whole Rig app. The desktop app and the website mount this with their own client. */
export function RigApp({ client, requireAccount, host }: RigAppProps) {
  const look = useAppearance();
  useLayoutEffect(() => applyAppearance(look), [look]);
  const [account, setAccount] = useState<Account | null | undefined>(requireAccount ? undefined : null);
  const [down, setDown] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [signin, setSignin] = useState(location.hash === "#signin");
  // The desktop app opens /app/?user_code=… so the person can approve its sign-in here.
  const [userCode, setUserCode] = useState(() => (client.approveDevice ? new URLSearchParams(location.search).get("user_code") : null));
  useEffect(() => {
    if (requireAccount) client.account().then((a) => { setDown(false); setAccount(a); }).catch(() => setDown(true));
  }, [client, requireAccount, attempt]);
  useEffect(() => {
    const on = () => setSignin(location.hash === "#signin");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (requireAccount && down) return <Splash text="Rig can't reach its server right now. Check your internet connection, then try again." retry={() => { setDown(false); setAttempt((n) => n + 1); }} />;
  if (requireAccount && account === undefined) return <Splash text="Loading…" />;
  if (account && userCode) {
    return <DeviceApprove client={client} account={account} code={userCode} onClose={() => {
      const url = new URL(location.href);
      url.searchParams.delete("user_code");
      history.replaceState(null, "", url);
      setUserCode(null);
    }} />;
  }
  if ((requireAccount && !account) || signin) {
    return <SignIn client={client} note={userCode ? "Sign in to finish connecting Rig on your PC." : undefined}
      onDone={() => { location.hash = "overview"; location.reload(); }}
      onSkip={requireAccount ? undefined : () => { location.hash = "overview"; }} />;
  }
  const logs = host?.openLogs;
  return (
    <AppProvider client={client} host={host} fallback={(s, retry, reason) => s === "error"
      ? client.kind === "web"
        ? <Splash text="Rig can't reach your PCs right now. Check your internet connection, then try again." retry={retry} />
        : <Splash text="Rig couldn't read this PC." detail={`${reason ?? ""} Try again, and if it keeps happening, restart your PC.`.trim()} retry={retry} logs={logs} />
      : s === "loading" || client.kind === "web"
        ? <Splash text={s === "loading" ? "Reading your PC…" : "No PCs yet. Install Rig on a PC and sign in with this account, and it shows up here."} />
        : <Splash text="Rig couldn't read this PC. Restart Rig, and if it keeps happening, reinstall it." logs={logs} />}>
      <Root />
    </AppProvider>
  );
}

/** A whole-window message while Rig starts, or when it can't. With `logs`, a problem also offers Rig's log folder, which is what to send along when asking for help. */
export function Splash({ text, detail, retry, logs }: { text: string; detail?: string; retry?: () => void; logs?: () => Promise<void> }) {
  const problem = !!(retry || logs);
  return (
    <div className="splash" role={problem ? "alert" : "status"}>
      <span className="fp-logo">R<i /></span>
      <p>{text}</p>
      {detail && <p className="splash-detail">{detail}</p>}
      {problem && (
        <div className="splash-actions">
          {retry && <button className="btn" type="button" onClick={retry}>Try again</button>}
          {logs && <button className="btn ghost" type="button" onClick={() => void logs().catch(() => {})}>Open logs folder</button>}
        </div>
      )}
    </div>
  );
}

/** Feeds the 3D view each reading. Kept apart from the pages so a new reading draws only what shows it. */
function SceneFeed() {
  const { ui, pc, set, go } = useApp();
  const { scene } = getStage();
  // The board's layout is read from its manual once Rig knows the board, without the person asking.
  useBoardLayout();

  // Picking a part in any 3D view opens its page, where it's shown alone.
  useEffect(() => { getStage().onSelect = (id) => { set({ selected: id, tab: "live" }); if (id && ui.route !== "pc") go("pc"); }; }, [set, go, ui.route]);

  // Rebuild the 3D model only when its shape or colors change; otherwise just feed it new readings.
  const look = useAppearance();
  const themeKey = JSON.stringify(sceneThemeFor(look));
  const theme = useMemo(() => JSON.parse(themeKey) as SceneTheme, [themeKey]);
  const built = useRef(theme);
  const shape = `${pc.id}|${pc.kind}|${Object.keys(pc.parts ?? {}).join()}`;
  useEffect(() => { built.current = theme; scene.setPC(pc, theme); }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (built.current !== theme) { built.current = theme; scene.setTheme(theme); } }, [theme, scene]);
  useEffect(() => { scene.update(pc); }, [pc, scene]);
  useEffect(() => { scene.setTempUnit(ui.tempUnit); }, [ui.tempUnit, scene]);
  useEffect(() => {
    const onPC = ui.route === "pc";
    scene.setExploded(onPC && ui.exploded);
  }, [ui.route, ui.exploded, scene]);
  useEffect(() => {
    if (ui.route === "pc" && ui.selected) scene.select(ui.selected);
    else if (ui.route !== "pc") scene.select(null);
  }, [ui.route, pc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Root() {
  const ui = useUI();

  // A new page gets its own tab title, and focus moves to it so a screen reader hears the change.
  const firstRoute = useRef(true);
  // A new page starts at its top, scrolled once it's drawn so the old page doesn't jump first. Chat keeps its place.
  const lastRoute = useRef(ui.route);
  useLayoutEffect(() => {
    if (lastRoute.current === ui.route) return;
    lastRoute.current = ui.route;
    if (ui.route !== "chat") window.scrollTo(0, 0);
  }, [ui.route]);
  useEffect(() => {
    const label = navItems.find(([r]) => r === ui.route)?.[1];
    document.title = label && ui.route !== "overview" ? `${label} · Rig` : "Rig";
    if (firstRoute.current) { firstRoute.current = false; return; }
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [ui.route]);

  const Page = { overview: Overview, pc: PCPage, chat: Chat, changes: Changes, upgrades: PCPage, games: Games, history: Readings, logs: Readings, recorded: Readings, events: EventLog, manuals: PCPage, web: Web, signin: Overview, settings: Settings }[ui.route];
  return (
    <>
      <SceneFeed />
      <Sidebar><Page /></Sidebar>
      {/* Before the review sheet, which opens over it. */}
      <StartupApps />
      <ReviewSheet />
      <CardAsk />
      <ManualViewer />
      <SlowLoudSheet />
      <Palette />
      <UpdateNotice />
      <Toast />
    </>
  );
}
