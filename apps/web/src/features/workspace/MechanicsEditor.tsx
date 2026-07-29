import { useEffect, useState } from "react";
import type { LongFormEndingPlan, LongFormMechanicsPlan, LongFormRoutePlan } from "../../api/long-form.js";

const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const replace = <T,>(items: T[], index: number, value: T) => items.map((item, itemIndex) => itemIndex === index ? value : item);
const without = <T,>(items: T[], index: number) => items.filter((_, itemIndex) => itemIndex !== index);

export function MechanicsEditor(props: {
  plan: LongFormMechanicsPlan;
  routes: LongFormRoutePlan | null;
  endings: LongFormEndingPlan | null;
  busy: boolean;
  onSave(plan: LongFormMechanicsPlan): Promise<void>;
}) {
  const [draft, setDraft] = useState(props.plan);
  useEffect(() => setDraft(props.plan), [props.plan]);
  const mechanics = [...draft.visibleStats, ...draft.relationships, ...draft.flags, ...draft.resources];
  const used = new Set([
    ...draft.gates.flatMap((gate) => gate.conditions.map((condition) => condition.mechanicKey)),
    ...draft.choiceEffectPlans.flatMap((effect) => effect.mechanicKeys),
  ]);
  const unused = mechanics.filter((item) => !used.has(item.key));

  return <form className="brief-editor mechanics-editor" onSubmit={(event) => {
    event.preventDefault();
    void props.onSave(draft);
  }}>
    <section className="brief-section">
      <h3>Consequence model</h3>
      <label>Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
      <label>Overview<textarea value={draft.overview} onChange={(event) => setDraft({ ...draft, overview: event.target.value })} /></label>
      <div className="route-budget">
        <Metric label="Declared" value={mechanics.length} />
        <Metric label="Influential" value={mechanics.length - unused.length} />
        <Metric label="Gates" value={draft.gates.length} />
        <Metric label="Effect plans" value={draft.choiceEffectPlans.length} />
      </div>
      {unused.length > 0 && <p className="warning">Not yet influential: {unused.map((item) => item.label).join(", ")}.</p>}
    </section>

    <ScaleSection title="Visible stats" values={draft.visibleStats} onChange={(visibleStats) => setDraft({ ...draft, visibleStats })} />
    <ScaleSection title="Relationship scales" relationship values={draft.relationships} onChange={(relationships) => setDraft({ ...draft, relationships })} />

    <section className="brief-section">
      <Section title="Flags" onAdd={() => setDraft({ ...draft, flags: [...draft.flags, { id: id("flag"), key: `flag_${draft.flags.length + 1}`, label: "New flag", meaning: "" }] })} />
      {draft.flags.map((flag, index) => <KeyCard key={flag.id} label={flag.label} keyValue={flag.key} meaning={flag.meaning}
        onChange={(key, label, meaning) => setDraft({ ...draft, flags: replace(draft.flags, index, { ...flag, key, label, meaning }) })}
        onRemove={() => setDraft({ ...draft, flags: without(draft.flags, index) })} />)}
      <Section title="Resources" onAdd={() => setDraft({ ...draft, resources: [...draft.resources, { id: id("resource"), key: `resource_${draft.resources.length + 1}`, label: "New resource", kind: "counter", initial: 0, meaning: "" }] })} />
      {draft.resources.map((resource, index) => <details className="bible-card route-detail-card" key={resource.id}>
        <summary>{resource.label} · {resource.kind}</summary>
        <KeyCard label={resource.label} keyValue={resource.key} meaning={resource.meaning}
          onChange={(key, label, meaning) => setDraft({ ...draft, resources: replace(draft.resources, index, { ...resource, key, label, meaning }) })}
          onRemove={() => setDraft({ ...draft, resources: without(draft.resources, index) })} />
        <div className="brief-grid">
          <label>Kind<select value={resource.kind} onChange={(event) => setDraft({ ...draft, resources: replace(draft.resources, index, { ...resource, kind: event.target.value as typeof resource.kind }) })}><option value="inventory">Inventory</option><option value="currency">Currency</option><option value="counter">Counter</option></select></label>
          <label>Initial<input type="number" value={resource.initial} onChange={(event) => setDraft({ ...draft, resources: replace(draft.resources, index, { ...resource, initial: Number(event.target.value) }) })} /></label>
        </div>
      </details>)}
    </section>

    <section className="brief-section">
      <Section title="Route and ending gates" onAdd={() => {
        const mechanic = mechanics[0];
        const target = props.endings?.endings[0] ?? props.routes?.routes[0];
        if (!mechanic || !target) return;
        setDraft({ ...draft, gates: [...draft.gates, {
          id: id("gate"), targetType: "title" in target ? "ending" : "route", targetId: target.id, logic: "all",
          conditions: [{ id: id("condition"), mechanicKey: mechanic.key, operator: "at-least", value: 1 }],
          rationale: "", fallback: "",
        }] });
      }} />
      {draft.gates.map((gate, index) => <details className="bible-card route-detail-card" key={gate.id}>
        <summary>{gate.targetType} · {gate.targetId} · {gate.conditions.length} condition(s)</summary>
        <div className="brief-grid">
          <label>Target type<select value={gate.targetType} onChange={(event) => {
            const targetType = event.target.value as typeof gate.targetType;
            const targetId = targetType === "route" ? props.routes?.routes[0]?.id : props.endings?.endings[0]?.id;
            setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, targetType, targetId: targetId ?? gate.targetId }) });
          }}><option value="route">Route</option><option value="ending">Ending</option></select></label>
          <label>Target<select value={gate.targetId} onChange={(event) => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, targetId: event.target.value }) })}>
            {(gate.targetType === "route" ? props.routes?.routes : props.endings?.endings)?.map((item) => <option key={item.id} value={item.id}>{"name" in item ? item.name : item.title}</option>)}
          </select></label>
          <label>Logic<select value={gate.logic} onChange={(event) => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, logic: event.target.value as typeof gate.logic }) })}><option value="all">All conditions</option><option value="any">Any condition</option></select></label>
        </div>
        {gate.conditions.map((condition, conditionIndex) => <div className="mechanic-condition" key={condition.id}>
          <select value={condition.mechanicKey} onChange={(event) => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, conditions: replace(gate.conditions, conditionIndex, { ...condition, mechanicKey: event.target.value }) }) })}>{mechanics.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
          <select value={condition.operator} onChange={(event) => {
            const operator = event.target.value as typeof condition.operator;
            setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, conditions: replace(gate.conditions, conditionIndex, { ...condition, operator, value: operator === "present" || operator === "absent" ? null : condition.value ?? 0 }) }) });
          }}>{["at-least", "at-most", "equals", "present", "absent"].map((value) => <option key={value}>{value}</option>)}</select>
          <input type="number" disabled={condition.value === null} value={condition.value ?? ""} onChange={(event) => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, conditions: replace(gate.conditions, conditionIndex, { ...condition, value: Number(event.target.value) }) }) })} />
          <button type="button" disabled={gate.conditions.length === 1} onClick={() => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, conditions: without(gate.conditions, conditionIndex) }) })}>Remove</button>
        </div>)}
        <button type="button" disabled={!mechanics[0]} onClick={() => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, conditions: [...gate.conditions, { id: id("condition"), mechanicKey: mechanics[0]?.key ?? "missing", operator: "at-least", value: 1 }] }) })}>Add condition</button>
        <label>Rationale<textarea value={gate.rationale} onChange={(event) => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, rationale: event.target.value }) })} /></label>
        <label>Fallback content<textarea value={gate.fallback} onChange={(event) => setDraft({ ...draft, gates: replace(draft.gates, index, { ...gate, fallback: event.target.value }) })} /></label>
        <button type="button" className="danger" onClick={() => setDraft({ ...draft, gates: without(draft.gates, index) })}>Remove gate</button>
      </details>)}
    </section>

    <section className="brief-section">
      <Section title="Choice-effect plans" onAdd={() => {
        if (mechanics[0]) setDraft({ ...draft, choiceEffectPlans: [...draft.choiceEffectPlans, { id: id("effect"), label: "New effect plan", sourceDecisionIds: [], mechanicKeys: [mechanics[0].key], effectGuidance: ["Describe when and why this value changes."] }] });
      }} />
      {draft.choiceEffectPlans.map((effect, index) => <details className="bible-card route-detail-card" key={effect.id}>
        <summary>{effect.label} · {effect.mechanicKeys.join(", ")}</summary>
        <label>Label<input value={effect.label} onChange={(event) => setDraft({ ...draft, choiceEffectPlans: replace(draft.choiceEffectPlans, index, { ...effect, label: event.target.value }) })} /></label>
        <Lines label="Decision IDs" values={effect.sourceDecisionIds} onChange={(sourceDecisionIds) => setDraft({ ...draft, choiceEffectPlans: replace(draft.choiceEffectPlans, index, { ...effect, sourceDecisionIds }) })} />
        <Lines label="Mechanic keys" values={effect.mechanicKeys} onChange={(mechanicKeys) => setDraft({ ...draft, choiceEffectPlans: replace(draft.choiceEffectPlans, index, { ...effect, mechanicKeys }) })} />
        <Lines label="Effect guidance" values={effect.effectGuidance} onChange={(effectGuidance) => setDraft({ ...draft, choiceEffectPlans: replace(draft.choiceEffectPlans, index, { ...effect, effectGuidance }) })} />
        <button type="button" className="danger" onClick={() => setDraft({ ...draft, choiceEffectPlans: without(draft.choiceEffectPlans, index) })}>Remove effect plan</button>
      </details>)}
    </section>

    <section className="brief-section">
      <Section title="Balancing rules" onAdd={() => setDraft({ ...draft, balancingRules: [...draft.balancingRules, { id: id("rule"), label: "New rule", description: "" }] })} />
      {draft.balancingRules.map((rule, index) => <KeyCard key={rule.id} hideKey label={rule.label} keyValue={rule.id} meaning={rule.description}
        onChange={(_, label, description) => setDraft({ ...draft, balancingRules: replace(draft.balancingRules, index, { ...rule, label, description }) })}
        onRemove={() => setDraft({ ...draft, balancingRules: without(draft.balancingRules, index) })} />)}
    </section>

    <section className="brief-section">
      <Section title="Unresolved questions" onAdd={() => setDraft({ ...draft, unresolvedQuestions: [...draft.unresolvedQuestions, { id: id("question"), question: "New question", answer: "" }] })} />
      {draft.unresolvedQuestions.map((question, index) => <article className="bible-card" key={question.id}>
        <label>Question<input value={question.question} onChange={(event) => setDraft({ ...draft, unresolvedQuestions: replace(draft.unresolvedQuestions, index, { ...question, question: event.target.value }) })} /></label>
        <label>Answer<textarea value={question.answer} onChange={(event) => setDraft({ ...draft, unresolvedQuestions: replace(draft.unresolvedQuestions, index, { ...question, answer: event.target.value }) })} /></label>
        <button type="button" className="danger" onClick={() => setDraft({ ...draft, unresolvedQuestions: without(draft.unresolvedQuestions, index) })}>Remove question</button>
      </article>)}
    </section>
    <div className="brief-actions"><button className="primary" disabled={props.busy}>{props.busy ? "Saving…" : "Save mechanics draft"}</button></div>
  </form>;
}

function ScaleSection(props: {
  title: string;
  values: LongFormMechanicsPlan["visibleStats"] | LongFormMechanicsPlan["relationships"];
  onChange(values: any): void;
  relationship?: boolean;
}) {
  return <section className="brief-section">
    <Section title={props.title} onAdd={() => props.onChange([...props.values, {
      id: id("scale"), ...(props.relationship ? { relationshipId: "relationship-id", bands: [] } : {}),
      key: `scale_${props.values.length + 1}`, label: "New scale", description: "",
      minimum: -5, maximum: 10, initial: 0, increaseSignals: [], decreaseSignals: [],
    }])} />
    {props.values.map((value, index) => {
      const relationship = "relationshipId" in value ? value : null;
      const update = (changes: Record<string, unknown>) => props.onChange(replace(props.values as any[], index, { ...value, ...changes }));
      return <details className="bible-card route-detail-card" key={value.id}>
        <summary>{value.label} · {value.key} · {value.minimum}–{value.maximum}</summary>
        <div className="brief-grid">
          <label>Label<input value={value.label} onChange={(event) => update({ label: event.target.value })} /></label>
          <label>Key<input value={value.key} onChange={(event) => update({ key: event.target.value })} /></label>
          {relationship && <label>Story-bible relationship ID<input value={relationship.relationshipId} onChange={(event) => update({ relationshipId: event.target.value })} /></label>}
          <label>Minimum<input type="number" value={value.minimum} onChange={(event) => update({ minimum: Number(event.target.value) })} /></label>
          <label>Maximum<input type="number" value={value.maximum} onChange={(event) => update({ maximum: Number(event.target.value) })} /></label>
          <label>Initial<input type="number" value={value.initial} onChange={(event) => update({ initial: Number(event.target.value) })} /></label>
        </div>
        <label>Description<textarea value={value.description} onChange={(event) => update({ description: event.target.value })} /></label>
        <Lines label="Increase signals" values={value.increaseSignals} onChange={(increaseSignals) => update({ increaseSignals })} />
        <Lines label="Decrease signals" values={value.decreaseSignals} onChange={(decreaseSignals) => update({ decreaseSignals })} />
        {relationship && <section>
          <Section title="Relationship bands" onAdd={() => update({ bands: [...relationship.bands, { id: id("band"), minimum: 0, label: "New band", meaning: "" }] })} />
          {relationship.bands.map((band, bandIndex) => <div className="mechanic-condition" key={band.id}>
            <input type="number" aria-label="Band minimum" value={band.minimum} onChange={(event) => update({ bands: replace(relationship.bands, bandIndex, { ...band, minimum: Number(event.target.value) }) })} />
            <input aria-label="Band label" value={band.label} onChange={(event) => update({ bands: replace(relationship.bands, bandIndex, { ...band, label: event.target.value }) })} />
            <input aria-label="Band meaning" value={band.meaning} onChange={(event) => update({ bands: replace(relationship.bands, bandIndex, { ...band, meaning: event.target.value }) })} />
            <button type="button" onClick={() => update({ bands: without(relationship.bands, bandIndex) })}>Remove</button>
          </div>)}
        </section>}
        <button type="button" className="danger" onClick={() => props.onChange(without(props.values as any[], index))}>Remove scale</button>
      </details>;
    })}
  </section>;
}

function KeyCard(props: { label: string; keyValue: string; meaning: string; hideKey?: boolean; onChange(key: string, label: string, meaning: string): void; onRemove(): void }) {
  return <article className="bible-card">
    <div className="brief-grid">
      <label>Label<input value={props.label} onChange={(event) => props.onChange(props.keyValue, event.target.value, props.meaning)} /></label>
      {!props.hideKey && <label>Key<input value={props.keyValue} onChange={(event) => props.onChange(event.target.value, props.label, props.meaning)} /></label>}
    </div>
    <label>Description<textarea value={props.meaning} onChange={(event) => props.onChange(props.keyValue, props.label, event.target.value)} /></label>
    <button type="button" className="danger" onClick={props.onRemove}>Remove</button>
  </article>;
}
function Lines(props: { label: string; values: string[]; onChange(values: string[]): void }) {
  return <label>{props.label}<textarea value={props.values.join("\n")} onChange={(event) => props.onChange(lines(event.target.value))} /></label>;
}
function Section(props: { title: string; onAdd(): void }) {
  return <header className="bible-section-heading"><h3>{props.title}</h3><button type="button" onClick={props.onAdd}>Add</button></header>;
}
function Metric(props: { label: string; value: number }) {
  return <div><strong>{props.value}</strong><span>{props.label}</span></div>;
}
