import { useEffect, useState } from "react";
import {
  createSimulationInput,
  listSimulationInputs,
  listSimulationRuns,
  loadSimulationRun,
  runSimulationPath,
  type SimulationInputSummary,
  type SimulationRunSummary,
  type SimulationRunVersion,
} from "../../api/simulation.js";
import { PlaytestWorkspace } from "./PlaytestWorkspace.js";

interface Props { projectId: string; onNavigateStableId?(stableId: string): void }

export function SimulationWorkspace({ projectId, onNavigateStableId }: Props) {
  const [inputs, setInputs] = useState<SimulationInputSummary[]>([]);
  const [runs, setRuns] = useState<SimulationRunSummary[]>([]);
  const [selectedInputId, setSelectedInputId] = useState("");
  const [choiceText, setChoiceText] = useState("");
  const [expectedEndingId, setExpectedEndingId] = useState("");
  const [run, setRun] = useState<SimulationRunVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const [inputResponse, runResponse] = await Promise.all([
      listSimulationInputs(projectId), listSimulationRuns(projectId),
    ]);
    setInputs(inputResponse.items);
    setRuns(runResponse.items);
    setSelectedInputId((current) => current || inputResponse.items[0]?.versionId || "");
  };

  useEffect(() => {
    setRun(null);
    setMessage(null);
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [projectId]);

  const capture = async () => {
    setBusy(true); setMessage(null);
    try {
      const created = await createSimulationInput(projectId);
      await refresh();
      setSelectedInputId(created.id);
      setMessage("Captured an exact approved simulation input.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    if (!selectedInputId) return;
    setBusy(true); setMessage(null);
    try {
      const choiceIds = choiceText.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
      const completed = await runSimulationPath(projectId, selectedInputId, choiceIds, expectedEndingId.trim() || undefined);
      setRun(completed);
      await refresh();
      setMessage("Deterministic path completed and its evidence was saved.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const reopen = async (versionId: string) => {
    setBusy(true); setMessage(null);
    try { setRun(await loadSimulationRun(projectId, versionId)); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const selectedInput = inputs.find((input) => input.versionId === selectedInputId);
  return <section className="artifact-pane simulation-workspace">
    <header className="artifact-header">
      <div>
        <p className="eyebrow">Foundation 5A</p>
        <h1>Deterministic simulation</h1>
        <p>Exercise exact stable-ID paths without loading prose or calling a provider.</p>
      </div>
      <button className="primary" disabled={busy} onClick={() => void capture()}>Capture approved input</button>
    </header>

    {message && <p className={message.includes("saved") || message.includes("Captured") ? "status good" : "error"} role="status">{message}</p>}

    <section className="brief-section simulation-controls">
      <h2>Run an exact path</h2>
      <label>Immutable input
        <select aria-label="Immutable input" value={selectedInputId} onChange={(event) => setSelectedInputId(event.target.value)}>
          <option value="">Capture an approved input first</option>
          {inputs.map((input) => <option key={input.versionId} value={input.versionId}>v{input.version} · {input.passageCount} passages · {input.fingerprint.slice(0, 12)}</option>)}
        </select>
      </label>
      {selectedInput && <dl className="simulation-metadata">
        <div><dt>Input fingerprint</dt><dd>{selectedInput.fingerprint}</dd></div>
        <div><dt>Runtime fingerprint</dt><dd>{selectedInput.runtimeFingerprint}</dd></div>
        <div><dt>Snapshot</dt><dd>{selectedInput.snapshotId}</dd></div>
        <div><dt>Scope</dt><dd>{selectedInput.passageCount} passages · {selectedInput.choiceCount} choices · {selectedInput.acceptedDraftCount} accepted draft refs</dd></div>
        <div><dt>Bounds</dt><dd>{selectedInput.policy.maxSteps} steps · {selectedInput.policy.maxVisitsPerPassage} visits/passage · {selectedInput.policy.maxTraceBytes.toLocaleString()} bytes</dd></div>
      </dl>}
      <label>Stable choice IDs, separated by whitespace or commas
        <textarea aria-label="Stable choice IDs" value={choiceText} onChange={(event) => setChoiceText(event.target.value)} placeholder="choice-opening choice-route-a choice-ending-a" />
      </label>
      <label>Expected ending stable ID (optional)
        <input value={expectedEndingId} onChange={(event) => setExpectedEndingId(event.target.value)} />
      </label>
      <button className="primary" disabled={busy || !selectedInputId} onClick={() => void execute()}>Run deterministic path</button>
    </section>

    <section className="brief-section simulation-history">
      <h2>Saved run evidence</h2>
      {runs.length === 0 ? <p>No simulation runs yet.</p> : runs.map((item) => <button key={item.versionId} onClick={() => void reopen(item.versionId)}>
        <span>v{item.version} · {item.result.kind}{item.result.endingId ? ` · ${item.result.endingId}` : ""}</span>
        <small>{item.stepCount} steps · {item.findingCount} findings · {item.traceFingerprint.slice(0, 12)}</small>
      </button>)}
    </section>

    {run && <SimulationEvidence run={run} />}
    <PlaytestWorkspace
      projectId={projectId}
      inputs={inputs}
      defaultInputId={selectedInputId}
      onNavigateStableId={onNavigateStableId}
    />
  </section>;
}

function SimulationEvidence({ run }: { run: SimulationRunVersion }) {
  const trace = run.content.trace;
  return <section className="brief-section simulation-evidence">
    <header>
      <div><p className="eyebrow">Immutable run v{run.version}</p><h2>Trace evidence</h2></div>
      <strong>{trace.result.kind}{trace.result.endingId ? ` · ${trace.result.endingId}` : ""}</strong>
    </header>
    <dl className="simulation-metadata">
      <div><dt>Trace fingerprint</dt><dd>{trace.fingerprint}</dd></div>
      <div><dt>Input fingerprint</dt><dd>{run.content.inputFingerprint}</dd></div>
      <div><dt>Runtime fingerprint</dt><dd>{run.content.runtimeFingerprint}</dd></div>
      <div><dt>Visited passages</dt><dd>{trace.visitedPassageIds.join(" → ")}</dd></div>
      <div><dt>Selected choices</dt><dd>{trace.selectedChoiceIds.join(" → ") || "None"}</dd></div>
    </dl>
    {trace.findings.length > 0 && <section className="simulation-findings"><h3>Findings</h3>{trace.findings.map((finding) =>
      <p key={finding.id}><strong>{finding.code}</strong> at step {finding.stepIndex}: {finding.message}</p>)}</section>}
    <details><summary>Final state</summary><pre>{JSON.stringify(trace.finalState, null, 2)}</pre></details>
    <div className="simulation-steps">
      {trace.steps.map((step) => <details key={`${step.stepIndex}-${step.selectedChoiceId}`}>
        <summary>Step {step.stepIndex + 1}: {step.passageId} → {step.selectedChoiceId} → {step.nextPassageId}</summary>
        <p>Choice was {step.availability.visible ? "visible" : "hidden"} and {step.availability.enabled ? "enabled" : "disabled"}.</p>
        {step.availability.reason && <p>{step.availability.reason}</p>}
        <h4>Exact state delta</h4>
        {step.stateDelta.length === 0 ? <p>No state changes.</p> : <ul>{step.stateDelta.map((delta) =>
          <li key={delta.path}><code>{delta.path}</code>: {JSON.stringify(delta.before)} → {JSON.stringify(delta.after)}</li>)}</ul>}
        <details><summary>State before and after</summary><pre>{JSON.stringify({ before: step.stateBefore, after: step.stateAfter }, null, 2)}</pre></details>
      </details>)}
    </div>
  </section>;
}
