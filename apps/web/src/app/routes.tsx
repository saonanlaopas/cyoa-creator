import { useEffect, useState, type MouseEvent } from "react";
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
  const skipToMain = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById("main-content")?.focus();
  };
  if (playerRoute) return <><a className="skip-link" href="#main-content" onClick={skipToMain}>Skip to main content</a><NativePlayer route={playerRoute} /></>;

  const view: "quick" | "long-form" = hash === "#long-form" ? "long-form" : "quick";
  const select = (next: "quick" | "long-form") => {
    window.location.hash = next === "long-form" ? "long-form" : "";
    setHash(window.location.hash);
  };
  return <>
    <a className="skip-link" href="#main-content" onClick={skipToMain}>Skip to main content</a>
    <nav className="app-mode-nav" aria-label="Application mode">
      <button aria-current={view === "quick" ? "page" : undefined} className={view === "quick" ? "selected" : ""} onClick={() => select("quick")}>Quick prototype</button>
      <button aria-current={view === "long-form" ? "page" : undefined} className={view === "long-form" ? "selected" : ""} onClick={() => select("long-form")}>Long-form workspace</button>
    </nav>
    {view === "quick" ? <QuickGenerator /> : <LongFormWorkspace />}
  </>;
}
