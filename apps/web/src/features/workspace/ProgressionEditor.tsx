import { emptyWorldProgression, type WorldProgression, type WorldDefinition } from "@story-to-cyoa/domain";
import type { PassagePlanState } from "../../api/passage-plan.js";
import { useId, type ReactNode } from "react";

type Conditions = WorldProgression["events"][number]["prerequisites"];
type Props = { progression: WorldProgression | undefined; onChange: (value: WorldProgression | undefined) => void;
  locations: WorldDefinition["locations"]; passages: PassagePlanState["passages"] };
const toggle = (ids: string[], id: string, checked: boolean) => checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id);
export function ProgressionEditor({ progression: p, onChange, locations, passages }: Props) {
  const options = (items: Array<{ id: string; name: string }>) => <><option value="">Select…</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name || "Untitled"}</option>)}</>;
  const passageSelect = (value: WorldProgression["events"][number]["passage"], change: (next: WorldProgression["events"][number]["passage"]) => void, label: string) => <label>{label}<select value={value?.passageId ?? ""} onChange={(e) => { const passage = passages.find((item) => item.entityId === e.target.value); change(passage ? { passageId: passage.entityId, versionId: passage.id } : null); }}><option value="">Stay in the current passage</option>{value && !passages.some((item) => item.entityId === value.passageId) && <option value={value.passageId}>Missing bound passage</option>}{passages.map((item) => <option value={item.entityId} key={item.entityId}>{item.content.title}</option>)}</select></label>;
  const number = (label: string, value: number, change: (value: number) => void) => <label>{label}<input type="number" min={0} max={1440} step={1} value={value} onChange={(e) => change(Number(e.target.value))} /></label>;
  return <section aria-label="Chapters and events"><h3>Chapters and events</h3>
    <label className="world-check"><input type="checkbox" checked={Boolean(p)} onChange={(e) => {
      if (!e.target.checked) { onChange(undefined); return; }
      const chapter = { id: crypto.randomUUID(), name: "Chapter 1", final: false };
      onChange({ ...emptyWorldProgression(), chapters: [chapter], initialChapterId: chapter.id });
    }} />Chapters and events enabled</label>
    {p && <>
      <p>Chapters are optional. Events are authored opportunities the player chooses to begin; reading and transition previews do not advance time.</p>
      <h4>Chapters</h4>
      {!p.chapters.length && <p>Chapter-free play: events and milestones work without chapter transitions.</p>}
      <label>Initial chapter<select value={p.initialChapterId ?? ""} onChange={(e) => onChange({ ...p, initialChapterId: e.target.value || null })}><option value="">{p.chapters.length ? "Select initial chapter…" : "Chapter-free"}</option>{p.chapters.map((c) => <option key={c.id} value={c.id}>{c.name || "Untitled"}</option>)}</select></label>
      {p.chapters.map((chapter, i) => <div className="world-row" key={chapter.id}>
        <label>Chapter name {i + 1}<input maxLength={200} value={chapter.name} onChange={(e) => onChange({ ...p, chapters: p.chapters.map((c, j) => i === j ? { ...c, name: e.target.value } : c) })} /></label>
        <label className="world-check"><input type="checkbox" checked={chapter.final} onChange={(e) => onChange({ ...p, chapters: p.chapters.map((c, j) => i === j ? { ...c, final: e.target.checked } : c) })} />Final chapter {i + 1}</label>
        <button aria-label={`Remove chapter ${i + 1}`} onClick={() => onChange({ ...p, chapters: p.chapters.filter((_, j) => i !== j), initialChapterId: p.initialChapterId === chapter.id ? null : p.initialChapterId })}>×</button>
      </div>)}
      <button disabled={p.chapters.length >= 20} onClick={() => { const id = crypto.randomUUID(); onChange({ ...p, chapters: [...p.chapters, { id, name: "", final: false }], initialChapterId: p.chapters.length ? p.initialChapterId : id }); }}>Add chapter</button>
      <h4>Named milestones</h4>
      {p.milestones.map((milestone, i) => {
        const dependencies = [...p.events.flatMap((event, j) => [
          ...(event.milestoneIds.includes(milestone.id) ? [`Event ${j + 1} (${event.label || "Untitled"}): milestone grant`] : []),
          ...(event.prerequisites.some((c) => c.kind === "milestone" && c.milestoneId === milestone.id) ? [`Event ${j + 1} (${event.label || "Untitled"}): prerequisite`] : []),
        ]), ...p.transitions.flatMap((transition, j) => [
          ...(transition.carryMilestoneIds.includes(milestone.id) ? [`Transition ${j + 1} (${transition.label || "Untitled"}): carried milestone`] : []),
          ...(transition.prerequisites.some((c) => c.kind === "milestone" && c.milestoneId === milestone.id) ? [`Transition ${j + 1} (${transition.label || "Untitled"}): prerequisite`] : []),
        ])];
        return <div className="world-row" key={milestone.id}>
        <label>Milestone name {i + 1}<input maxLength={200} value={milestone.name} onChange={(e) => onChange({ ...p, milestones: p.milestones.map((m, j) => i === j ? { ...m, name: e.target.value } : m) })} /></label>
        <label className="world-check"><input type="checkbox" checked={p.initialMilestoneIds.includes(milestone.id)} onChange={(e) => onChange({ ...p, initialMilestoneIds: toggle(p.initialMilestoneIds, milestone.id, e.target.checked) })} />Initially achieved {i + 1}</label>
        <RemovalButton label={`Remove milestone ${i + 1}`} dependencies={dependencies} onRemove={() => onChange({ ...p, milestones: p.milestones.filter((_, j) => i !== j), initialMilestoneIds: p.initialMilestoneIds.filter((id) => id !== milestone.id) })}>×</RemovalButton>
      </div>; })}
      <button disabled={p.milestones.length >= 100} onClick={() => onChange({ ...p, milestones: [...p.milestones, { id: crypto.randomUUID(), name: "" }] })}>Add milestone</button>
      <h4>Events</h4>
      {p.events.map((event, i) => { const patch = (value: Partial<typeof event>) => onChange({ ...p, events: p.events.map((e, j) => i === j ? { ...e, ...value } : e) });
        return <fieldset className="progression-card" key={event.id}><legend>Event {i + 1}</legend><div className="world-row">
          <label>Event label {i + 1}<input maxLength={200} value={event.label} onChange={(e) => patch({ label: e.target.value })} /></label>
          <label>Event visibility {i + 1}<select value={event.visibility} onChange={(e) => patch({ visibility: e.target.value as typeof event.visibility })}><option value="always">Always shown</option><option value="when-available">Shown when available</option></select></label>
          <label>Event repeat {i + 1}<select value={event.repeat.kind} onChange={(e) => patch({ repeat: e.target.value === "repeatable" ? { kind: "repeatable", cooldownMinutes: 15 } : { kind: e.target.value as "once" | "once-per-day" | "once-per-chapter" } })}><option value="once">Once per playthrough</option><option value="repeatable">Repeat with cooldown</option><option value="once-per-day">Once per game day</option><option value="once-per-chapter" disabled={!p.chapters.length}>Once per chapter</option></select></label>
          {event.repeat.kind === "repeatable" && number(`Event cooldown ${i + 1}`, event.repeat.cooldownMinutes, (cooldownMinutes) => patch({ repeat: { kind: "repeatable", cooldownMinutes } }))}
          {number(`Event minutes ${i + 1}`, event.minutes, (minutes) => patch({ minutes }))}
          {passageSelect(event.passage, (passage) => patch({ passage }), `Event destination ${i + 1}`)}
          <label>Event result {i + 1}<textarea maxLength={1000} value={event.result} onChange={(e) => patch({ result: e.target.value })} /></label>
        </div>
        <fieldset><legend>Milestones granted by event {i + 1}</legend>{p.milestones.map((m) => <label className="world-check" key={m.id}><input type="checkbox" checked={event.milestoneIds.includes(m.id)} onChange={(e) => patch({ milestoneIds: toggle(event.milestoneIds, m.id, e.target.checked) })} />Grant {m.name || "untitled milestone"} for event {i + 1}</label>)}</fieldset>
        <Prerequisites label={`Event ${i + 1}`} conditions={event.prerequisites} onChange={(prerequisites) => patch({ prerequisites })} progression={p} locations={locations} />
        <RemovalButton label={`Remove event ${i + 1}`} dependencies={p.transitions.flatMap((transition, j) => transition.expireEventIds.includes(event.id) ? [`Transition ${j + 1} (${transition.label || "Untitled"}): event expiry`] : [])}
          onRemove={() => onChange({ ...p, events: p.events.filter((_, j) => i !== j) })}>Remove event</RemovalButton>
      </fieldset>; })}
      <button disabled={p.events.length >= 100} onClick={() => onChange({ ...p, events: [...p.events, { id: crypto.randomUUID(), label: "", prerequisites: [], repeat: { kind: "once" }, visibility: "always", passage: null, minutes: 0, milestoneIds: [], result: "" }] })}>Add event</button>
      <h4>Explicit chapter transitions</h4><p>Only selected milestones carry forward; other achieved milestones expire. Selected events expire permanently. Time, location, completed-event history and other existing game state carry forward unless the authored destination or minute cost changes them.</p>
      {p.transitions.map((transition, i) => { const patch = (value: Partial<typeof transition>) => onChange({ ...p, transitions: p.transitions.map((t, j) => i === j ? { ...t, ...value } : t) });
        return <fieldset className="progression-card" key={transition.id}><legend>Chapter transition {i + 1}</legend><div className="world-row">
          <label>Transition label {i + 1}<input maxLength={200} value={transition.label} onChange={(e) => patch({ label: e.target.value })} /></label>
          <label>Transition from {i + 1}<select value={transition.fromChapterId} onChange={(e) => patch({ fromChapterId: e.target.value })}>{options(p.chapters.filter((c) => !c.final))}</select></label>
          <label>Transition to {i + 1}<select value={transition.toChapterId} onChange={(e) => patch({ toChapterId: e.target.value })}>{options(p.chapters)}</select></label>
          {number(`Transition minutes ${i + 1}`, transition.minutes, (minutes) => patch({ minutes }))}
          {passageSelect(transition.passage, (passage) => patch({ passage }), `Transition destination ${i + 1}`)}
          <label>Transition result {i + 1}<textarea maxLength={1000} value={transition.result} onChange={(e) => patch({ result: e.target.value })} /></label>
        </div>
        <fieldset><legend>Carry milestones at transition {i + 1}</legend>{p.milestones.map((m) => <label className="world-check" key={m.id}><input type="checkbox" checked={transition.carryMilestoneIds.includes(m.id)} onChange={(e) => patch({ carryMilestoneIds: toggle(transition.carryMilestoneIds, m.id, e.target.checked) })} />Carry {m.name || "untitled milestone"} at transition {i + 1}</label>)}</fieldset>
        <fieldset><legend>Expire opportunities at transition {i + 1}</legend>{p.events.map((event) => <label className="world-check" key={event.id}><input type="checkbox" checked={transition.expireEventIds.includes(event.id)} onChange={(e) => patch({ expireEventIds: toggle(transition.expireEventIds, event.id, e.target.checked) })} />Expire {event.label || "untitled event"} at transition {i + 1}</label>)}</fieldset>
        <Prerequisites label={`Transition ${i + 1}`} conditions={transition.prerequisites} onChange={(prerequisites) => patch({ prerequisites })} progression={p} locations={locations} />
        <button aria-label={`Remove transition ${i + 1}`} onClick={() => onChange({ ...p, transitions: p.transitions.filter((_, j) => i !== j) })}>Remove transition</button>
      </fieldset>; })}
      <button disabled={p.transitions.length >= 60 || p.chapters.length < 2} onClick={() => onChange({ ...p, transitions: [...p.transitions, { id: crypto.randomUUID(), label: "", fromChapterId: p.initialChapterId ?? "", toChapterId: p.chapters.find((c) => c.id !== p.initialChapterId)?.id ?? "", prerequisites: [], carryMilestoneIds: [], expireEventIds: [], passage: null, minutes: 0, result: "" }] })}>Add chapter transition</button>
    </>}
  </section>;
}
function RemovalButton({ label, dependencies, onRemove, children }: { label: string; dependencies: string[]; onRemove: () => void; children: ReactNode }) {
  const descriptionId = useId();
  return <><button aria-label={label} disabled={dependencies.length > 0} aria-describedby={dependencies.length ? descriptionId : undefined} onClick={onRemove}>{children}</button>
    {dependencies.length > 0 && <p id={descriptionId} className="progression-dependencies">Clear these references before removal: {dependencies.join("; ")}. Uncheck the grant, carry or expiry controls, or remove the listed prerequisites.</p>}</>;
}
function Prerequisites({ label, conditions, onChange, progression, locations }: { label: string; conditions: Conditions; onChange: (value: Conditions) => void; progression: WorldProgression; locations: Props["locations"] }) {
  const defaults = (kind: Conditions[number]["kind"]): Conditions[number] => kind === "chapter" ? { kind, chapterId: progression.initialChapterId ?? "", current: true }
    : kind === "milestone" ? { kind, milestoneId: progression.milestones[0]?.id ?? "", achieved: true }
    : kind === "location" ? { kind, locationId: locations.find((l) => l.passage)?.id ?? "", present: true } : { kind, from: 0, until: null };
  return <fieldset><legend>{label} prerequisites (all must hold)</legend>{conditions.map((condition, i) => {
    const change = (value: Conditions[number]) => onChange(conditions.map((c, j) => i === j ? value : c));
    const prefix = `${label} prerequisite ${i + 1}`;
    return <div className="world-row" key={i}><label>{prefix} type<select value={condition.kind} onChange={(e) => change(defaults(e.target.value as typeof condition.kind))}><option value="chapter">Chapter</option><option value="milestone">Milestone</option><option value="location">Location</option><option value="time">Game minutes</option></select></label>
      {condition.kind === "time" ? <>{(["from", "until"] as const).map((field) => <label key={field}>{prefix} {field === "from" ? "from minute (inclusive)" : "before minute (exclusive)"}<input type="number" min={0} max={52_560_000} step={1} value={condition[field] ?? ""} onChange={(e) => change({ ...condition, [field]: e.target.value === "" ? null : Number(e.target.value) })} /></label>)}</>
      : condition.kind === "chapter" ? <><label>{prefix} chapter<select value={condition.chapterId} onChange={(e) => change({ ...condition, chapterId: e.target.value })}><option value="">Select…</option>{progression.chapters.map((c) => <option key={c.id} value={c.id}>{c.name || "Untitled"}</option>)}</select></label><label>{prefix} rule<select value={String(condition.current)} onChange={(e) => change({ ...condition, current: e.target.value === "true" })}><option value="true">Current chapter</option><option value="false">Not current chapter</option></select></label></>
      : condition.kind === "milestone" ? <><label>{prefix} milestone<select value={condition.milestoneId} onChange={(e) => change({ ...condition, milestoneId: e.target.value })}><option value="">Select…</option>{progression.milestones.map((m) => <option key={m.id} value={m.id}>{m.name || "Untitled"}</option>)}</select></label><label>{prefix} rule<select value={String(condition.achieved)} onChange={(e) => change({ ...condition, achieved: e.target.value === "true" })}><option value="true">Achieved</option><option value="false">Not achieved</option></select></label></>
      : <><label>{prefix} location<select value={condition.locationId} onChange={(e) => change({ ...condition, locationId: e.target.value })}><option value="">Select…</option>{locations.filter((l) => l.passage).map((l) => <option key={l.id} value={l.id}>{l.name || "Untitled"}</option>)}</select></label><label>{prefix} rule<select value={String(condition.present)} onChange={(e) => change({ ...condition, present: e.target.value === "true" })}><option value="true">At location</option><option value="false">Not at location</option></select></label></>}
      <button aria-label={`Remove ${prefix}`} onClick={() => onChange(conditions.filter((_, j) => i !== j))}>×</button>
    </div>;
  })}<button disabled={conditions.length >= 20} onClick={() => onChange([...conditions, defaults("milestone")])}>Add {label.toLowerCase()} prerequisite</button></fieldset>;
}
export function ProgressionSummary({ progression: p, locations = [] }: { progression: WorldProgression; locations?: Props["locations"] }) {
  const chapter = (id: string) => p.chapters.find((c) => c.id === id)?.name ?? id;
  const milestone = (id: string) => p.milestones.find((m) => m.id === id)?.name ?? id;
  const event = (id: string) => p.events.find((e) => e.id === id)?.label ?? id;
  const conditions = (items: Conditions) => items.map((c) => c.kind === "chapter" ? `${c.current ? "Current" : "Not"} chapter: ${chapter(c.chapterId)}`
    : c.kind === "milestone" ? `${milestone(c.milestoneId)}: ${c.achieved ? "achieved" : "not achieved"}` : c.kind === "location" ? `${c.present ? "At" : "Not at"} location: ${locations.find((l) => l.id === c.locationId)?.name ?? c.locationId}` : `Minutes ${c.from ?? "start"}–${c.until ?? "no end"} (end exclusive)`).join("; ") || "None";
  return <section aria-label="Chapters and events summary"><h4>Chapters and events</h4><p>Initial chapter: {p.initialChapterId ? chapter(p.initialChapterId) : "Chapter-free"}</p>
    {p.chapters.map((c) => <p key={c.id}>{c.name}{c.final ? " (final chapter)" : ""}</p>)}<p>Initial milestones: {p.initialMilestoneIds.map(milestone).join(", ") || "None"}</p>
    {p.events.map((event) => <p key={event.id}><strong>{event.label}</strong> · {event.minutes} min · {event.repeat.kind}{event.repeat.kind === "repeatable" ? `, cooldown ${event.repeat.cooldownMinutes} min` : ""} · {event.visibility} · Prerequisites: {conditions(event.prerequisites)} · Grants: {event.milestoneIds.map(milestone).join(", ") || "None"} · {event.result}</p>)}
    {p.transitions.map((t) => <p key={t.id}><strong>{t.label}</strong> · {chapter(t.fromChapterId)} → {chapter(t.toChapterId)} · {t.minutes} min · Prerequisites: {conditions(t.prerequisites)} · Carry: {t.carryMilestoneIds.map(milestone).join(", ") || "None"} · Expire opportunities: {t.expireEventIds.map(event).join(", ") || "None"} · {t.result}</p>)}
  </section>;
}
