import { WorldViews } from "./WorldViews.js";
import { economyFeedback } from "./economy-feedback.js";
import { EconomyPanel } from "./EconomyPanel.js";
import { useState } from "react";
import { worldClock, worldLocationOpen, presentCharacters, mandatoryEventStatus, prerequisitesMet, progressionEventAvailability, previewChapterTransition, type ChapterTransitionPreview, type NativeWorld, type RuntimeState, type WorldCommand } from "@story-to-cyoa/runtime";
import "./world.css";

export function WorldPanelCore({ world, state, disabled, onAction }: { world: NativeWorld; state: RuntimeState; disabled: boolean; onAction: (command: WorldCommand, label: string, preview?: ChapterTransitionPreview) => void; onViewChange?: (view: string) => void }) {
  const current = world.locations.find((l) => l.id === state.world!.locationId)!;
  const [mapId, setMapId] = useState<string | null>(null), [inspected, setInspected] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const knownLocations = world.journal ? world.locations.filter((l) => state.world!.journal!.knownLocationIds.includes(l.id)) : world.locations;
  const map = knownLocations.find((l) => l.id === mapId) ?? world.locations.find((l) => l.id === current.parentId) ?? current;
  const image = world.assets.find((a) => a.id === map.mapImage);
  const destination = knownLocations.find((l) => l.id === inspected);
  const pending = mandatoryEventStatus(world, state), actionDisabled = disabled || pending.conflict || Boolean(pending.eventId);
  const people = presentCharacters(world, state);
  const events = world.people ? [...(world.progression?.events ?? [])].sort((a, b) => (world.people!.events.find((r) => r.eventId === b.id)?.priority ?? 0) - (world.people!.events.find((r) => r.eventId === a.id)?.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : world.progression?.events ?? [];
  const travel = (id: string) => world.connections.filter((c) => c.from === current.id && c.to === id);
  return <section className="world-panel" aria-label="Locations and time">
    <header><strong>{current.name}</strong><time aria-label="Game time">{worldClock(state.world!.minutes)}</time></header>
    {world.people && <section aria-label="People present"><p>Here now: {people.map((p) => p.name).join(", ") || "No one encountered"}</p></section>}
    {pending.conflict && <p role="alert">Competing required encounters. The author must resolve event priorities.</p>}
    {pending.eventId && <p role="status">Required encounter: {world.progression!.events.find((e) => e.id === pending.eventId)!.label}. Complete it before another action.</p>}
    {world.progression && state.world!.progression && <section aria-label="Chapters and milestones">
      <p><strong>{state.world!.progression!.chapterId ? `Chapter: ${world.progression.chapters.find((c) => c.id === state.world!.progression!.chapterId)!.name}` : "Chapter-free play"}</strong></p>
      <p>Milestones: {world.progression.milestones.filter((m) => state.world!.progression!.milestones.includes(m.id)).map((m) => m.name).join(", ") || "None yet"}</p>
      <nav aria-label="Events">{events.map((event) => { const availability = progressionEventAvailability(world, state, event.id), trade = world.economy?.eventEffects.find((r) => r.eventId === event.id), feedback = trade && world.economy ? economyFeedback(world.economy, trade.costs, trade.effects) : ""; return availability.visible && <button key={event.id} disabled={disabled || !availability.enabled} title={availability.reason ?? event.label}
        onClick={() => onAction({ kind: "event", id: event.id }, `${event.label} (${event.minutes} min)${feedback ? "; " + feedback : ""}`)}>{event.label} · {event.minutes} min{feedback ? ` · ${feedback}` : ""}{availability.reason ? ` · ${availability.reason}` : ""}</button>; })}</nav>
      <nav aria-label="Chapter transitions">{world.progression.transitions.filter((transition) => transition.fromChapterId === state.world!.progression!.chapterId).map((transition) => <button key={transition.id} disabled={actionDisabled || state.world!.minutes + transition.minutes > 52_560_000 || !prerequisitesMet(transition.prerequisites, state)}
        onClick={() => { const preview = previewChapterTransition(world, state, transition.id); onAction({ kind: "chapter-transition", id: transition.id, previewFingerprint: preview.fingerprint }, `${transition.label} (${transition.minutes} min)`, preview); }}>{transition.label} · {transition.minutes} min</button>)}</nav>
    </section>}
    {world.economy && !world.journal && <EconomyPanel world={world} state={state} disabled={actionDisabled} onAction={onAction} />}
    <details><summary>Map</summary>
      <label>Area<select value={map.id} onChange={(e) => { setMapId(e.target.value); setInspected(null); }}>{knownLocations.map((l) => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
      <div className="world-map">
        {image && !failedImages.includes(image.id) && <img src={image.dataUrl} alt={image.altText} onError={() => setFailedImages((old) => [...old, image.id])} />}
        {image && !failedImages.includes(image.id) && knownLocations.filter((l) => l.parentId === map.id && l.marker).map((l, i) => <button className="world-marker" key={l.id}
          style={{ left: `clamp(18px, ${l.marker!.x}%, calc(100% - 18px))`, top: `clamp(18px, ${l.marker!.y}%, calc(100% - 18px))` }}
          title={l.name} aria-label={`Inspect ${l.name}`} onClick={() => setInspected(l.id)}>{i + 1}</button>)}
        {(!image || failedImages.includes(image.id)) && <strong>{image?.altText ?? map.name}</strong>}
      </div>
      <nav aria-label="Map locations">{knownLocations.filter((l) => l.parentId === map.id).map((l) => <button key={l.id} aria-pressed={inspected === l.id} onClick={() => setInspected(l.id)}>{l.name}</button>)}</nav>
      {image && (image.credit || image.license) && <small>{image.credit} {image.license}</small>}
      {destination && <section aria-label="Destination"><h3>{destination.name}</h3><p>{worldLocationOpen(world, destination.id, state.world!.minutes) ? "Open now" : "Closed now"}</p>
        {travel(destination.id).map((c) => <button key={c.id} disabled={actionDisabled || !worldLocationOpen(world, c.to, state.world!.minutes + c.minutes)} onClick={() => onAction({ kind: "travel", id: c.id }, `Travel to ${destination.name} (${c.minutes} min)`)}>Travel to {destination.name} ({c.minutes} min)</button>)}
        {destination.id !== current.id && !travel(destination.id).length && <p>No direct connection.</p>}
      </section>}
    </details>
    <nav aria-label="Travel">{world.connections.filter((c) => c.from === current.id && knownLocations.some((l) => l.id === c.to)).map((c) => {
      const name = world.locations.find((l) => l.id === c.to)!.name, open = worldLocationOpen(world, c.to, state.world!.minutes + c.minutes);
      return <button key={c.id} disabled={actionDisabled || !open} title={open ? name : "Closed at arrival"} onClick={() => onAction({ kind: "travel", id: c.id }, `Travel to ${name} (${c.minutes} min)`)}>{name} · {c.minutes} min{!open ? " · Closed at arrival" : ""}</button>;
    })}</nav>
    <nav aria-label="Local actions">{world.actions.filter((a) => a.locationId === current.id).map((a) => <button key={a.id} disabled={actionDisabled} onClick={() => onAction({ kind: "action", id: a.id }, `${a.label} (${a.minutes} min)`)}>{a.label} · {a.minutes} min</button>)}</nav>
    <nav aria-label="Wait">{world.waitMinutes.map((minutes) => <button key={minutes} disabled={actionDisabled} onClick={() => onAction({ kind: "wait", minutes }, `Wait ${minutes} minutes`)}>Wait {minutes} min</button>)}</nav>
  </section>;
}

export function WorldPanel(props: Parameters<typeof WorldPanelCore>[0]) { return props.world.journal ? <WorldViews {...props} /> : <WorldPanelCore {...props} />; }
