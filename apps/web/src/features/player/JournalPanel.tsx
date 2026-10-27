import { useState } from "react";
import { inspectWorldJournal, worldClock, type NativeWorld, type RuntimeState } from "@story-to-cyoa/runtime";
export function CharacterPanel({ world, state }: { world: NativeWorld; state: RuntimeState }) {
  const view = inspectWorldJournal(world, state);
  return <section aria-label="Character details">{view.character.length ? <dl>{view.character.map((m) => <div key={m.category + m.key}><dt>{m.label}</dt><dd>{m.value}</dd></div>)}</dl> : <p>No character details disclosed.</p>}</section>;
}
export function JournalPanel({ world, state }: { world: NativeWorld; state: RuntimeState }) {
  const [page, setPage] = useState<"objectives" | "entries" | "places" | "events">("objectives"), view = inspectWorldJournal(world, state);
  return <section aria-label="Journal details"><nav aria-label="Journal sections">{([['objectives', 'Objectives'], ['entries', 'Entries'], ['places', 'Places'], ['events', 'Events']] as const).map(([key, label]) => <button key={key} aria-pressed={page === key} onClick={() => setPage(key)}>{label}</button>)}</nav>
    {page === "objectives" && <section aria-label="Objectives"><h4>Active objectives</h4>{view.objectives.map((o) => <article key={o.id}><h5>{o.title}</h5><p>{o.description}</p></article>)}{!view.objectives.length && <p>No active objectives disclosed.</p>}{view.completedObjectives.length > 0 && <><h4>Completed objectives</h4><ul>{view.completedObjectives.map((o) => <li key={o.id}>{o.title}</li>)}</ul></>}</section>}
    {page === "entries" && <section aria-label="Journal entries"><h4>Journal entries</h4>{view.entries.map((e) => <article key={e.id}><h5>{e.title}</h5><p className="journal-text">{e.text}</p></article>)}{!view.entries.length && <p>No journal entries recorded.</p>}</section>}
    {page === "places" && <section aria-label="Discovered locations"><h4>Discovered locations</h4><ul>{view.locations.map((l) => <li key={l.id}>{l.name}</li>)}</ul></section>}
    {page === "events" && <section aria-label="Recorded events"><h4>Recorded events</h4>{view.events.map((e) => <article key={e.id}><h5>{e.label}</h5><p className="journal-text">{e.result}</p><small>Completed {e.count} {e.count === 1 ? "time" : "times"} · Last began {worldClock(e.lastMinutes)}</small></article>)}{!view.events.length && <p>No events recorded.</p>}</section>}
  </section>;
}
