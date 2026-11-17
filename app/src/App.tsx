import { useEffect } from "react";
import { AppProvider, useApp } from "./state";
import { getStage } from "./components/Stage";
import { MockPanel, Modal, Toast } from "./components/Shell";
import { Shell } from "./components/Shells";
import { Palette } from "./components/Palette";
import { sceneFor, sceneGlow } from "./themes";
import { Overview } from "./pages/Overview";
import { PCPage } from "./pages/PCPage";
import { Chat } from "./pages/Chat";
import { Changes } from "./pages/Changes";
import { Upgrades } from "./pages/Upgrades";
import { Games } from "./pages/Games";
import { History } from "./pages/History";
import { Web } from "./pages/Web";
import { SignIn } from "./pages/SignIn";

export function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}

function Root() {
  const { ui, pc, set } = useApp();
  const { scene } = getStage();

  // Theme and PC identity
  useEffect(() => {
    // Mix wears Blend's layout, so it sets Blend's style and adds its own skin on top
    document.documentElement.dataset.style = ui.style === "mix" ? "blend" : ui.style;
    document.documentElement.dataset.skin = ui.style === "mix" ? "mix" : "";
    document.documentElement.dataset.mode = ui.mode;
    document.documentElement.style.setProperty("--pc", pc.accent);
  }, [ui.style, ui.mode, pc.accent]);

  // Keep the 3D scene in step with the app
  useEffect(() => {
    getStage().onSelect = (id) => set({ selected: id, tab: "live" });
  }, [set]);
  useEffect(() => { scene.setFinish(ui.finish); }, [ui.finish, scene]);
  useEffect(() => {
    const th = sceneFor(ui.style, ui.mode);
    // In one-accent looks the 3D glow follows that accent so the page reads as one color
    const glow = sceneGlow[ui.style] ?? null;
    scene.setPC(glow ? { ...pc, accent: glow } : pc, glow ? { ...th, highlight: glow } : th);
  }, [pc.id, pc.accent, ui.style, ui.mode]); // eslint-disable-line react-hooks/exhaustive-deps
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

  if (ui.route === "signin") return <><SignIn /><MockPanel /></>;
  const Page = { overview: Overview, pc: PCPage, chat: Chat, changes: Changes, upgrades: Upgrades, games: Games, history: History, web: Web }[ui.route];
  return (
    <>
      <Shell><Page /></Shell>
      <Modal />
      <Palette />
      <Toast />
      <MockPanel />
    </>
  );
}
