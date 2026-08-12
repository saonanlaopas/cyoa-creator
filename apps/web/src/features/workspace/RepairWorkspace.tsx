import { useEffect, useState } from "react";
import {
  authorizeRepairProposalGeneration,
  cancelRepairProposalGeneration,
  createRepairProposalGeneration,
  listEligibleRepairTargets,
  listRepairFindings,
  listRepairPlans,
  listRepairProposalGenerations,
  listRepairProposals,
  loadRepairProposal,
  loadRepairProposalGeneration,
  loadRepairPlan,
  previewRepairPlan,
  previewManualRepairProposal,
  previewRepairProposalGeneration,
  resolveRepairFinding,
  retryRepairProposalUnit,
  saveManualRepairProposal,
  saveRepairPlan,
  startRepairProposalGeneration,
  type RepairFindingSourceKind,
  type RepairFindingSummary,
  type RepairIntent,
  type RepairPlanDefinition,
  type RepairPlanPreview,
  type RepairPlanSummary,
  type RepairPlanView,
  type RepairProposal,
  type RepairProposalGeneration,
  type RepairProposalGenerationPreview,
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
  const [proposalPreview, setProposalPreview] = useState<RepairProposalGenerationPreview | null>(null);
  const [manualProposal, setManualProposal] = useState<RepairProposal | null>(null);
  const [generation, setGeneration] = useState<RepairProposalGeneration | null>(null);
  const [generations, setGenerations] = useState<RepairProposalGeneration[]>([]);
  const [proposals, setProposals] = useState<RepairProposal[]>([]);
  const [openedProposal, setOpenedProposal] = useState<RepairProposal | null>(null);
  const [providerId, setProviderId] = useState("offline-repair-proposal");
  const [modelId, setModelId] = useState("deterministic-repair-v1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refreshPlans = async () => setPlans((await listRepairPlans(projectId)).items);
  const refreshProposalHistory = async () => {
    const [savedGenerations, savedProposals] = await Promise.all([listRepairProposalGenerations(projectId), listRepairProposals(projectId)]);
    setGenerations(savedGenerations.items); setProposals(savedProposals.items);
  };
  useEffect(() => {
    setSelected([]); setTargetOptions([]); setTargetKeys([]); setPreview(null); setOpened(null); setProposalPreview(null); setManualProposal(null); setGeneration(null); setOpenedProposal(null); setMessage(null);
    void Promise.all([listRepairFindings(projectId, sourceKind), listRepairPlans(projectId), listRepairProposalGenerations(projectId), listRepairProposals(projectId)])
      .then(([found, saved, savedGenerations, savedProposals]) => { setFindings(found.items); setPlans(saved.items); setGenerations(savedGenerations.items); setProposals(savedProposals.items); })
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
    {opened && <ProposalWorkspace
      projectId={projectId} plan={opened} providerId={providerId} modelId={modelId}
      setProviderId={setProviderId} setModelId={setModelId} preview={proposalPreview}
      setPreview={setProposalPreview} manualProposal={manualProposal} setManualProposal={setManualProposal}
      generation={generation} setGeneration={setGeneration} setMessage={setMessage}
      busy={busy} setBusy={setBusy} refresh={refreshProposalHistory}
    />}
    <section className="brief-section repair-proposal-history">
      <h2>Proposal generation history</h2>
      {generations.length === 0 ? <p>No provider-assisted generation plans.</p> : generations.map((item) => <button key={item.generation.id} onClick={async () => {
        setBusy(true); try { setGeneration(await loadRepairProposalGeneration(projectId, item.generation.id)); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
      }}><span>{item.job.status} · {item.generation.providerId}</span><small>{item.generation.fingerprint.slice(0, 12)}</small></button>)}
      <h2>Immutable repair proposals</h2>
      {proposals.length === 0 ? <p>No repair proposals yet.</p> : proposals.map((item) => <button key={item.id} onClick={async () => {
        setBusy(true); try { setOpenedProposal(await loadRepairProposal(projectId, item.id)); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
      }}><span>{item.provenance.mode} · {item.groups.length} groups · {item.operations.length} operations</span><small>{item.currentState?.status ?? "current"} · {item.definitionFingerprint.slice(0, 12)}</small></button>)}
    </section>
    {openedProposal && <ProposalDetail proposal={openedProposal} />}
  </section>;
}

function ProposalWorkspace(props: {
  projectId: string; plan: RepairPlanView; providerId: string; modelId: string;
  setProviderId(value: string): void; setModelId(value: string): void;
  preview: RepairProposalGenerationPreview | null; setPreview(value: RepairProposalGenerationPreview | null): void;
  manualProposal: RepairProposal | null; setManualProposal(value: RepairProposal | null): void;
  generation: RepairProposalGeneration | null; setGeneration(value: RepairProposalGeneration | null): void;
  setMessage(value: string | null): void; busy: boolean; setBusy(value: boolean): void; refresh(): Promise<void>;
}) {
  const act = async (action: () => Promise<void>) => {
    props.setBusy(true); props.setMessage(null);
    try { await action(); } catch (error) { props.setMessage((error as Error).message); } finally { props.setBusy(false); }
  };
  const preview = () => act(async () => {
    props.setPreview(await previewRepairProposalGeneration(props.projectId, props.plan.id, props.providerId, props.modelId));
    props.setManualProposal(null);
  });
  const poll = async (generationId: string) => {
    for (let count = 0; count < 120; count += 1) {
      const current = await loadRepairProposalGeneration(props.projectId, generationId); props.setGeneration(current);
      if (current.job.status !== "running") { await props.refresh(); return; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  return <section className="brief-section repair-proposal-workspace" aria-label="Repair proposal generation">
    <header><div><p className="eyebrow">Foundation 6B</p><h2>Repair proposals</h2></div><span className="workflow-status">No canonical mutation</span></header>
    {props.plan.currentState.status === "historical" && <p className="error">This saved repair plan is historical. Proposal generation is blocked.</p>}
    {props.plan.definition.providerNeeded === "ai-assisted" && <div className="repair-provider-fields">
      <label>Provider<select value={props.providerId} onChange={(event) => props.setProviderId(event.target.value)}><option value="offline-repair-proposal">Offline deterministic</option><option value="openrouter-repair-proposal">OpenRouter</option></select></label>
      <label>Model<input value={props.modelId} onChange={(event) => props.setModelId(event.target.value)} /></label>
    </div>}
    <button className="primary" disabled={props.busy || props.plan.currentState.status !== "current"} onClick={() => void preview()}>Preview proposal generation</button>
    {props.preview && <section className="repair-generation-preview">
      <dl className="simulation-metadata">
        <div><dt>Mode</dt><dd>{props.preview.mode}</dd></div><div><dt>Units</dt><dd>{props.preview.units.length}</dd></div>
        <div><dt>Estimated input</dt><dd>{props.preview.estimatedInputTokens} tokens</dd></div><div><dt>Provider calls</dt><dd>{props.preview.providerCalls}</dd></div>
      </dl>
      <strong>{props.preview.generationFingerprint}</strong>
      {props.preview.units.map((unit) => <p key={unit.id}><strong>Unit {unit.position + 1}</strong> {unit.targetKeys.join(", ")}<small>{unit.contextFingerprint} · {unit.serializedContextBytes} bytes</small></p>)}
      {props.preview.mode === "manual-deterministic" ? <div className="repair-proposal-actions">
        <button disabled={props.busy} onClick={() => void act(async () => props.setManualProposal(await previewManualRepairProposal(props.projectId, props.plan.id)))}>Validate manual proposal</button>
        <button className="primary" disabled={props.busy} onClick={() => void act(async () => { props.setManualProposal(await saveManualRepairProposal(props.projectId, props.plan.id)); props.setMessage("Immutable repair proposal saved."); await props.refresh(); })}>Save validated proposal</button>
      </div> : <button className="primary" disabled={props.busy} onClick={() => void act(async () => props.setGeneration(await createRepairProposalGeneration(props.projectId, props.plan.id, props.providerId, props.modelId)))}>Save exact generation plan</button>}
    </section>}
    {props.manualProposal && <ProposalDetail proposal={props.manualProposal} preview />}
    {props.generation && <section className="repair-generation-job">
      <header><div><p className="eyebrow">{props.generation.job.status}</p><h3>Generation job</h3></div><strong>{props.generation.generation.fingerprint}</strong></header>
      <div className="repair-proposal-actions">
        {props.generation.job.status === "planned" && <button className="primary" disabled={props.busy} onClick={() => void act(async () => props.setGeneration(await authorizeRepairProposalGeneration(props.projectId, props.generation!.generation.id, props.generation!.generation.fingerprint)))}>Authorize exact fingerprint</button>}
        {["authorized", "partially-failed", "failed"].includes(props.generation.job.status) && props.generation.job.units.some((unit) => unit.status === "pending") && <button className="primary" disabled={props.busy} onClick={() => void act(async () => { const started = await startRepairProposalGeneration(props.projectId, props.generation!.generation.id); props.setGeneration(started); await poll(started.generation.id); })}>Start generation</button>}
        {props.generation.job.status === "running" && <button disabled={props.busy} onClick={() => void act(async () => props.setGeneration(await cancelRepairProposalGeneration(props.projectId, props.generation!.generation.id)))}>Cancel generation</button>}
      </div>
      {props.generation.job.units.map((unit) => <details key={unit.id} open={unit.status === "failed"}><summary>Unit {unit.position + 1} · {unit.status ?? "pending"} · {unit.targetKeys.join(", ")}</summary>
        {(unit.attempts ?? []).map((attempt) => <p key={attempt.id}>Attempt {attempt.number} · {attempt.status} · repairs {attempt.repair.performed}{attempt.error ? ` · ${attempt.error.message}` : ""}</p>)}
        {unit.status === "failed" && <button disabled={props.busy} onClick={() => void act(async () => props.setGeneration(await retryRepairProposalUnit(props.projectId, props.generation!.generation.id, unit.id)))}>Prepare retry</button>}
      </details>)}
    </section>}
  </section>;
}

function ProposalDetail({ proposal, preview = false }: { proposal: RepairProposal; preview?: boolean }) {
  return <section className="brief-section repair-proposal-detail" aria-label={preview ? "Repair proposal preview" : "Opened repair proposal"}>
    <header><div><p className="eyebrow">{preview ? "Provider-free preview" : proposal.currentState?.status ?? "current"}</p><h2>{preview ? "Validated proposal" : "Immutable proposal"}</h2></div><strong>{proposal.definitionFingerprint}</strong></header>
    <dl className="simulation-metadata"><div><dt>Mode</dt><dd>{proposal.provenance.mode}</dd></div><div><dt>Validation</dt><dd>{proposal.validation.status}</dd></div><div><dt>Groups</dt><dd>{proposal.groups.length}</dd></div><div><dt>Operations</dt><dd>{proposal.operations.length}</dd></div></dl>
    {proposal.currentState?.reasons.map((reason) => <p className="error" key={reason}>{reason}</p>)}
    {proposal.validation.warnings.map((warning) => <p className="status" key={warning}>{warning}</p>)}
    {proposal.groups.map((group) => <details key={group.id} open><summary>{group.label} · {group.validation.status}</summary><p>{group.summary}</p><small>Dependencies: {group.dependsOnGroupIds.join(", ") || "None"}</small>
      {proposal.operations.filter((operation) => group.operationIds.includes(operation.id)).map((operation) => <article key={operation.id} className="repair-operation"><strong>{operation.kind} · {operation.entityKind}:{operation.entityId}</strong>{operation.requiresUnlock && <em>Candidate requires a later explicit prose unlock</em>}{operation.fieldDiffs.map((diff) => <pre key={diff.field}>{JSON.stringify(diff, null, 2)}</pre>)}</article>)}
    </details>)}
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
