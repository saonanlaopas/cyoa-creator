import { useRef } from "react";
import { createPortal } from "react-dom";
import { Clock3, Map as MapIcon, Backpack } from "lucide-react";
import { mandatoryEventStatus, presentCharacters, progressionEventAvailability, visiblePlaytestRestrictions, worldClock } from "@story-to-cyoa/runtime";
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
    <strong>{current.name}</strong><time aria-label="Game time"><Clock3 className="player-tool-icon" aria-hidden="true" />{worldClock(state.world!.minutes)}</time>
    {chapter && <span>Chapter: {chapter.name}</span>}
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

export function PlayerWorldViews(props: WorldActionProps & { rail?: HTMLElement | null; view: PlayerWorldView; select: (view: PlayerWorldView) => void; decisions: ReactNode; hasDecisions: boolean; ended: boolean; onReturnFromMap: () => void }) {
  const { world, state, view, select, decisions, hasDecisions, ended } = props;
  const heading = useRef<HTMLHeadingElement>(null), nav = useRef<HTMLElement>(null);
  const pending = mandatoryEventStatus(world, state);
  const primary = isPrimaryWorldView(view);
  const returnView = useRef<PlayerWorldView>("explore");
  const canDecide = !ended && hasDecisions && !pending.eventId && !pending.conflict;
  const back = returnView.current === "decisions" && canDecide ? "decisions" : "explore";
  const move = (next: PlayerWorldView) => {
    if (primary && !isPrimaryWorldView(next)) returnView.current = view;
    select(next);
    if (view === "map" && isPrimaryWorldView(next)) {
      props.onReturnFromMap();
      return;
    }
    requestAnimationFrame(() => {
      if (isPrimaryWorldView(next)) nav.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
      else heading.current?.focus();
    });
  };
  const toolViews: PlayerWorldView[] = ["map", ...(world.journal ? ["character", "journal"] as const : world.progression ? ["history"] as const : []),
    ...(world.economy ? ["inventory"] as const : [])];
  const tradeViews: PlayerWorldView[] = world.economy ? ["shops", "gifts"] : [];
  const here = state.world!.locationId;
  const hasShop = world.economy?.shops.some(shop => shop.locationId === here);
  const hasGift = world.economy?.gifts.length && presentCharacters(world, state)
    .some(person => world.economy!.gifts.some(gift => gift.characterId === person.id));
  const reviewed = visiblePlaytestRestrictions(props.preview, state, false);
  const localTrade = view === "explore" && !ended && !pending.eventId && !pending.conflict
    ? tradeViews.filter(mode => mode === "shops" ? hasShop || reviewed.some(item => item.kind === "purchase")
      : hasGift || reviewed.some(item => item.kind === "gift")) : [];
  const buttons = (modes: PlayerWorldView[]) => modes.map(mode =>
    <button key={mode} aria-pressed={view === mode} onClick={() => move(mode)}>
      {mode === "map" ? <MapIcon className="player-tool-icon" aria-hidden="true" /> : mode === "inventory" ? <Backpack className="player-tool-icon" aria-hidden="true" /> : null}{labels[mode]}</button>);
  const navigation = <nav ref={nav} aria-label="World views" className="player-view-nav">
      <div className="player-primary-modes">{buttons(canDecide ? ["explore", "decisions"] : ["explore"])}</div>
      <div className="player-side-tools">{buttons(toolViews)}</div>
    </nav>;
  return <section className={primary ? "player-actions world-views" : "player-secondary world-views"} aria-label="World views"
    onKeyDown={e => { if (e.key === "Escape" && !primary) { e.preventDefault(); move(back); } }}>
    {props.rail ? createPortal(navigation, props.rail) : navigation}
    {localTrade.length > 0 && <div className="player-local-tools"><strong>Trade here</strong>{buttons(localTrade)}</div>}
    {!primary && <h3 ref={heading} tabIndex={-1}>{labels[view]}</h3>}
    {view === "explore" && <PlayerWorldActions {...props} encounterOnly={!ended && Boolean(pending.eventId)} />}
    {view === "decisions" && (pending.eventId || pending.conflict ? <PlayerWorldActions {...props} encounterOnly /> : decisions)}
    {view === "map" && <PlayerWorldMap {...props} />}
    {view === "character" && <CharacterPanel world={world} state={state} />}
    {view === "journal" && <><JournalPanel world={world} state={state} />{world.progression && <details><summary>Milestone history</summary><WorldHistory world={world} state={state} /></details>}</>}
    {view === "history" && <WorldHistory world={world} state={state} />}
    {(view === "inventory" || view === "shops" || view === "gifts") && <EconomyPanel {...props}
      disabled={props.disabled || Boolean(pending.eventId) || pending.conflict} selectedView={view} reviewBoundary />}
    {!primary && <button onClick={() => move(back)}>{back === "decisions" ? "Back to decisions" : "Back to exploration"}</button>}
  </section>;
}
