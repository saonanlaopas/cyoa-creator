import { useEffect, useState } from "react";
import { QuickGenerator } from "../features/generator/QuickGenerator.js";
import { NativePlayer } from "../features/player/NativePlayer.js";
import { parseNativePlayerRoute } from "../features/player/player-route.js";
import { LongFormWorkspace } from "../features/workspace/LongFormWorkspace.js";

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const playerRoute = parseNativePlayerRoute(hash);
  if (playerRoute) return <NativePlayer route={playerRoute} />;

  const view: "quick" | "long-form" = hash === "#long-form" ? "long-form" : "quick";
  const select = (next: "quick" | "long-form") => {
    window.location.hash = next === "long-form" ? "long-form" : "";
    setHash(window.location.hash);
  };
  return <>
    <nav className="app-mode-nav" aria-label="Application mode">
      <button className={view === "quick" ? "selected" : ""} onClick={() => select("quick")}>Quick prototype</button>
      <button className={view === "long-form" ? "selected" : ""} onClick={() => select("long-form")}>Long-form workspace</button>
    </nav>
    {view === "quick" ? <QuickGenerator /> : <LongFormWorkspace />}
  </>;
}
