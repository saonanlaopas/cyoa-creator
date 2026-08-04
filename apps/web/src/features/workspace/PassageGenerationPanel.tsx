import { useEffect, useMemo, useState } from "react";
import {
  authorizeGenerationPlan,
  cancelGenerationJob,
  createGenerationPlan,
  listGenerationPlans,
  loadGenerationJob,
  previewGenerationPlan,
  retryGenerationUnit,
  startGenerationJob,
  type GenerationJob,
  type GenerationPlan,
  type GenerationPlanPreview,
  type GenerationScope,
} from "../../api/passage-generation.js";
import type { PassagePlan, PassageStructure } from "../../api/passage-plan.js";

export function PassageGenerationPanel(props: {
  projectId: string;
  approved: boolean;
  structure: PassageStructure;
  passages: PassagePlan[];
  setMessage(value: string | null): void;
}) {
  const [scopeKind, setScopeKind] = useState<GenerationScope["kind"]>("sequence");
  const [actId, setActId] = useState(props.structure.acts[0]?.id ?? "");
  const [sequenceId, setSequenceId] = useState(props.structure.sequences[0]?.id ?? "");
  const routeIds = useMemo(() => [...new Set(props.passages.flatMap((item) => item.routeIds))].sort(), [props.passages]);
  const [routeId, setRouteId] = useState(routeIds[0] ?? "");
  const [segmentIds, setSegmentIds] = useState(() => props.passages
    .filter((item) => item.routeIds.includes(routeIds[0] ?? ""))
    .map((item) => item.id).join(", "));
  const [preview, setPreview] = useState<GenerationPlanPreview | null>(null);
  const [plan, setPlan] = useState<GenerationPlan | null>(null);
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const plans = await listGenerationPlans(props.projectId);
    const latest = plans[0] ?? null;
    setPlan(latest);
    setPreview(null);
    setJob(latest ? await loadGenerationJob(props.projectId, latest.jobId) : null);
  };
  useEffect(() => { void refresh().catch((error: Error) => props.setMessage(error.message)); }, [props.projectId]);
  useEffect(() => {
    if (job?.status !== "running") return;
    const timer = setInterval(() => {
      void loadGenerationJob(props.projectId, job.id).then(setJob).catch((error: Error) => props.setMessage(error.message));
    }, 150);
    return () => clearInterval(timer);
  }, [props.projectId, job?.id, job?.status]);

  const scope = (): GenerationScope => {
    if (scopeKind === "act") return { kind: "act", actId };
    if (scopeKind === "sequence") return { kind: "sequence", sequenceId };
    return {
      kind: "route-segment",
      routeId,
      passageIds: segmentIds.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean),
    };
  };
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    try { await operation(); }
    catch (error) { props.setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  return <details className="generation-kernel" open>
    <summary><strong>Bounded AI passage planning</strong> <span>Checkpoint 4A-1 · lifecycle only</span></summary>
    <p className="field-note">Preview is local and free. This checkpoint runs only the deterministic offline lifecycle kernel; it does not generate or apply passage proposals.</p>
    {!props.approved && <p className="warning">Approve a passage-plan snapshot before planning generation.</p>}
    <div className="generation-scope-grid">
      <label>Scope<select aria-label="Generation scope" value={scopeKind} onChange={(event) => setScopeKind(event.target.value as GenerationScope["kind"])}>
        <option value="act">Act</option><option value="sequence">Sequence</option><option value="route-segment">Route segment</option>
      </select></label>
      {scopeKind === "act" && <label>Act<select value={actId} onChange={(event) => setActId(event.target.value)}>
        {props.structure.acts.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>}
      {scopeKind === "sequence" && <label>Sequence<select value={sequenceId} onChange={(event) => setSequenceId(event.target.value)}>
        {props.structure.sequences.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
      </select></label>}
      {scopeKind === "route-segment" && <>
        <label>Route<select value={routeId} onChange={(event) => {
          const next = event.target.value; setRouteId(next);
          setSegmentIds(props.passages.filter((item) => item.routeIds.includes(next)).map((item) => item.id).join(", "));
        }}>{routeIds.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <label>Ordered passage IDs<input aria-label="Route segment passage IDs" value={segmentIds} onChange={(event) => setSegmentIds(event.target.value)} placeholder="passage-001, passage-002" /></label>
      </>}
      <label>Provider<input value="offline-kernel" readOnly /></label>
      <label>Model<input value="deterministic-fixture-v1" readOnly /></label>
    </div>
    <div className="artifact-actions">
      <button disabled={!props.approved || busy} onClick={() => void perform(async () => {
        setPreview(await previewGenerationPlan(props.projectId, scope())); setPlan(null); setJob(null);
      })}>Preview plan</button>
      <button disabled={!preview || busy} onClick={() => void perform(async () => {
        const created = await createGenerationPlan(props.projectId, preview!.scope);
        setPlan(created); setPreview(null); setJob(await loadGenerationJob(props.projectId, created.jobId));
        props.setMessage("Generation plan saved without calling a provider.");
      })}>Save exact plan</button>
      <button disabled={!plan || plan.authorizationState === "authorized" || busy} onClick={() => void perform(async () => {
        const authorized = await authorizeGenerationPlan(props.projectId, plan!.id, plan!.fingerprint);
        setPlan(authorized); setJob(await loadGenerationJob(props.projectId, authorized.jobId));
        props.setMessage("Exact generation plan authorized.");
      })}>Authorize exact plan</button>
      <button disabled={!job || job.status !== "authorized" || busy} onClick={() => void perform(async () => {
        setJob(await startGenerationJob(props.projectId, job!.id));
      })}>{job?.units.some((item) => item.attemptNumber) ? "Resume offline kernel" : "Start offline kernel"}</button>
      <button disabled={!job || !["planned", "authorized", "running", "partially_failed", "failed"].includes(job.status) || busy} onClick={() => void perform(async () => {
        setJob(await cancelGenerationJob(props.projectId, job!.id));
      })}>Cancel</button>
    </div>
    {(preview || plan) && <PlanInspection plan={preview ?? plan!} />}
    {job && <section aria-label="Generation job status" className="generation-job-status">
      <strong>Job: {job.status}</strong>
      <span>{job.units.filter((item) => item.status === "completed").length}/{job.units.length} units complete</span>
      {job.units.map((unit) => <div className="generation-unit" key={unit.id}>
        <span>Unit {unit.position + 1} · {unit.sequenceId} · {unit.passageIds.length} passages</span>
        <span>{unit.status} · attempt {unit.attemptNumber ?? 0}</span>
        {unit.normalizedError?.message && <span className="error">{unit.normalizedError.message}</span>}
        {unit.status === "failed" && <button disabled={busy} onClick={() => void perform(async () => {
          setJob(await retryGenerationUnit(props.projectId, job.id, unit.id));
        })}>Retry unit</button>}
      </div>)}
    </section>}
  </details>;
}

function PlanInspection({ plan }: { plan: GenerationPlanPreview | GenerationPlan }) {
  return <section aria-label="Generation plan inspection" className="generation-plan-inspection">
    <strong>{plan.units.length} bounded unit{plan.units.length === 1 ? "" : "s"}</strong>
    <span>{plan.estimatedInputTokens.toLocaleString()} estimated input tokens</span>
    <span>{plan.estimatedOutputTokens.toLocaleString()} maximum estimated output tokens</span>
    <span>Cost: unavailable offline</span>
    <span>Fingerprint: <code>{plan.fingerprint.slice(0, 16)}</code></span>
    <span>Snapshot: <code>{plan.snapshotId}</code></span>
    {plan.units.map((unit) => <small key={unit.id}>{unit.id} · {unit.sequenceId} · {unit.passageIds.length} passages</small>)}
  </section>;
}
