import { BrowserRouter, Routes, Route } from "react-router-dom";
import { NavBar } from "./components/NavBar";
import { ActPage } from "./components/ActPage";
import { ObservePage } from "./components/ObservePage";
import { OrientPage } from "./components/OrientPage";
import { DecidePage } from "./components/DecidePage";
import { SettingsPage } from "./components/SettingsPage";

function App() {
  return (
    <BrowserRouter>
      <div className="app">
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
