import { useId, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { worldClock } from "@story-to-cyoa/runtime";
import { CharacterPanel, JournalPanel } from "./JournalPanel.js";
import { EconomyPanel } from "./EconomyPanel.js";
import { WorldPanelCore } from "./WorldPanel.js";
import "./journal.css";
type View = "explore" | "character" | "journal" | "inventory" | "shops" | "gifts";
export function WorldViews(props: ComponentProps<typeof WorldPanelCore>) {
  const { world, state, disabled, onAction } = props, [view, setView] = useState<View>("explore"), heading = useRef<HTMLHeadingElement>(null), explore = useRef<HTMLButtonElement>(null), panelId = useId();
  const select = (next: View, back = false) => { setView(next); props.onViewChange?.(next); requestAnimationFrame(() => { if (back) explore.current?.focus(); else heading.current?.focus(); }); };
  const labels = { explore: "Explore", character: "Character", journal: "Journal", inventory: "Inventory", shops: "Shops here", gifts: "Give a gift" };
  return <section className="world-views" data-view={view} aria-label="World views" onKeyDown={(e) => { if (e.key === "Escape" && view !== "explore") { e.preventDefault(); select("explore", true); } }}>
    <nav aria-label="World views">{(["explore", "character", "journal", ...(world.economy ? ["inventory", "shops", "gifts"] : [])] as View[]).map((key) => <button ref={key === "explore" ? explore : undefined} key={key} aria-pressed={view === key} aria-controls={panelId} onClick={() => select(key)}>{labels[key]}</button>)}</nav>
    <div id={panelId}><h3 ref={heading} tabIndex={-1}>{labels[view]}</h3>
      {view === "explore" ? <WorldPanelCore {...props} /> : <>
        <header className="world-view-context"><strong>{world.locations.find((l) => l.id === state.world!.locationId)!.name}</strong><time aria-label="Game time">{worldClock(state.world!.minutes)}</time></header>
        {view === "character" ? <CharacterPanel world={world} state={state} /> : view === "journal" ? <JournalPanel world={world} state={state} /> : <EconomyPanel world={world} state={state} disabled={disabled} onAction={onAction} selectedView={view} />}
        <button onClick={() => select("explore", true)}>Back to exploration</button>
      </>}
    </div>
  </section>;
}
