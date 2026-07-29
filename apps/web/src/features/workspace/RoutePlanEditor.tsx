import { useEffect, useState } from "react";
import type { LongFormRoutePlan, MajorRoute, RouteAct } from "../../api/long-form.js";

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export function RoutePlanEditor(props: {
  routes: LongFormRoutePlan;
  busy: boolean;
  onSave(routes: LongFormRoutePlan): Promise<void>;
}) {
  const [draft, setDraft] = useState(props.routes);
  useEffect(() => setDraft(props.routes), [props.routes]);
  const allocated = draft.acts.reduce((total, act) => total + act.wordTarget, 0);
  const remaining = draft.totalWordTarget - allocated;
  const shared = draft.acts.filter((act) => act.routeId === null).reduce((total, act) => total + act.wordTarget, 0);

  return <form className="brief-editor route-plan-editor" onSubmit={(event) => {
    event.preventDefault();
    void props.onSave(draft);
  }}>
    <section className="brief-section">
      <h3>Architecture overview</h3>
      <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Structural overview<textarea value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /></label>
      <label>Total word target<input type="number" min={50000} max={2000000} value={draft.totalWordTarget} onChange={(event) => setDraft({
        ...draft, totalWordTarget: Number(event.target.value),
      })} /></label>
      <div className="route-budget" aria-label="Route word budget">
        <Budget label="Project target" value={draft.totalWordTarget} />
        <Budget label="Shared acts" value={shared} />
        <Budget label="Route-exclusive" value={allocated - shared} />
        <Budget label={remaining < 0 ? "Over budget" : "Unallocated"} value={Math.abs(remaining)} warning={remaining !== 0} />
      </div>
      {remaining !== 0 && <p className="warning">Act targets currently {remaining < 0 ? "exceed" : "leave"} the project target by {Math.abs(remaining).toLocaleString()} words. You may save this as an intentional planning draft.</p>}
    </section>

    <section className="brief-section">
      <SectionHeading title="Major routes" onAdd={() => setDraft({
        ...draft,
        routes: [...draft.routes, {
          id: id("route"), name: "New route", promise: "", summary: "", entryConditions: [],
          relationshipArcs: [], endingHookIds: [],
        }],
      })} />
      <p className="field-note">Each route should offer a distinct dramatic promise and substantial exclusive material, not merely a different ending.</p>
      {draft.routes.map((route, index) => <RouteCard
        key={route.id}
        route={route}
        onChange={(next) => setDraft({ ...draft, routes: replace(draft.routes, index, next) })}
        onRemove={() => setDraft({ ...draft, routes: draft.routes.filter((_, itemIndex) => itemIndex !== index) })}
      />)}
    </section>

    <section className="brief-section">
      <SectionHeading title="Acts and word budgets" onAdd={() => setDraft({
        ...draft,
        acts: [...draft.acts, {
          id: id("act"), routeId: null, label: "New act", purpose: "", summary: "", wordTarget: 0,
        }],
      })} />
      {draft.acts.map((act, index) => <ActCard
        key={act.id}
        act={act}
        routes={draft.routes}
        onChange={(next) => setDraft({ ...draft, acts: replace(draft.acts, index, next) })}
        onRemove={() => setDraft({ ...draft, acts: draft.acts.filter((_, itemIndex) => itemIndex !== index) })}
      />)}
    </section>

    <section className="brief-section">
      <SectionHeading title="Decision points" onAdd={() => {
        const source = draft.acts[0];
        const destination = draft.acts[1] ?? source;
        if (!source || !destination) return;
        setDraft({
          ...draft,
          decisionPoints: [...draft.decisionPoints, {
            id: id("decision"), label: "New decision", actId: source.id, question: "",
            choices: [
              { id: id("choice"), label: "First choice", destinationActId: destination.id, routeId: destination.routeId, conditions: [], consequences: [] },
              { id: id("choice"), label: "Second choice", destinationActId: destination.id, routeId: destination.routeId, conditions: [], consequences: [] },
            ],
          }],
        });
      }} />
      {draft.decisionPoints.map((decision, index) => <details className="bible-card route-detail-card" key={decision.id}>
        <summary>{decision.label} · {decision.choices.length} choices</summary>
        <label>Label<input required value={decision.label} onChange={(event) => setDraft({
          ...draft, decisionPoints: replace(draft.decisionPoints, index, { ...decision, label: event.target.value }),
        })} /></label>
        <label>Source act<select value={decision.actId} onChange={(event) => setDraft({
          ...draft, decisionPoints: replace(draft.decisionPoints, index, { ...decision, actId: event.target.value }),
        })}>{draft.acts.map((act) => <option key={act.id} value={act.id}>{act.label}</option>)}</select></label>
        <label>Decision question<textarea value={decision.question} onChange={(event) => setDraft({
          ...draft, decisionPoints: replace(draft.decisionPoints, index, { ...decision, question: event.target.value }),
        })} /></label>
        {decision.choices.map((choice, choiceIndex) => <article className="route-subcard" key={choice.id}>
          <label>Choice label<input required value={choice.label} onChange={(event) => setDraft({
            ...draft,
            decisionPoints: replace(draft.decisionPoints, index, {
              ...decision, choices: replace(decision.choices, choiceIndex, { ...choice, label: event.target.value }),
            }),
          })} /></label>
          <div className="brief-grid">
            <label>Destination act<select value={choice.destinationActId} onChange={(event) => {
              const act = draft.acts.find((item) => item.id === event.target.value);
              setDraft({
                ...draft,
                decisionPoints: replace(draft.decisionPoints, index, {
                  ...decision,
                  choices: replace(decision.choices, choiceIndex, {
                    ...choice, destinationActId: event.target.value, routeId: act?.routeId ?? null,
                  }),
                }),
              });
            }}>{draft.acts.map((act) => <option key={act.id} value={act.id}>{act.label}</option>)}</select></label>
            <LinesField label="Conditions" value={choice.conditions} onChange={(conditions) => setDraft({
              ...draft,
              decisionPoints: replace(draft.decisionPoints, index, {
                ...decision, choices: replace(decision.choices, choiceIndex, { ...choice, conditions }),
              }),
            })} />
          </div>
          <LinesField label="Consequences" value={choice.consequences} onChange={(consequences) => setDraft({
            ...draft,
            decisionPoints: replace(draft.decisionPoints, index, {
              ...decision, choices: replace(decision.choices, choiceIndex, { ...choice, consequences }),
            }),
          })} />
          <RemoveButton disabled={decision.choices.length <= 2} onClick={() => setDraft({
            ...draft,
            decisionPoints: replace(draft.decisionPoints, index, {
              ...decision, choices: decision.choices.filter((_, itemIndex) => itemIndex !== choiceIndex),
            }),
          })} />
        </article>)}
        <button type="button" onClick={() => setDraft({
          ...draft,
          decisionPoints: replace(draft.decisionPoints, index, {
            ...decision,
            choices: [...decision.choices, {
              id: id("choice"), label: "New choice", destinationActId: draft.acts[0]!.id,
              routeId: draft.acts[0]!.routeId, conditions: [], consequences: [],
            }],
          }),
        })}>Add choice</button>
        <RemoveButton onClick={() => setDraft({ ...draft, decisionPoints: draft.decisionPoints.filter((_, itemIndex) => itemIndex !== index) })} />
      </details>)}
    </section>

    <section className="brief-section">
      <SectionHeading title="Reconvergences" onAdd={() => {
        if (draft.acts.length < 2) return;
        setDraft({
          ...draft,
          reconvergences: [...draft.reconvergences, {
            id: id("reconvergence"), label: "New reconvergence",
            fromActIds: draft.acts.slice(0, 2).map((act) => act.id), toActId: draft.acts[0]!.id,
            requirements: [], preservedDifferences: [],
          }],
        });
      }} />
      <p className="field-note">Reconvergence can share production cost while preserving route-specific flags, relationships, knowledge, and tone.</p>
      {draft.reconvergences.map((item, index) => <details className="bible-card route-detail-card" key={item.id}>
        <summary>{item.label}</summary>
        <label>Label<input required value={item.label} onChange={(event) => setDraft({
          ...draft, reconvergences: replace(draft.reconvergences, index, { ...item, label: event.target.value }),
        })} /></label>
        <div className="brief-grid">
          <LinesField label="From act IDs" value={item.fromActIds} onChange={(fromActIds) => setDraft({
            ...draft, reconvergences: replace(draft.reconvergences, index, { ...item, fromActIds }),
          })} />
          <label>To act<select value={item.toActId} onChange={(event) => setDraft({
            ...draft, reconvergences: replace(draft.reconvergences, index, { ...item, toActId: event.target.value }),
          })}>{draft.acts.map((act) => <option key={act.id} value={act.id}>{act.label}</option>)}</select></label>
        </div>
        <LinesField label="Requirements" value={item.requirements} onChange={(requirements) => setDraft({
          ...draft, reconvergences: replace(draft.reconvergences, index, { ...item, requirements }),
        })} />
        <LinesField label="Differences that must remain visible" value={item.preservedDifferences} onChange={(preservedDifferences) => setDraft({
          ...draft, reconvergences: replace(draft.reconvergences, index, { ...item, preservedDifferences }),
        })} />
        <RemoveButton onClick={() => setDraft({ ...draft, reconvergences: draft.reconvergences.filter((_, itemIndex) => itemIndex !== index) })} />
      </details>)}
    </section>

    <section className="brief-section">
      <SectionHeading title="Ending hooks" onAdd={() => {
        const route = draft.routes[0];
        if (!route) return;
        const hookId = id("ending-hook");
        setDraft({
          ...draft,
          routes: replace(draft.routes, 0, { ...route, endingHookIds: [...route.endingHookIds, hookId] }),
          endingHooks: [...draft.endingHooks, { id: hookId, label: "New ending hook", routeId: route.id, type: "partial", summary: "" }],
        });
      }} />
      <p className="field-note">These are promises and route links only. The next stage develops ending logic, variants, requirements, and payoff.</p>
      {draft.endingHooks.map((ending, index) => <details className="bible-card route-detail-card" key={ending.id}>
        <summary>{ending.label} · {draft.routes.find((route) => route.id === ending.routeId)?.name ?? ending.routeId} · {ending.type}</summary>
        <div className="brief-grid">
          <label>Label<input required value={ending.label} onChange={(event) => setDraft({
            ...draft, endingHooks: replace(draft.endingHooks, index, { ...ending, label: event.target.value }),
          })} /></label>
          <label>Route<select value={ending.routeId} onChange={(event) => setDraft({
            ...draft, endingHooks: replace(draft.endingHooks, index, { ...ending, routeId: event.target.value }),
          })}>{draft.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
        </div>
        <label>Outcome type<select value={ending.type} onChange={(event) => setDraft({
          ...draft,
          endingHooks: replace(draft.endingHooks, index, { ...ending, type: event.target.value as typeof ending.type }),
        })}>
          <option value="success">Success</option><option value="partial">Partial</option>
          <option value="failure">Failure</option><option value="special">Special</option>
        </select></label>
        <label>Payoff promise<textarea value={ending.summary} onChange={(event) => setDraft({
          ...draft, endingHooks: replace(draft.endingHooks, index, { ...ending, summary: event.target.value }),
        })} /></label>
      </details>)}
    </section>

    <section className="brief-section">
      <SectionHeading title="Unresolved route questions" onAdd={() => setDraft({
        ...draft, unresolvedQuestions: [...draft.unresolvedQuestions, { id: id("route-question"), question: "New question", answer: "" }],
      })} />
      {draft.unresolvedQuestions.map((item, index) => <article className="bible-card" key={item.id}>
        <label>Question<textarea required value={item.question} onChange={(event) => setDraft({
          ...draft, unresolvedQuestions: replace(draft.unresolvedQuestions, index, { ...item, question: event.target.value }),
        })} /></label>
        <label>Decision or answer<textarea value={item.answer} onChange={(event) => setDraft({
          ...draft, unresolvedQuestions: replace(draft.unresolvedQuestions, index, { ...item, answer: event.target.value }),
        })} /></label>
        <RemoveButton onClick={() => setDraft({ ...draft, unresolvedQuestions: draft.unresolvedQuestions.filter((_, itemIndex) => itemIndex !== index) })} />
      </article>)}
    </section>

    <div className="brief-actions">
      <button className="primary" disabled={props.busy}>{props.busy ? "Saving…" : "Save route draft"}</button>
    </div>
  </form>;
}

function Budget(props: { label: string; value: number; warning?: boolean }) {
  return <div className={props.warning ? "warning" : ""}><strong>{props.value.toLocaleString()}</strong><span>{props.label}</span></div>;
}

function SectionHeading(props: { title: string; onAdd(): void }) {
  return <header className="bible-section-heading"><h3>{props.title}</h3><button type="button" onClick={props.onAdd}>Add</button></header>;
}

function LinesField(props: { label: string; value: string[]; onChange(value: string[]): void }) {
  return <label>{props.label} <span>One per line</span><textarea value={props.value.join("\n")} onChange={(event) => props.onChange(lines(event.target.value))} /></label>;
}

function RemoveButton(props: { onClick(): void; disabled?: boolean }) {
  return <button type="button" className="danger-text" disabled={props.disabled} onClick={props.onClick}>Remove</button>;
}

function replace<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function RouteCard(props: { route: MajorRoute; onChange(route: MajorRoute): void; onRemove(): void }) {
  const route = props.route;
  return <details className="bible-card route-detail-card">
    <summary>{route.name}</summary>
    <div className="brief-grid">
      <label>Name<input required value={route.name} onChange={(event) => props.onChange({ ...route, name: event.target.value })} /></label>
      <label>Route promise<input value={route.promise} onChange={(event) => props.onChange({ ...route, promise: event.target.value })} /></label>
    </div>
    <label>Route summary<textarea value={route.summary} onChange={(event) => props.onChange({ ...route, summary: event.target.value })} /></label>
    <LinesField label="Entry conditions" value={route.entryConditions} onChange={(entryConditions) => props.onChange({ ...route, entryConditions })} />
    <header className="bible-section-heading">
      <h4>Relationship trajectories</h4>
      <button type="button" onClick={() => props.onChange({
        ...route,
        relationshipArcs: [...route.relationshipArcs, { relationshipId: "relationship-id", trajectory: "", keyMoments: [] }],
      })}>Add</button>
    </header>
    {route.relationshipArcs.map((arc, index) => <article className="route-subcard" key={`${arc.relationshipId}-${index}`}>
      <label>Story-bible relationship ID<input required value={arc.relationshipId} onChange={(event) => props.onChange({
        ...route,
        relationshipArcs: replace(route.relationshipArcs, index, { ...arc, relationshipId: event.target.value }),
      })} /></label>
      <label>Route trajectory<textarea value={arc.trajectory} onChange={(event) => props.onChange({
        ...route,
        relationshipArcs: replace(route.relationshipArcs, index, { ...arc, trajectory: event.target.value }),
      })} /></label>
      <LinesField label="Key relationship moments" value={arc.keyMoments} onChange={(keyMoments) => props.onChange({
        ...route,
        relationshipArcs: replace(route.relationshipArcs, index, { ...arc, keyMoments }),
      })} />
      <RemoveButton onClick={() => props.onChange({
        ...route, relationshipArcs: route.relationshipArcs.filter((_, itemIndex) => itemIndex !== index),
      })} />
    </article>)}
    <p className="field-note">Ending links: {route.endingHookIds.length}. Detailed relationship thresholds belong to the later mechanics stage.</p>
    <RemoveButton onClick={props.onRemove} />
  </details>;
}

function ActCard(props: { act: RouteAct; routes: MajorRoute[]; onChange(act: RouteAct): void; onRemove(): void }) {
  const act = props.act;
  return <details className="bible-card route-detail-card">
    <summary>{act.label} · {act.wordTarget.toLocaleString()} words</summary>
    <div className="brief-grid">
      <label>Label<input required value={act.label} onChange={(event) => props.onChange({ ...act, label: event.target.value })} /></label>
      <label>Scope<select value={act.routeId ?? ""} onChange={(event) => props.onChange({ ...act, routeId: event.target.value || null })}>
        <option value="">Shared across routes</option>
        {props.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
      </select></label>
    </div>
    <label>Word target<input type="number" min={0} value={act.wordTarget} onChange={(event) => props.onChange({ ...act, wordTarget: Number(event.target.value) })} /></label>
    <label>Purpose<input value={act.purpose} onChange={(event) => props.onChange({ ...act, purpose: event.target.value })} /></label>
    <label>Summary<textarea value={act.summary} onChange={(event) => props.onChange({ ...act, summary: event.target.value })} /></label>
    <RemoveButton onClick={props.onRemove} />
  </details>;
}
