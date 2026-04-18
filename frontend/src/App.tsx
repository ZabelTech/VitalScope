import { BrowserRouter, Routes, Route } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { ActPage } from "./components/ActPage";
import { ObservePage } from "./components/ObservePage";
import { OrientPage } from "./components/OrientPage";
import { DecidePage } from "./components/DecidePage";
import { SettingsPage } from "./components/SettingsPage";
import { useRuntime } from "./hooks/useRuntime";

function DemoBanner() {
  const runtime = useRuntime();
  if (!runtime?.demo) return null;
  return (
    <div className="demo-banner">
      Demo preview — data is synthetic, edits are wiped on restart
      {runtime.commit ? ` · ${runtime.commit.slice(0, 7)}` : ""}
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <DemoBanner />
        <NavBar />
        <main>
          <Routes>
            <Route path="/" element={<ActPage />} />
            <Route path="/observe" element={<ObservePage />} />
            <Route path="/orient" element={<OrientPage />} />
            <Route path="/decide" element={<DecidePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
