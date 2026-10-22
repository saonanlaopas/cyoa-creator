import { useState } from "react";
import { worldClock, worldLocationOpen, type NativeWorld, type RuntimeState, type WorldCommand } from "@story-to-cyoa/runtime";
import "./world.css";

export function WorldPanel({ world, state, disabled, onAction }: { world: NativeWorld; state: RuntimeState; disabled: boolean; onAction: (command: WorldCommand, label: string) => void }) {
  const current = world.locations.find((l) => l.id === state.world!.locationId)!;
  const [mapId, setMapId] = useState<string | null>(null), [inspected, setInspected] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const map = world.locations.find((l) => l.id === mapId) ?? world.locations.find((l) => l.id === current.parentId) ?? current;
  const image = world.assets.find((a) => a.id === map.mapImage);
  const destination = world.locations.find((l) => l.id === inspected);
  const travel = (id: string) => world.connections.filter((c) => c.from === current.id && c.to === id);
  return <section className="world-panel" aria-label="Locations and time">
    <header><strong>{current.name}</strong><time aria-label="Game time">{worldClock(state.world!.minutes)}</time></header>
    <details><summary>Map</summary>
      <label>Area<select value={map.id} onChange={(e) => { setMapId(e.target.value); setInspected(null); }}>{world.locations.map((l) => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
      <div className="world-map">
        {image && !failedImages.includes(image.id) && <img src={image.dataUrl} alt={image.altText} onError={() => setFailedImages((old) => [...old, image.id])} />}
        {image && !failedImages.includes(image.id) && world.locations.filter((l) => l.parentId === map.id && l.marker).map((l, i) => <button className="world-marker" key={l.id}
          style={{ left: `clamp(18px, ${l.marker!.x}%, calc(100% - 18px))`, top: `clamp(18px, ${l.marker!.y}%, calc(100% - 18px))` }}
          title={l.name} aria-label={`Inspect ${l.name}`} onClick={() => setInspected(l.id)}>{i + 1}</button>)}
        {(!image || failedImages.includes(image.id)) && <strong>{image?.altText ?? map.name}</strong>}
      </div>
      <nav aria-label="Map locations">{world.locations.filter((l) => l.parentId === map.id).map((l) => <button key={l.id} aria-pressed={inspected === l.id} onClick={() => setInspected(l.id)}>{l.name}</button>)}</nav>
      {image && (image.credit || image.license) && <small>{image.credit} {image.license}</small>}
      {destination && <section aria-label="Destination"><h3>{destination.name}</h3><p>{worldLocationOpen(world, destination.id, state.world!.minutes) ? "Open now" : "Closed now"}</p>
        {travel(destination.id).map((c) => <button key={c.id} disabled={disabled || !worldLocationOpen(world, c.to, state.world!.minutes + c.minutes)} onClick={() => onAction({ kind: "travel", id: c.id }, `Travel to ${destination.name} (${c.minutes} min)`)}>Travel to {destination.name} ({c.minutes} min)</button>)}
        {destination.id !== current.id && !travel(destination.id).length && <p>No direct connection.</p>}
      </section>}
    </details>
    <nav aria-label="Travel">{world.connections.filter((c) => c.from === current.id).map((c) => {
      const name = world.locations.find((l) => l.id === c.to)!.name, open = worldLocationOpen(world, c.to, state.world!.minutes + c.minutes);
      return <button key={c.id} disabled={disabled || !open} title={open ? name : "Closed at arrival"} onClick={() => onAction({ kind: "travel", id: c.id }, `Travel to ${name} (${c.minutes} min)`)}>{name} · {c.minutes} min{!open ? " · Closed at arrival" : ""}</button>;
    })}</nav>
    <nav aria-label="Local actions">{world.actions.filter((a) => a.locationId === current.id).map((a) => <button key={a.id} disabled={disabled} onClick={() => onAction({ kind: "action", id: a.id }, `${a.label} (${a.minutes} min)`)}>{a.label} · {a.minutes} min</button>)}</nav>
    <nav aria-label="Wait">{world.waitMinutes.map((minutes) => <button key={minutes} disabled={disabled} onClick={() => onAction({ kind: "wait", minutes }, `Wait ${minutes} minutes`)}>Wait {minutes} min</button>)}</nav>
  </section>;
}
