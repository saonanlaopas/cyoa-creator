import { useEffect, useState } from "react";
import {
  listEligibleRepairTargets,
  listRepairFindings,
  listRepairPlans,
  loadRepairPlan,
  previewRepairPlan,
  resolveRepairFinding,
  saveRepairPlan,
  type RepairFindingSourceKind,
  type RepairFindingSummary,
  type RepairIntent,
  type RepairPlanDefinition,
  type RepairPlanPreview,
  type RepairPlanSummary,
  type RepairPlanView,
  type RepairTargetOption,
  type ResolvedRepairFinding,
} from "../../api/repair.js";

interface Props { projectId: string }

const sourceLabels: Record<RepairFindingSourceKind, string> = {
  "foundation-3-static-validation": "Static validation",
  "foundation-5a-runtime": "Simulation runtime",
  "foundation-5b-playtest": "Playtest campaign",
  "foundation-5c-narrative-review": "Narrative review",
};
const intentCategories = [
  "structural", "passage-plan", "choice", "continuity", "narrative-thread", "prose",
  "mechanic", "relationship", "fact-reference", "route", "ending", "runtime-state-consequence",
];

export function RepairWorkspace({ projectId }: Props) {
  const [sourceKind, setSourceKind] = useState<RepairFindingSourceKind>("foundation-3-static-validation");
  const [findings, setFindings] = useState<RepairFindingSummary[]>([]);
  const [selected, setSelected] = useState<ResolvedRepairFinding[]>([]);
  const [intent, setIntent] = useState<RepairIntent>({ schemaVersion: 1, category: "structural", note: "" });
  const [targetOptions, setTargetOptions] = useState<RepairTargetOption[]>([]);
  const [targetKeys, setTargetKeys] = useState<string[]>([]);
  const [preview, setPreview] = useState<RepairPlanPreview | null>(null);
  const [plans, setPlans] = useState<RepairPlanSummary[]>([]);
  const [opened, setOpened] = useState<RepairPlanView | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshPlans = async () => setPlans((await listRepairPlans(projectId)).items);
  useEffect(() => {
    setSelected([]); setTargetOptions([]); setTargetKeys([]); setPreview(null); setOpened(null); setMessage(null);
    void Promise.all([listRepairFindings(projectId, sourceKind), listRepairPlans(projectId)])
      .then(([found, saved]) => { setFindings(found.items); setPlans(saved.items); })
      .catch((error: Error) => setMessage(error.message));
  }, [projectId, sourceKind]);

  useEffect(() => {
    setTargetKeys([]); setPreview(null);
    if (!selected.length) { setTargetOptions([]); return; }
    void listEligibleRepairTargets(projectId, selected, intent)
      .then((result) => setTargetOptions(result.targets))
      .catch((error: Error) => { setTargetOptions([]); setMessage(error.message); });
  }, [projectId, selected, intent.category]);

  const selectedTargets = targetOptions.filter((item) => targetKeys.includes(item.targetKey)).map((item) => item.target);

  const toggleFinding = async (finding: RepairFindingSummary) => {
    const existing = selected.find((item) => item.sourceFingerprint === finding.sourceFingerprint);
    if (existing) { setSelected((items) => items.filter((item) => item !== existing)); return; }
    if (selected.length >= 8) { setMessage("A repair plan can contain at most 8 findings."); return; }
    setBusy(true); setMessage(null);
    try {
      const resolved = await resolveRepairFinding(projectId, finding.locator);
      setSelected((items) => [...items, resolved]);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const buildPreview = async () => {
    setBusy(true); setMessage(null);
    try { setPreview(await previewRepairPlan(projectId, selected, intent, selectedTargets)); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const saved = await saveRepairPlan(projectId, selected, intent, selectedTargets);
      setOpened(saved); setMessage("Repair plan saved."); await refreshPlans();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  return <section className="artifact-pane repair-workspace">
    <header className="artifact-header">
      <div><p className="eyebrow">Foundation 6A</p><h1>Repair planning</h1></div>
      <span className="workflow-status approved">Provider-free</span>
    </header>
    {message && <p className={message.includes("saved") ? "status good" : "error"} role="status">{message}</p>}

    <section className="brief-section repair-intake">
      <h2>Finding intake</h2>
      <label>Evidence source
        <select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as RepairFindingSourceKind)}>
          {Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="repair-finding-list" aria-label="Available findings">
        {findings.length === 0 ? <p>No findings in this source.</p> : findings.map((finding) => {
          const checked = selected.some((item) => item.sourceFingerprint === finding.sourceFingerprint);
          return <label key={`${finding.locator.sourceVersionId}:${finding.locator.findingId}`} className="repair-finding-row">
            <input type="checkbox" checked={checked} disabled={busy || (!checked && selected.length >= 8)} onChange={() => void toggleFinding(finding)} />
            <span><strong>{finding.code}</strong><small>{finding.severity} · {finding.sourceState} · {finding.entityIds.join(", ") || "project"}</small><span>{finding.message}</span></span>
          </label>;
        })}
      </div>
      {selected.map((finding) => <details key={finding.sourceFingerprint} className="repair-evidence-detail">
        <summary>{finding.categoryCode} · {finding.sourceFingerprint.slice(0, 12)}</summary>
        <dl className="simulation-metadata">
          <div><dt>Evidence state</dt><dd>{finding.sourceState}</dd></div>
          <div><dt>Stable references</dt><dd>{finding.entityKeys.join(", ") || "Project-level"}</dd></div>
          <div><dt>Source fingerprint</dt><dd>{finding.sourceFingerprint}</dd></div>
        </dl>
        <pre>{JSON.stringify(finding.reference, null, 2)}</pre>
      </details>)}
    </section>

    <section className="brief-section repair-scope">
      <h2>Intent and mutation scope</h2>
      <label>Repair intent
        <select value={intent.category} onChange={(event) => setIntent((current) => ({ ...current, category: event.target.value }))}>
          {intentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
      </label>
      <label>Rationale (optional)<textarea value={intent.note} maxLength={2_000} onChange={(event) => setIntent((current) => ({ ...current, note: event.target.value }))} /></label>
      <div className="repair-target-list" aria-label="Authorized mutation targets">
        {selected.length > 0 && targetOptions.length === 0 ? <p>No eligible targets for this intent.</p> : targetOptions.map((option) => <label key={option.targetKey} className="repair-target-row">
          <input type="checkbox" checked={targetKeys.includes(option.targetKey)} disabled={busy} onChange={(event) => setTargetKeys((items) => event.target.checked ? [...items, option.targetKey] : items.filter((item) => item !== option.targetKey))} />
          <span><strong>{option.targetKey}</strong>{option.protected && <em>Locked</em>}<small>{option.reason}</small></span>
        </label>)}
      </div>
      <button className="primary" disabled={busy || !selected.length || !selectedTargets.length} onClick={() => void buildPreview()}>Preview repair plan</button>
    </section>

    {preview && <RepairPreview preview={preview} onSave={save} busy={busy} />}

    <section className="brief-section repair-history">
      <h2>Saved repair plans</h2>
      {plans.length === 0 ? <p>No saved repair plans.</p> : plans.map((plan) => <button key={plan.id} onClick={async () => {
        setBusy(true); setMessage(null);
        try { setOpened(await loadRepairPlan(projectId, plan.id)); }
        catch (error) { setMessage((error as Error).message); }
        finally { setBusy(false); }
      }}><span>{plan.intent.category} · {plan.findingCount} findings · {plan.targetCount} targets</span><small>{plan.currentState.status} · {plan.definitionFingerprint.slice(0, 12)}</small></button>)}
    </section>
    {opened && <section className="brief-section repair-opened" aria-label="Opened repair plan">
      <header><div><p className="eyebrow">{opened.currentState.status}</p><h2>Saved plan</h2></div><strong>{opened.definitionFingerprint}</strong></header>
      {opened.currentState.reasons.map((reason) => <p className="error" key={reason}>{reason}</p>)}
      <RepairDefinition definition={opened.definition} />
    </section>}
  </section>;
}

function RepairPreview({ preview, onSave, busy }: { preview: RepairPlanPreview; onSave(): Promise<void>; busy: boolean }) {
  return <section className="brief-section repair-preview" aria-label="Repair plan preview">
    <header><div><p className="eyebrow">{preview.currentState.status}</p><h2>Exact plan preview</h2></div><strong>{preview.fingerprint}</strong></header>
    <RepairDefinition definition={preview.definition} />
    <button className="primary" disabled={busy || preview.currentState.status !== "current"} onClick={() => void onSave()}>Save exact plan</button>
  </section>;
}

function RepairDefinition({ definition }: { definition: RepairPlanDefinition }) {
  const classifications = ["direct", "dependent", "historical-evidence"] as const;
  return <>
    <dl className="simulation-metadata">
      <div><dt>Intent</dt><dd>{definition.intent.category}</dd></div>
      <div><dt>Later repair mode</dt><dd>{definition.providerNeeded}</dd></div>
      <div><dt>Impact fingerprint</dt><dd>{definition.impactGraph.fingerprint}</dd></div>
      <div><dt>Scope</dt><dd>{definition.authorizedTargets.length} targets</dd></div>
    </dl>
    <details open><summary>Exact target bases</summary>{definition.expectedBases.map((base) => <pre key={base.targetKey}>{JSON.stringify(base, null, 2)}</pre>)}</details>
    <div className="repair-impact-columns">{classifications.map((classification) => <section key={classification}><h3>{classification}</h3>{definition.impactGraph.nodes.filter((node) => node.classification === classification).map((node) => <p key={node.id}><strong>{node.entityKind}</strong> {node.entityId}<small>{node.reason}</small></p>)}</section>)}</div>
  </>;
}
