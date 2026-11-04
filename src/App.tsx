import { isTauri } from "@tauri-apps/api/core";
import { info } from "@tauri-apps/plugin-log";
import { useEffect } from "react";
import appIcon from "./assets/app-icon.svg";
import { AppFooter } from "./components/AppFooter";
import { ClassifierPanel } from "./components/ClassifierPanel";
import { DevicePanel } from "./components/DevicePanel";
import { LanguageSelect } from "./components/LanguageSelect";
import { PlacementPanel } from "./components/PlacementPanel";
import { RatesPanel } from "./components/RatesPanel";
import { useProfileStore } from "./stores/profile";
import { useSessionStore } from "./stores/session";
import { MainTabs } from "./views/MainTabs";

function App() {
  const releaseStaleSession = useSessionStore(
    (state) => state.releaseStaleSession,
  );

  const loadProfile = useProfileStore((state) => state.loadProfile);

  useEffect(() => {
    void releaseStaleSession();
    void loadProfile();
    if (isTauri()) {
      void info("Frontend started");
    }
  }, [releaseStaleSession, loadProfile]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img className="logo" src={appIcon} alt="" />
          <h1>Galvani</h1>
        </div>
        <LanguageSelect />
      </header>
      <main className="app-main">
        <aside className="sidebar">
          <DevicePanel />
          <PlacementPanel />
          <ClassifierPanel />
          <RatesPanel />
        </aside>
        <MainTabs />
      </main>
      <AppFooter />
    </div>
  );
}

export default App;
