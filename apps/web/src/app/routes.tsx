import { useState } from "react";
import { QuickGenerator } from "../features/generator/QuickGenerator.js";
import { LongFormWorkspace } from "../features/workspace/LongFormWorkspace.js";

export function App() {
  const [view, setView] = useState<"quick" | "long-form">(
    window.location.hash === "#long-form" ? "long-form" : "quick",
  );
  const select = (next: "quick" | "long-form") => {
    setView(next);
    window.location.hash = next === "long-form" ? "long-form" : "";
  };
  return <>
    <nav className="app-mode-nav" aria-label="Application mode">
      <button className={view === "quick" ? "selected" : ""} onClick={() => select("quick")}>Quick prototype</button>
      <button className={view === "long-form" ? "selected" : ""} onClick={() => select("long-form")}>Long-form workspace</button>
    </nav>
    {view === "quick" ? <QuickGenerator /> : <LongFormWorkspace />}
  </>;
}
