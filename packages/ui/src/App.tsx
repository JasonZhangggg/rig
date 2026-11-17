import { useEffect, useState } from "react";
import type { Account, RigClient } from "@rig/core";
import { AppProvider, useApp, type AppHost } from "./state";
import { getStage } from "./components/Stage";
import { ReviewSheet, Toast } from "./components/Shell";
import { Sidebar } from "./components/Sidebar";
import { Palette } from "./components/Palette";
import { sceneTheme } from "./themes";
import { Overview } from "./pages/Overview";
import { PCPage } from "./pages/PCPage";
import { Chat } from "./pages/Chat";
import { Changes } from "./pages/Changes";
import { Upgrades } from "./pages/Upgrades";
import { Games } from "./pages/Games";
import { History } from "./pages/History";
import { Web } from "./pages/Web";
import { SignIn } from "./pages/SignIn";
import { DeviceApprove } from "./pages/DeviceApprove";
import { Settings } from "./pages/settings/Settings";

export interface RigAppProps {
  client: RigClient;
  /** Website: show the sign-in screen until there's an account. */
  requireAccount?: boolean;
  /** Desktop: what the app itself can do, like starting with Windows. */
  host?: AppHost;
}

/** The whole Rig app. The desktop app and the website mount this with their own client. */
export function RigApp({ client, requireAccount, host }: RigAppProps) {
  const [account, setAccount] = useState<Account | null | undefined>(requireAccount ? undefined : null);
  const [signin, setSignin] = useState(location.hash === "#signin");
  // The desktop app opens /app/?user_code=… so the person can approve its sign-in here.
  const [userCode, setUserCode] = useState(() => (client.approveDevice ? new URLSearchParams(location.search).get("user_code") : null));
  useEffect(() => {
    if (requireAccount) client.account().then(setAccount).catch(() => setAccount(null));
    const on = () => setSignin(location.hash === "#signin");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [client, requireAccount]);

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
    return <SignIn client={client} note={userCode ? "Sign in here to finish signing in the Rig app on your PC." : undefined}
      onDone={() => { location.hash = "overview"; location.reload(); }}
      onSkip={requireAccount ? undefined : () => { location.hash = "overview"; }} />;
  }
  return (
    <AppProvider client={client} host={host} fallback={(s) => <Splash text={s === "loading" ? "Reading your PC…" : client.kind === "web" ? "No PCs yet. Install Rig on a PC and sign in with this account, and it shows up here." : "Rig couldn't read this PC. Restart Rig, and if it keeps happening, reinstall it."} />}>
      <Root />
    </AppProvider>
  );
}

function Splash({ text }: { text: string }) {
  return <div className="splash" role="status"><span className="fp-logo">R<i /></span><p>{text}</p></div>;
}

function Root() {
  const { ui, pc, set } = useApp();
  const { scene } = getStage();

  useEffect(() => { getStage().onSelect = (id) => set({ selected: id, tab: "live" }); }, [set]);

  // Rebuild the 3D model only when its shape changes; otherwise just feed it new readings.
  const shape = `${pc.id}|${pc.kind}|${pc.parts?.gpu?.warn ?? ""}|${Object.keys(pc.parts ?? {}).join()}`;
  useEffect(() => { scene.setPC(pc, sceneTheme); }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scene.update(pc); }, [pc, scene]);
  useEffect(() => { scene.setTempUnit(ui.tempUnit); }, [ui.tempUnit, scene]);
  useEffect(() => {
    const onPC = ui.route === "pc";
    scene.setExploded(onPC && ui.exploded);
    scene.setHeat(onPC && ui.heat);
    scene.setAirflow(ui.airflow);
  }, [ui.route, ui.exploded, ui.heat, ui.airflow, scene]);
  useEffect(() => {
    if (ui.route === "pc" && ui.selected) scene.select(ui.selected);
    else if (ui.route !== "pc") scene.select(null);
  }, [ui.route, pc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const Page = { overview: Overview, pc: PCPage, chat: Chat, changes: Changes, upgrades: Upgrades, games: Games, history: History, web: Web, signin: Overview, settings: Settings }[ui.route];
  return (
    <>
      <Sidebar><Page /></Sidebar>
      <ReviewSheet />
      <Palette />
      <Toast />
    </>
  );
}
