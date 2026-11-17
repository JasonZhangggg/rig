import { useEffect } from "react";
import { AppProvider, useApp } from "./state";
import { getStage } from "./components/Stage";
import { MockPanel, Modal, Nav, Toast } from "./components/Shell";
import { Palette } from "./components/Palette";
import { sceneThemes } from "./themes";
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
    document.documentElement.dataset.style = ui.style;
    document.documentElement.style.setProperty("--pc", pc.accent);
  }, [ui.style, pc.accent]);

  // Keep the 3D scene in step with the app
  useEffect(() => {
    getStage().onSelect = (id) => set({ selected: id, tab: "live" });
  }, [set]);
  useEffect(() => { scene.setPC(pc, sceneThemes[ui.style]); }, [pc.id, pc.accent, ui.style]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onPC = ui.route === "pc";
    scene.setExploded(onPC && ui.exploded);
    scene.setHeat(onPC && ui.heat);
  }, [ui.route, ui.exploded, ui.heat, scene]);
  useEffect(() => {
    if (ui.route === "pc" && ui.selected) scene.select(ui.selected);
    else if (ui.route !== "pc") scene.select(null);
  }, [ui.route, pc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ui.route === "signin") return <><SignIn /><MockPanel /></>;
  const Page = { overview: Overview, pc: PCPage, chat: Chat, changes: Changes, upgrades: Upgrades, games: Games, history: History, web: Web }[ui.route];
  return (
    <>
      <div className="app">
        <Nav />
        <main className="main" id="main"><Page /></main>
      </div>
      <Modal />
      <Palette />
      <Toast />
      <MockPanel />
    </>
  );
}
