import { economyDependencies } from "./economy-authoring.js";
import { emptyWorldPeople, emptyWorldProgression, type WorldDefinition, type WorldPeople } from "@story-to-cyoa/domain";
import { Prerequisites, RemovalButton } from "./ProgressionEditor.js";
type Props = { world: WorldDefinition; onChange: (people: WorldPeople | undefined) => void };
export function PeopleEditor({ world, onChange }: Props) {
  const p = world.people, progression = world.progression ?? emptyWorldProgression();
  const locations = world.locations.filter((l) => l.passage);
  const options = (items: Array<{ id: string; name: string }>) => <><option value="">Select…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name || "Untitled"}</option>)}</>;
  const priority = (label: string, value: number, change: (value: number) => void) => <label>{label}<input type="number" min={-1000} max={1000} step={1} value={value} onChange={(e) => change(Number(e.target.value))} /></label>;
  return <section aria-label="People and schedules"><h3>People and schedules</h3>
    <label className="world-check"><input type="checkbox" checked={Boolean(p)} disabled={Boolean(world.economy?.gifts.length)} onChange={(e) => onChange(e.target.checked ? { ...emptyWorldPeople(), events: progression.events.map((event) => ({ eventId: event.id, priority: 0, mandatory: false, characterIds: [] })) } : undefined)} />People and schedules enabled</label>
    {world.economy?.gifts.length ? <p>Remove the authored gift rules before disabling people.</p> : null}
    {p && <>
      <p>Day 1–7 repeat weekly from the beginning of game time. Select all seven days for daily routines. Start minutes are inclusive; end minutes exclusive. Use 1440 for the end of a day; an earlier end crosses midnight.</p>
      <h4>People</h4>{p.characters.map((character, i) => <div className="world-row" key={character.id}>
        <label>Person name {i + 1}<input maxLength={200} value={character.name} onChange={(e) => onChange({ ...p, characters: p.characters.map((c, j) => i === j ? { ...c, name: e.target.value } : c) })} /></label>
        <RemovalButton label={`Remove person ${i + 1}`} instructions="Remove the listed schedules/overrides or clear the encounter presence selections and authored gift rules." dependencies={[
          ...economyDependencies(world, "person", character.id),
          ...p.schedules.flatMap((s, j) => s.characterId === character.id ? [`Schedule ${j + 1}`] : []),
          ...p.overrides.flatMap((o, j) => o.characterId === character.id ? [`Story override ${j + 1}`] : []),
          ...p.events.flatMap((r) => r.characterIds.includes(character.id) ? [`Encounter ${progression.events.find((e) => e.id === r.eventId)?.label ?? r.eventId}`] : []),
        ]} onRemove={() => onChange({ ...p, characters: p.characters.filter((_, j) => i !== j) })}>×</RemovalButton>
      </div>)}
      <button disabled={p.characters.length >= 30} onClick={() => onChange({ ...p, characters: [...p.characters, { id: crypto.randomUUID(), name: "" }] })}>Add person</button>
      <h4>Recurring schedules</h4>
      {p.schedules.map((slot, i) => { const patch = (next: Partial<typeof slot>) => onChange({ ...p, schedules: p.schedules.map((s, j) => i === j ? { ...s, ...next } : s) });
        return <fieldset className="progression-card" key={slot.id}><legend>Schedule {i + 1}</legend><div className="world-row">
          <label>Schedule {i + 1} person<select value={slot.characterId} onChange={(e) => patch({ characterId: e.target.value })}>{options(p.characters)}</select></label>
          <label>Schedule {i + 1} location<select value={slot.locationId} onChange={(e) => patch({ locationId: e.target.value })}>{options(locations)}</select></label>
          <label>Schedule {i + 1} start minute<input type="number" min={0} max={1439} step={1} value={slot.from} onChange={(e) => patch({ from: Number(e.target.value) })} /></label>
          <label>Schedule {i + 1} end minute<input type="number" min={0} max={1440} step={1} value={slot.until} onChange={(e) => patch({ until: Number(e.target.value) })} /></label>
        </div><fieldset><legend>Repeating days for schedule {i + 1}</legend>{Array.from({ length: 7 }, (_, day) => <label className="world-check" key={day}><input type="checkbox" checked={slot.days.includes(day)} onChange={(e) => patch({ days: e.target.checked ? [...slot.days, day].sort() : slot.days.filter((d) => d !== day) })} />Schedule {i + 1} Day {day + 1}</label>)}</fieldset>
          <button onClick={() => onChange({ ...p, schedules: p.schedules.filter((_, j) => i !== j) })}>Remove schedule {i + 1}</button>
        </fieldset>; })}
      <button disabled={p.schedules.length >= 200 || !p.characters.length || !locations.length} onClick={() => onChange({ ...p, schedules: [...p.schedules, { id: crypto.randomUUID(), characterId: p.characters[0]!.id, locationId: locations[0]!.id, days: [0, 1, 2, 3, 4, 5, 6], from: 480, until: 1020 }] })}>Add recurring schedule</button>
      <h4>Story overrides</h4><p>Matching overrides replace a person's routine. Higher priority wins; unresolved equal priorities are rejected. Select absent to remove a person temporarily. All listed prerequisites must hold.</p>
      {p.overrides.map((override, i) => { const patch = (next: Partial<typeof override>) => onChange({ ...p, overrides: p.overrides.map((o, j) => i === j ? { ...o, ...next } : o) });
        return <fieldset className="progression-card" key={override.id}><legend>Story override {i + 1}</legend><div className="world-row">
          <label>Override {i + 1} person<select value={override.characterId} onChange={(e) => patch({ characterId: e.target.value })}>{options(p.characters)}</select></label>
          <label>Override {i + 1} placement<select value={override.locationId ?? ""} onChange={(e) => patch({ locationId: e.target.value || null })}><option value="">Absent</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          {priority(`Override ${i + 1} priority`, override.priority, (priority) => patch({ priority }))}
        </div><Prerequisites label={`Override ${i + 1}`} conditions={override.prerequisites} onChange={(prerequisites) => patch({ prerequisites })} progression={progression} locations={world.locations} />
          <button onClick={() => onChange({ ...p, overrides: p.overrides.filter((_, j) => i !== j) })}>Remove story override {i + 1}</button>
        </fieldset>; })}
      <button disabled={p.overrides.length >= 100 || !p.characters.length} onClick={() => onChange({ ...p, overrides: [...p.overrides, { id: crypto.randomUUID(), characterId: p.characters[0]!.id, locationId: null, priority: 10, prerequisites: [] }] })}>Add story override</button>
      <h4>Encounter priorities</h4><p>Selected people must all be present at the player's location. Hidden encounters are discovered when their prerequisites and presence requirements hold. Required encounters block other confirmed actions until resolved; waiting stops at their first boundary. Use different priorities or mutually exclusive conditions for required encounters.</p>
      {!progression.events.length && <p>Add events under Chapters and events to author encounters.</p>}
      {p.events.map((rule, i) => { const patch = (next: Partial<typeof rule>) => onChange({ ...p, events: p.events.map((r, j) => i === j ? { ...r, ...next } : r) });
        return <fieldset className="progression-card" key={rule.eventId}><legend>Encounter: {progression.events.find((e) => e.id === rule.eventId)?.label || "Untitled event"}</legend>
          {priority(`Encounter ${i + 1} priority`, rule.priority, (priority) => patch({ priority }))}
          <label className="world-check"><input type="checkbox" checked={rule.mandatory} onChange={(e) => patch({ mandatory: e.target.checked })} />Encounter {i + 1} required</label>
          {p.characters.map((c) => <label className="world-check" key={c.id}><input type="checkbox" checked={rule.characterIds.includes(c.id)} onChange={(e) => patch({ characterIds: e.target.checked ? [...rule.characterIds, c.id] : rule.characterIds.filter((id) => id !== c.id) })} />Encounter {i + 1} requires {c.name || "untitled person"} present</label>)}
        </fieldset>; })}
    </>}
  </section>;
}
export function PeopleSummary({ world }: { world: WorldDefinition }) {
  const p = world.people;
  if (!p) return null;
  const character = (id: string) => p.characters.find((c) => c.id === id)?.name ?? id;
  const location = (id: string | null) => world.locations.find((l) => l.id === id)?.name ?? "Absent";
  const condition = (c: NonNullable<WorldDefinition["progression"]>["events"][number]["prerequisites"][number]) => c.kind === "chapter" ? `Chapter ${world.progression?.chapters.find((x) => x.id === c.chapterId)?.name ?? c.chapterId} ${c.current ? "current" : "not current"}` : c.kind === "milestone" ? `${world.progression?.milestones.find((x) => x.id === c.milestoneId)?.name ?? c.milestoneId} ${c.achieved ? "achieved" : "not achieved"}` : c.kind === "location" ? `${c.present ? "At" : "Not at"} ${location(c.locationId)}` : c.kind === "item" ? `Item ${c.itemId}: ${c.minimum}–${c.maximum ?? "no maximum"}` : c.kind === "relationship" ? `Relationship ${c.key}: ${c.minimum ?? "no minimum"}–${c.maximum ?? "no maximum"}` : `Minutes ${c.from ?? "start"}–${c.until ?? "no end"} (end exclusive)`;
  return <section aria-label="People and schedules summary"><h4>People and schedules</h4>
    {p.characters.map((c) => <p key={c.id}>{c.name}</p>)}
    {p.schedules.map((s) => <p key={s.id}>{character(s.characterId)} · {location(s.locationId)} · Day {s.days.map((d) => d + 1).join(", ")} weekly · {s.from}–{s.until} minutes{ s.until <= s.from ? " (overnight)" : ""}</p>)}
    {p.overrides.map((o, i) => <p key={o.id}>Override {i + 1}: {character(o.characterId)} → {location(o.locationId)} · priority {o.priority} · {o.prerequisites.map(condition).join("; ") || "Always"}</p>)}
    {p.events.map((r) => <p key={r.eventId}>{world.progression?.events.find((e) => e.id === r.eventId)?.label} · priority {r.priority} · {r.mandatory ? "Required" : "Optional"} · Requires: {r.characterIds.map(character).join(", ") || "No people"}</p>)}
  </section>;
}
