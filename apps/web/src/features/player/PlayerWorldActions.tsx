import { useId, useRef, useState } from "react";
import {
  mandatoryEventStatus, OUTSIDE_PLAYTEST, playtestActionKey, prerequisitesMet,
  progressionEventAvailability, previewChapterTransition, visiblePlaytestRestrictions, worldLocationOpen,
  type ChapterTransitionPreview, type NativePreviewStop, type NativeWorld, type RuntimeState, type WorldCommand,
} from "@story-to-cyoa/runtime";
import { economyFeedback } from "./economy-feedback.js";
import "./world.css";
import "./player-world-actions.css";

export type WorldActionHandler = (command: WorldCommand, label: string, preview?: ChapterTransitionPreview) => void;
export type WorldActionProps = { world: NativeWorld; state: RuntimeState; disabled: boolean; onAction: WorldActionHandler; preview?: NativePreviewStop };

const visibleLocations = (world: NativeWorld, state: RuntimeState) =>
  world.journal ? world.locations.filter(location => state.world!.journal?.knownLocationIds.includes(location.id)) : world.locations;

function travelOptions({ world, state, disabled, onAction }: WorldActionProps) {
  const known = visibleLocations(world, state);
  const pending = mandatoryEventStatus(world, state);
  return world.connections.flatMap(connection => {
    if (connection.from !== state.world!.locationId) return [];
    const destination = known.find(location => location.id === connection.to);
    if (!destination) return [];
    const arrival = state.world!.minutes + connection.minutes;
    const reason = pending.conflict ? "Travel is unavailable right now" : pending.eventId ? "Complete the required encounter first"
      : arrival > 52_560_000 ? "Game time limit" : !worldLocationOpen(world, destination.id, arrival) ? "Closed at arrival" : null;
    return [{ connection, destination, reason, disabled: disabled || Boolean(reason),
      select: () => onAction({ kind: "travel", id: connection.id }, `Travel to ${destination.name} (${connection.minutes} min)`) }];
  });
}

export function PlayerWorldTravel(props: WorldActionProps) {
  const travel = travelOptions(props);
  if (!travel.length) return null;
  return <section className="player-travel">
    <h2>Nearby destinations</h2>
    <p>Looking is free. Confirmed travel spends time.</p>
    <nav aria-label="Travel">{travel.map(item => <button key={item.connection.id} disabled={item.disabled} onClick={item.select}>
      {item.destination.name} · {item.connection.minutes} min{item.reason && ` · ${item.reason}`}
    </button>)}</nav>
  </section>;
}

export function PlayerWorldActions(props: WorldActionProps & { encounterOnly?: boolean }) {
  const { world, state, disabled, onAction, preview, encounterOnly } = props, position = state.world!;
  const pending = mandatoryEventStatus(world, state);
  const blocked = disabled || pending.conflict || Boolean(pending.eventId);
  const events = (world.progression?.events ?? []).flatMap(event => {
    const availability = progressionEventAvailability(world, state, event.id);
    if (!availability.visible || (encounterOnly && event.id !== pending.eventId)) return [];
    if (event.prerequisites.some(item => item.kind === "location" && item.present && item.locationId !== position.locationId)) return [];
    if (!availability.enabled && (Object.hasOwn(position.progression?.events ?? {}, event.id) || availability.reason === "Expired")) return [];
    return [{ event, availability }];
  });
  const transitions = (world.progression?.transitions ?? []).filter(item => item.fromChapterId === position.progression?.chapterId
    && !item.prerequisites.some(condition => condition.kind === "location" && condition.present && condition.locationId !== position.locationId));
  const local = world.actions.filter(item => item.locationId === position.locationId);
  const outside = visiblePlaytestRestrictions(preview, state, false).filter(item => !["purchase", "gift", "use"].includes(item.kind));
  return <div className="player-activities">
    {pending.conflict && <p role="alert">Required encounters conflict. Actions are unavailable.</p>}
    {pending.eventId && <p role="status">Required encounter: {world.progression!.events.find(event => event.id === pending.eventId)!.label}. Complete it before another action.</p>}
    {events.length > 0 && <nav aria-label="Events">{events.map(({ event, availability }) => {
      const trade = world.economy?.eventEffects.find(rule => rule.eventId === event.id);
      const feedback = trade ? economyFeedback(world.economy!, trade.costs, trade.effects) : "";
      return <button key={event.id} disabled={disabled || !availability.enabled}
        onClick={() => onAction({ kind: "event", id: event.id }, `${event.label} (${event.minutes} min)${feedback ? "; " + feedback : ""}`)}>
        {event.label} · {event.minutes} min{feedback && ` · ${feedback}`}{availability.reason && ` · ${availability.reason}`}
      </button>;
    })}</nav>}
    {!encounterOnly && <>
      {local.length > 0 && <nav aria-label="Local actions">{local.map(action => <button key={action.id} disabled={blocked}
        onClick={() => onAction({ kind: "action", id: action.id }, `${action.label} (${action.minutes} min)`)}>{action.label} · {action.minutes} min</button>)}</nav>}
      {world.waitMinutes.length > 0 && <details className="player-wait"><summary>Wait…</summary>
        <nav aria-label="Wait">{world.waitMinutes.map(minutes => <button key={minutes} disabled={blocked}
          onClick={() => onAction({ kind: "wait", minutes }, `Wait ${minutes} minutes`)}>Wait {minutes} min</button>)}</nav>
      </details>}
      {transitions.length > 0 && <nav aria-label="Chapter transitions">{transitions.map(item => {
        const reason = position.minutes + item.minutes > 52_560_000 ? "Game time limit"
          : !prerequisitesMet(item.prerequisites, state) ? "Prerequisites not met" : null;
        return <div key={item.id}><button disabled={blocked || Boolean(reason)} title={reason ?? undefined} onClick={() => {
          const review = previewChapterTransition(world, state, item.id);
          onAction({ kind: "chapter-transition", id: item.id, previewFingerprint: review.fingerprint }, `${item.label} (${item.minutes} min)`, review);
        }}>{item.label} · {item.minutes} min</button>{reason && <small>{reason}</small>}</div>;
      })}</nav>}
      {outside.length > 0 && <nav aria-label="Unavailable World actions">{outside.map(item => <button key={playtestActionKey(item)} disabled>{OUTSIDE_PLAYTEST}</button>)}</nav>}
    </>}
  </div>;
}

export function PlayerWorldMap(props: WorldActionProps) {
  const { world, state } = props, known = visibleLocations(world, state), travel = travelOptions(props), arrow = useId();
  const current = known.find(location => location.id === state.world!.locationId)!;
  const [area, setArea] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null), [failed, setFailed] = useState<string[]>([]);
  const destinationHeading = useRef<HTMLHeadingElement>(null);
  const map = known.find(location => location.id === area) ?? known.find(location => location.id === current.parentId) ?? current;
  const children = known.filter(location => location.parentId === map.id), points = children.filter(location => location.marker);
  const names = new Map(known.map(location => [location.id, location]));
  const image = world.assets.find(asset => asset.id === map.mapImage && !failed.includes(asset.id));
  const edges = world.connections.filter(connection => names.has(connection.from) && names.has(connection.to)
    && (connection.from === map.id || connection.to === map.id || children.some(location => location.id === connection.from || location.id === connection.to)));
  const destination = known.find(location => location.id === selected);
  const destinationRoutes = travel.filter(item => item.destination.id === destination?.id);
  const destinations = [...new Map([current, ...children, ...travel.map(item => item.destination)].map(location => [location.id, location])).values()];
  const inspect = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => destinationHeading.current?.focus());
  };
  const labelX = (x: number) => Math.max(13, Math.min(87, x));
  const labelY = (y: number) => Math.max(15, Math.min(88, y));
  const marker = (id: string) => {
    const point = points.find(candidate => candidate.id === id)?.marker;
    return point && { x: labelX(point.x), y: labelY(point.y) };
  };
  return <section aria-label="World map" className="player-map">
    <p className="map-origin"><strong>You are here:</strong> {current.name}</p>
    <p className="map-note">Looking is free. Confirmed travel spends time.</p>
    <label className="map-area">Area<select value={map.id} onChange={e => { setArea(e.target.value); setSelected(null); }}>{known.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
    {(image || points.length > 0) && <div className={`world-map ${image ? "" : "world-map-schematic"}`}>
      {image ? <img src={image.dataUrl} alt={image.altText} onError={() => setFailed(old => [...old, image.id])} /> : <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs><marker id={arrow} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3 0 6z" fill="currentColor" /></marker></defs>
        {edges.map(edge => { const from = marker(edge.from), to = marker(edge.to); return from && to &&
          <polyline key={edge.id} points={`${from.x},${from.y} ${from.x + (to.x - from.x) * 0.65},${from.y + (to.y - from.y) * 0.65} ${to.x},${to.y}`}
            markerMid={`url(#${arrow})`} />; })}
      </svg>}
      {points.map(location => {
        const { x, y } = location.marker!, isHere = location.id === current.id;
        const routes = travel.filter(item => item.destination.id === location.id);
        const crowded = !isHere && points.some(other => other.id !== location.id
          && Math.abs(labelX(other.marker!.x) - labelX(x)) < 26 && Math.abs(labelY(other.marker!.y) - labelY(y)) < 26);
        return <button className="player-map-marker" data-current={isHere} key={location.id}
          data-label-above={y >= 73} style={{ left: `${labelX(x)}%`, top: `${labelY(y)}%` }}
          title={location.name} aria-label={`Inspect ${location.name}${isHere ? ", you are here" : ""}`}
          aria-pressed={selected === location.id} onClick={() => inspect(location.id)}>
          <span className="map-pin-dot" aria-hidden="true" />
          {!crowded && <span className="map-pin-caption"><strong>{location.name}</strong>
            <small>{isHere ? "You are here" : routes.length === 1 ? `${routes[0]!.connection.minutes} min` : null}</small>
          </span>}
        </button>;
      })}
    </div>}
    {image && (image.credit || image.license) && <small>{image.credit} {image.license}</small>}
    {destination && <section className="map-destination" aria-label="Destination"><h4 ref={destinationHeading} tabIndex={-1}>{destination.name}</h4>
      {destination.id === current.id && <p>You are here.</p>}
      {destinationRoutes.map(item => <div className="map-destination-route" key={item.connection.id}>
        <button disabled={item.disabled} onClick={item.select}>Travel to {destination.name} · {item.connection.minutes} min</button>
        {item.reason && <small>{item.reason}</small>}
      </div>)}
      {destination.id !== current.id && !destinationRoutes.length && <p>No direct route from {current.name}.</p>}
    </section>}
    <details className="map-location-list" open={points.length === 0}><summary>Locations</summary>
    <nav aria-label="Map locations">{destinations.map(location => {
      const routes = travel.filter(item => item.destination.id === location.id);
      return <button key={location.id} aria-pressed={selected === location.id} onClick={() => inspect(location.id)}>
        {location.name}{location.id === current.id ? " · You are here" : ""}{routes.length > 0 && ` · ${routes.map(item => `${item.connection.minutes} min${item.reason ? ` (${item.reason})` : ""}`).join(" / ")}`}
      </button>;
    })}</nav>
    </details>
    {!!edges.length && <details className="map-connections"><summary>Connections</summary>
      <ul>{edges.map(edge => <li key={edge.id}>{names.get(edge.from)!.name} to {names.get(edge.to)!.name}: {edge.minutes} min</li>)}</ul>
    </details>}
  </section>;
}
