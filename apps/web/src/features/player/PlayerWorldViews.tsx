import { useRef } from "react";
import { mandatoryEventStatus, presentCharacters, progressionEventAvailability, worldClock } from "@story-to-cyoa/runtime";
import { EconomyPanel } from "./EconomyPanel.js";
import { CharacterPanel, JournalPanel } from "./JournalPanel.js";
import { PlayerWorldActions, PlayerWorldMap, type WorldActionProps } from "./PlayerWorldActions.js";
import type { ReactNode } from "react";
import "./journal.css";

const labels = { explore: "Explore", decisions: "Decisions", map: "Map", character: "Character",
  journal: "Journal", history: "History", inventory: "Inventory", shops: "Shops here", gifts: "Give a gift" };
export type PlayerWorldView = keyof typeof labels;
export const isPrimaryWorldView = (view: PlayerWorldView) => view === "explore" || view === "decisions";

export function PlayerWorldHeader({ world, state }: Pick<WorldActionProps, "world" | "state">) {
  const current = world.locations.find(location => location.id === state.world!.locationId)!;
  const chapter = world.progression?.chapters.find(item => item.id === state.world!.progression?.chapterId);
  const people = world.people ? presentCharacters(world, state) : null;
  return <div className="player-world-header" aria-label="Location and status">
    <strong>{current.name}</strong><time aria-label="Game time">{worldClock(state.world!.minutes)}</time>
    {world.progression && <span>{chapter ? `Chapter: ${chapter.name}` : "Chapter-free play"}</span>}
    {people && <section aria-label="People present">Here now: {people.map(p => p.name).join(", ") || "No one encountered"}</section>}
    {world.economy && !world.journal && <span>{world.economy.currency.name}: {state.world!.economy!.currency}</span>}
  </div>;
}

function WorldHistory({ world, state }: Pick<WorldActionProps, "world" | "state">) {
  const progress = state.world!.progression;
  if (!progress || !world.progression) return null;
  const milestones = world.progression.milestones.filter(item => progress.milestones.includes(item.id));
  const recorded = world.progression.events.filter(item => Object.hasOwn(progress.events, item.id) || progress.knownEventIds.includes(item.id) && progress.expiredEventIds.includes(item.id));
  return <section aria-label="World history">
    <p>Milestones: {milestones.map(item => item.name).join(", ") || "None yet"}</p>
    {recorded.length > 0 && <ul>{recorded.map(event => {
      const count = Object.hasOwn(progress.events, event.id) ? progress.events[event.id]!.count : 0;
      const reason = progressionEventAvailability(world, state, event.id).reason;
      return <li key={event.id}>{event.label}{count > 0 && ` · Completed ${count} time(s)`}{reason && reason !== "Completed" && ` · ${reason}`}</li>;
    })}</ul>}
  </section>;
}

export function PlayerWorldViews(props: WorldActionProps & { view: PlayerWorldView; select: (view: PlayerWorldView) => void; decisions: ReactNode; hasDecisions: boolean; ended: boolean }) {
  const { world, state, view, select, decisions, hasDecisions, ended } = props;
  const heading = useRef<HTMLHeadingElement>(null), nav = useRef<HTMLElement>(null);
  const pending = mandatoryEventStatus(world, state);
  const move = (next: PlayerWorldView) => {
    select(next);
    requestAnimationFrame(() => {
      if (isPrimaryWorldView(next)) nav.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
      else heading.current?.focus();
    });
  };
  const modes: PlayerWorldView[] = ["explore", ...(!ended && hasDecisions && !pending.eventId && !pending.conflict ? ["decisions"] as const : []),
    "map", ...(world.journal ? ["character", "journal"] as const : world.progression ? ["history"] as const : []),
    ...(world.economy ? ["inventory", "shops", "gifts"] as const : [])];
  const primary = isPrimaryWorldView(view);
  return <section className={primary ? "player-actions world-views" : "player-secondary world-views"} aria-label="World views"
    onKeyDown={e => { if (e.key === "Escape" && !primary) { e.preventDefault(); move("explore"); } }}>
    <nav ref={nav} aria-label="World views">{modes.map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => move(mode)}>{labels[mode]}</button>)}</nav>
    {!primary && <h3 ref={heading} tabIndex={-1}>{labels[view]}</h3>}
    {view === "explore" && <PlayerWorldActions {...props} encounterOnly={!ended && Boolean(pending.eventId)} />}
    {view === "decisions" && (pending.eventId || pending.conflict ? <PlayerWorldActions {...props} encounterOnly /> : decisions)}
    {view === "map" && <PlayerWorldMap {...props} />}
    {view === "character" && <CharacterPanel world={world} state={state} />}
    {view === "journal" && <><JournalPanel world={world} state={state} />{world.progression && <details><summary>Milestone history</summary><WorldHistory world={world} state={state} /></details>}</>}
    {view === "history" && <WorldHistory world={world} state={state} />}
    {(view === "inventory" || view === "shops" || view === "gifts") && <EconomyPanel {...props}
      disabled={props.disabled || Boolean(pending.eventId) || pending.conflict} selectedView={view} reviewBoundary />}
    {!primary && <button onClick={() => move("explore")}>Back to exploration</button>}
  </section>;
}
