import { useEffect, useState } from "react";
import type {
  EndingOutcome,
  LongFormEndingPlan,
  LongFormRoutePlan,
} from "../../api/long-form.js";

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const replace = <T,>(items: T[], index: number, value: T) =>
  items.map((item, itemIndex) => itemIndex === index ? value : item);

export function EndingPlanEditor(props: {
  plan: LongFormEndingPlan;
  routes: LongFormRoutePlan | null;
  busy: boolean;
  onSave(plan: LongFormEndingPlan): Promise<void>;
}) {
  const [draft, setDraft] = useState(props.plan);
  useEffect(() => setDraft(props.plan), [props.plan]);
  const allocated = draft.endings.reduce((total, ending) => total + ending.wordTarget, 0);
  const difference = draft.endingWordTarget - allocated;
  const routeCoverage = (props.routes?.routes ?? []).map((route) => ({
    id: route.id,
    name: route.name,
    endings: draft.endings.filter((ending) => ending.routeId === route.id),
  }));
  const developed = draft.endings.filter((ending) =>
    ending.summary && ending.thematicPayoff && ending.requirements.length > 0).length;

  return <form className="brief-editor ending-plan-editor" onSubmit={(event) => {
    event.preventDefault();
    void props.onSave(draft);
  }}>
    <section className="brief-section">
      <h3>Ending overview</h3>
      <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Outcome strategy<textarea value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /></label>
      <div className="brief-grid">
        <label>Project word target<input type="number" min={50000} value={draft.projectWordTarget} onChange={(event) => setDraft({
          ...draft, projectWordTarget: Number(event.target.value),
        })} /></label>
        <label>Ending prose subset<input type="number" min={1000} value={draft.endingWordTarget} onChange={(event) => setDraft({
          ...draft, endingWordTarget: Number(event.target.value),
        })} /></label>
      </div>
      <div className="route-budget ending-budget" aria-label="Ending coverage summary">
        <Budget label="Endings" value={draft.endings.length} />
        <Budget label="Developed" value={developed} warning={developed < draft.endings.length} />
        <Budget label="Allocated words" value={allocated} />
        <Budget label={difference < 0 ? "Over budget" : "Unallocated"} value={Math.abs(difference)} warning={difference !== 0} />
      </div>
      {difference !== 0 && <p className="warning">Ending targets currently {difference < 0 ? "exceed" : "leave"} the ending subset by {Math.abs(difference).toLocaleString()} words.</p>}
    </section>

    <section className="brief-section">
      <h3>Route coverage</h3>
      <div className="ending-coverage">
        {routeCoverage.map((route) => <article className={route.endings.length ? "" : "warning"} key={route.id}>
          <strong>{route.name}</strong>
          <span>{route.endings.length} ending{route.endings.length === 1 ? "" : "s"}</span>
          <small>{[...new Set(route.endings.map((ending) => ending.type))].join(", ") || "No outcome coverage"}</small>
        </article>)}
      </div>
      {routeCoverage.some((route) => route.endings.length === 0) && <p className="warning">At least one major route has no ending. Resolve coverage before approval.</p>}
    </section>

    <section className="brief-section">
      <header className="bible-section-heading"><h3>Detailed endings</h3><button type="button" onClick={() => {
        const route = props.routes?.routes[0];
        const hook = props.routes?.endingHooks.find((item) =>
          !draft.endings.some((ending) => ending.hookId === item.id));
        if (!route) return;
        setDraft({
          ...draft,
          endings: [...draft.endings, blankEnding(hook?.routeId ?? route.id, hook?.id ?? id("ending-hook"))],
        });
      }}>Add</button></header>
      <p className="field-note">Requirements describe earned access. Variants preserve smaller accumulated differences without multiplying whole endings.</p>
      {draft.endings.map((ending, index) => <EndingCard
        key={ending.id}
        ending={ending}
        routePlan={props.routes}
        onChange={(next) => setDraft({ ...draft, endings: replace(draft.endings, index, next) })}
        onRemove={() => setDraft({ ...draft, endings: draft.endings.filter((_, itemIndex) => itemIndex !== index) })}
      />)}
    </section>

    <section className="brief-section">
      <header className="bible-section-heading"><h3>Unresolved ending questions</h3><button type="button" onClick={() => setDraft({
        ...draft,
        unresolvedQuestions: [...draft.unresolvedQuestions, { id: id("ending-question"), question: "New question", answer: "" }],
      })}>Add</button></header>
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
      <button className="primary" disabled={props.busy}>{props.busy ? "Saving…" : "Save ending draft"}</button>
    </div>
  </form>;
}

function EndingCard(props: {
  ending: EndingOutcome;
  routePlan: LongFormRoutePlan | null;
  onChange(ending: EndingOutcome): void;
  onRemove(): void;
}) {
  const ending = props.ending;
  const update = <K extends keyof EndingOutcome>(key: K, value: EndingOutcome[K]) =>
    props.onChange({ ...ending, [key]: value });
  const routeName = props.routePlan?.routes.find((route) => route.id === ending.routeId)?.name ?? ending.routeId;
  return <details className="bible-card route-detail-card">
    <summary>{ending.title} · {routeName} · {ending.type} · {ending.wordTarget.toLocaleString()} words</summary>
    <div className="brief-grid">
      <label>Title<input required value={ending.title} onChange={(event) => update("title", event.target.value)} /></label>
      <label>Route<select value={ending.routeId} onChange={(event) => update("routeId", event.target.value)}>
        {props.routePlan?.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
      </select></label>
      <label>Outcome type<select value={ending.type} onChange={(event) => update("type", event.target.value as EndingOutcome["type"])}>
        <option value="success">Success</option><option value="partial">Partial</option>
        <option value="failure">Failure</option><option value="special">Special</option>
      </select></label>
      <label>Word target<input type="number" min={100} value={ending.wordTarget} onChange={(event) => update("wordTarget", Number(event.target.value))} /></label>
    </div>
    <label>Outcome summary<textarea value={ending.summary} onChange={(event) => update("summary", event.target.value)} /></label>
    <label>Thematic payoff<textarea value={ending.thematicPayoff} onChange={(event) => update("thematicPayoff", event.target.value)} /></label>
    <div className="brief-grid">
      <LinesField label="Requirements" value={ending.requirements} onChange={(value) => update("requirements", value)} />
      <LinesField label="Exclusions" value={ending.exclusions} onChange={(value) => update("exclusions", value)} />
      <LinesField label="Contributing decision IDs" value={ending.contributingDecisionIds} onChange={(value) => update("contributingDecisionIds", value)} />
      <LinesField label="Required foreshadowing" value={ending.foreshadowing} onChange={(value) => update("foreshadowing", value)} />
      <LinesField label="Persistent state consequences" value={ending.stateConsequences} onChange={(value) => update("stateConsequences", value)} />
    </div>
    <OutcomeList
      title="Character outcomes"
      idLabel="Story-bible character ID"
      values={ending.characterOutcomes}
      onChange={(characterOutcomes) => update("characterOutcomes", characterOutcomes)}
      idKey="characterId"
    />
    <OutcomeList
      title="Relationship outcomes"
      idLabel="Story-bible relationship ID"
      values={ending.relationshipOutcomes}
      onChange={(relationshipOutcomes) => update("relationshipOutcomes", relationshipOutcomes)}
      idKey="relationshipId"
    />
    <header className="bible-section-heading"><h4>Ending variants</h4><button type="button" onClick={() => update("variants", [
      ...ending.variants, { id: id("ending-variant"), label: "New variant", requirements: [], differences: [] },
    ])}>Add</button></header>
    {ending.variants.map((variant, index) => <article className="route-subcard" key={variant.id}>
      <label>Variant label<input required value={variant.label} onChange={(event) => update("variants", replace(
        ending.variants, index, { ...variant, label: event.target.value },
      ))} /></label>
      <LinesField label="Variant requirements" value={variant.requirements} onChange={(requirements) => update(
        "variants", replace(ending.variants, index, { ...variant, requirements }),
      )} />
      <LinesField label="Visible differences" value={variant.differences} onChange={(differences) => update(
        "variants", replace(ending.variants, index, { ...variant, differences }),
      )} />
      <RemoveButton onClick={() => update("variants", ending.variants.filter((_, itemIndex) => itemIndex !== index))} />
    </article>)}
    <p className="field-note">Route hook: {ending.hookId}</p>
    <RemoveButton onClick={props.onRemove} />
  </details>;
}

function OutcomeList<K extends "characterId" | "relationshipId">(props: {
  title: string;
  idLabel: string;
  values: Array<Record<K, string> & { outcome: string }>;
  onChange(values: Array<Record<K, string> & { outcome: string }>): void;
  idKey: K;
}) {
  return <section className="ending-subsection">
    <header className="bible-section-heading"><h4>{props.title}</h4><button type="button" onClick={() => props.onChange([
      ...props.values, { [props.idKey]: `${props.idKey}-id`, outcome: "" } as Record<K, string> & { outcome: string },
    ])}>Add</button></header>
    {props.values.map((value, index) => <article className="route-subcard" key={`${value[props.idKey]}-${index}`}>
      <label>{props.idLabel}<input required value={value[props.idKey]} onChange={(event) => props.onChange(replace(
        props.values, index, { ...value, [props.idKey]: event.target.value },
      ))} /></label>
      <label>Outcome<textarea value={value.outcome} onChange={(event) => props.onChange(replace(
        props.values, index, { ...value, outcome: event.target.value },
      ))} /></label>
      <RemoveButton onClick={() => props.onChange(props.values.filter((_, itemIndex) => itemIndex !== index))} />
    </article>)}
  </section>;
}

function blankEnding(routeId: string, hookId: string): EndingOutcome {
  return {
    id: id("ending"), hookId, routeId, title: "New ending", type: "partial", summary: "",
    thematicPayoff: "", wordTarget: 750, requirements: [], exclusions: [],
    contributingDecisionIds: [], foreshadowing: [], characterOutcomes: [],
    relationshipOutcomes: [], stateConsequences: [], variants: [],
  };
}

function LinesField(props: { label: string; value: string[]; onChange(value: string[]): void }) {
  return <label>{props.label} <span>One per line</span><textarea value={props.value.join("\n")} onChange={(event) => props.onChange(lines(event.target.value))} /></label>;
}
function RemoveButton(props: { onClick(): void }) {
  return <button type="button" className="danger-text" onClick={props.onClick}>Remove</button>;
}
function Budget(props: { label: string; value: number; warning?: boolean }) {
  return <div className={props.warning ? "warning" : ""}><strong>{props.value.toLocaleString()}</strong><span>{props.label}</span></div>;
}
