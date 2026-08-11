import { useEffect, useMemo, useState } from "react";
import {
  listPlaytestCampaigns,
  loadPlaytestCampaign,
  previewPlaytestPolicy,
  replayPlaytestSample,
  runPlaytestCampaign,
  type PlaytestCampaignSummary,
  type PlaytestCampaignVersion,
  type PlaytestFinding,
  type PlaytestReplay,
} from "../../api/playtesting.js";
import type { SimulationInputSummary } from "../../api/simulation.js";

interface Props {
  projectId: string;
  inputs: SimulationInputSummary[];
  defaultInputId: string;
  onNavigateStableId?(stableId: string): void;
}

export function PlaytestWorkspace({ projectId, inputs, defaultInputId, onNavigateStableId }: Props) {
  const [campaigns, setCampaigns] = useState<PlaytestCampaignSummary[]>([]);
  const [campaign, setCampaign] = useState<PlaytestCampaignVersion | null>(null);
  const [inputVersionId, setInputVersionId] = useState(defaultInputId);
  const [seed, setSeed] = useState("author-review-v1");
  const [sampleCount, setSampleCount] = useState(50);
  const [maxSteps, setMaxSteps] = useState(300);
  const [policyPreview, setPolicyPreview] = useState<Awaited<ReturnType<typeof previewPlaytestPolicy>> | null>(null);
  const [selectedSampleId, setSelectedSampleId] = useState("");
  const [replay, setReplay] = useState<PlaytestReplay | null>(null);
  const [findingFilter, setFindingFilter] = useState("all");
  const [sampleFilter, setSampleFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => setCampaigns((await listPlaytestCampaigns(projectId)).items);
  useEffect(() => {
    setCampaign(null); setReplay(null); setMessage(null);
    void refresh().catch((error: Error) => setMessage(error.message));
  }, [projectId]);
  useEffect(() => { if (!inputVersionId && defaultInputId) setInputVersionId(defaultInputId); }, [defaultInputId]);

  const overrides = () => ({ sampleCount, maxStepsPerSample: maxSteps });
  const preview = async () => {
    if (!inputVersionId) return;
    setBusy(true); setMessage(null);
    try {
      setPolicyPreview(await previewPlaytestPolicy(projectId, inputVersionId, overrides()));
      setMessage("Backend-authoritative playtest policy previewed. No campaign ran.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const run = async () => {
    if (!inputVersionId || !seed) return;
    setBusy(true); setMessage(null); setReplay(null);
    try {
      const created = await runPlaytestCampaign(projectId, inputVersionId, seed, overrides());
      setCampaign(created);
      setSelectedSampleId(created.content.report.representatives.medianCompletedSampleId ?? created.content.samples[0]?.id ?? "");
      setPolicyPreview({
        inputArtifactVersionId: created.content.simulationInputArtifactVersionId,
        inputFingerprint: created.content.simulationInputFingerprint,
        runtimeFingerprint: created.content.compiledRuntimeFingerprint,
        snapshotId: created.content.snapshotId,
        policy: created.content.policy,
      });
      await refresh();
      setMessage("Seeded campaign completed offline and immutable evidence was saved.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const reopen = async (versionId: string) => {
    setBusy(true); setMessage(null); setReplay(null);
    try {
      const loaded = await loadPlaytestCampaign(projectId, versionId);
      setCampaign(loaded);
      setInputVersionId(loaded.content.simulationInputArtifactVersionId);
      setSeed(loaded.content.seed);
      setSampleCount(loaded.content.policy.sampleCount);
      setMaxSteps(loaded.content.policy.maxStepsPerSample);
      setSelectedSampleId(loaded.content.report.representatives.medianCompletedSampleId ?? loaded.content.samples[0]?.id ?? "");
      setMessage("Historical campaign reopened from immutable evidence.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };
  const replaySelected = async () => {
    if (!campaign || !selectedSampleId) return;
    setBusy(true); setMessage(null);
    try {
      setReplay(await replayPlaytestSample(projectId, campaign.id, selectedSampleId));
      setMessage("Sample replay matched its stored deterministic trace fingerprint.");
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  };

  const selectedSample = campaign?.content.samples.find((sample) => sample.id === selectedSampleId) ?? null;
  const filteredSamples = useMemo(() => campaign?.content.samples.filter((sample) => {
    const query = sampleFilter.trim().toLowerCase();
    return !query || sample.id.toLowerCase().includes(query) || String(sample.index).includes(query)
      || sample.endingId?.toLowerCase().includes(query) || sample.routeIds.some((id) => id.toLowerCase().includes(query));
  }).slice(0, 100) ?? [], [campaign, sampleFilter]);
  const findings = campaign?.content.findings.filter((finding) => findingFilter === "all"
    || finding.evidenceLevel === findingFilter || finding.category === findingFilter) ?? [];

  return <section className="playtest-workspace" aria-label="Seeded playtesting and experience analysis">
    <header className="playtest-header">
      <div>
        <p className="eyebrow">Foundation 5B</p>
        <h2>Seeded playtesting &amp; experience analysis</h2>
        <p>Sample the exact 5A runtime deterministically, inspect bounded evidence, and replay any path. This workspace never repairs authoring data or calls a provider.</p>
      </div>
    </header>

    {message && <p className={/saved|matched|reopened|previewed/.test(message) ? "status good" : "error"} role="status">{message}</p>}

    <section className="brief-section playtest-controls">
      <h3>Campaign definition</h3>
      <div className="playtest-control-grid">
        <label>Exact simulation input
          <select aria-label="Playtest simulation input" value={inputVersionId} onChange={(event) => {
            setInputVersionId(event.target.value); setPolicyPreview(null);
          }}>
            <option value="">Capture an approved 5A input first</option>
            {inputs.map((input) => <option key={input.versionId} value={input.versionId}>
              v{input.version} · {input.passageCount} passages · {input.fingerprint.slice(0, 12)}
            </option>)}
          </select>
        </label>
        <label>Campaign seed
          <input aria-label="Campaign seed" value={seed} maxLength={256} onChange={(event) => setSeed(event.target.value)} />
        </label>
        <label>Samples
          <input aria-label="Campaign sample count" type="number" min={1} max={500} value={sampleCount}
            onChange={(event) => setSampleCount(Number(event.target.value))} />
        </label>
        <label>Maximum steps per sample
          <input aria-label="Campaign maximum steps" type="number" min={1} max={500} value={maxSteps}
            onChange={(event) => setMaxSteps(Number(event.target.value))} />
        </label>
      </div>
      <div className="artifact-actions">
        <button disabled={busy || !inputVersionId} onClick={() => void preview()}>Preview bounded policy</button>
        <button className="primary" disabled={busy || !inputVersionId || !seed} onClick={() => void run()}>Run seeded campaign</button>
      </div>
      {policyPreview && <PolicyEvidence preview={policyPreview} />}
    </section>

    <section className="brief-section playtest-history">
      <h3>Historical campaigns</h3>
      {campaigns.length === 0 ? <p>No seeded campaigns yet.</p> : <div className="playtest-history-list">{campaigns.map((item) =>
        <button key={item.versionId} onClick={() => void reopen(item.versionId)}>
          <span>v{item.version} · seed {item.seed} · {item.sampleCount} samples</span>
          <small>{item.passageCoveragePercentage.toFixed(1)}% passages · {item.routeCoverageCount} routes · {item.endingCoverageCount} endings · {item.hardFailureSampleCount} hard failures</small>
          <small>{item.findingCount}/{item.totalFindingCount} findings retained{item.findingsTruncated ? ` · ${item.omittedFindingCount} omitted by bounds` : ""}</small>
          <small>{item.simulationInputFingerprint.slice(0, 12)} / {item.reportFingerprint.slice(0, 12)}</small>
        </button>)}</div>}
    </section>

    {campaign && <CampaignEvidence
      campaign={campaign}
      findings={findings}
      findingFilter={findingFilter}
      setFindingFilter={setFindingFilter}
      filteredSamples={filteredSamples}
      sampleFilter={sampleFilter}
      setSampleFilter={setSampleFilter}
      selectedSampleId={selectedSampleId}
      setSelectedSampleId={(id) => { setSelectedSampleId(id); setReplay(null); }}
      selectedSample={selectedSample}
      replay={replay}
      busy={busy}
      replaySelected={replaySelected}
      onNavigateStableId={onNavigateStableId}
    />}
  </section>;
}

function PolicyEvidence({ preview }: { preview: Awaited<ReturnType<typeof previewPlaytestPolicy>> }) {
  const policy = preview.policy;
  return <dl className="simulation-metadata playtest-policy" aria-label="Backend playtest policy">
    <div><dt>Input / runtime</dt><dd>{preview.inputFingerprint}<br />{preview.runtimeFingerprint}</dd></div>
    <div><dt>Algorithms</dt><dd>{policy.prngVersion}<br />{policy.strategyVersion}</dd></div>
    <div><dt>Requested work</dt><dd>{policy.sampleCount} samples · {policy.maxStepsPerSample} steps/sample · {policy.maxTotalSampledSteps.toLocaleString()} total-step ceiling</dd></div>
    <div><dt>Evidence bounds</dt><dd>{policy.maxTraceBytesPerSample.toLocaleString()} bytes/trace · {policy.maxCampaignBytes.toLocaleString()} campaign bytes · {policy.maxFindings} findings</dd></div>
    <div><dt>Retention</dt><dd>{policy.maxRetainedFullTraces} full compact traces; every sample keeps its exact stable-ID path</dd></div>
    <div><dt>Experience thresholds</dt><dd>{policy.linearStretchThreshold} linear passages · {policy.denseChoiceThreshold} enabled choices for density evidence</dd></div>
  </dl>;
}

function CampaignEvidence(props: {
  campaign: PlaytestCampaignVersion;
  findings: PlaytestFinding[];
  findingFilter: string;
  setFindingFilter(value: string): void;
  filteredSamples: PlaytestCampaignVersion["content"]["samples"];
  sampleFilter: string;
  setSampleFilter(value: string): void;
  selectedSampleId: string;
  setSelectedSampleId(value: string): void;
  selectedSample: PlaytestCampaignVersion["content"]["samples"][number] | null;
  replay: PlaytestReplay | null;
  busy: boolean;
  replaySelected(): Promise<void>;
  onNavigateStableId?(stableId: string): void;
}) {
  const content = props.campaign.content;
  const report = content.report;
  const sharedDecisionIds = report.sharedDecisionIds ?? [];
  const findingRetention = content.findingRetention ?? {
    totalFindingCount: content.findings.length,
    retainedFindingCount: content.findings.length,
    omittedFindingCount: 0,
    retainedFindingBytes: 0,
    truncated: false,
    aggregateReportFindingBasis: "all-generated-findings" as const,
  };
  return <section className="playtest-results" aria-label="Playtest campaign evidence">
    <section className="brief-section playtest-overview">
      <header><div><p className="eyebrow">Immutable campaign v{props.campaign.version}</p><h3>Aggregate report</h3></div>
        <strong>{content.actualSampleCount} samples · {report.hardFailureSampleCount} hard failures</strong></header>
      <dl className="playtest-kpis">
        <div><dt>Passages</dt><dd>{report.passageCoverage.visited}/{report.passageCoverage.total} · {report.passageCoverage.percentage.toFixed(1)}%</dd></div>
        <div><dt>Choices selected</dt><dd>{report.choiceCoverage.selected}/{report.choiceCoverage.total}</dd></div>
        <div><dt>Completed samples</dt><dd>{report.completedSampleCount}/{report.sampleCount}</dd></div>
        <div><dt>Sampled steps</dt><dd>{report.totalSampledSteps.toLocaleString()}</dd></div>
        <div><dt>Median path words</dt><dd>{report.pacing.medianWords?.toLocaleString() ?? "No completed path"}</dd></div>
        <div><dt>Report fingerprint</dt><dd>{report.fingerprint}</dd></div>
      </dl>
      <details><summary>Exact immutable provenance</summary><dl className="simulation-metadata">
        <div><dt>Campaign</dt><dd>{content.id}<br />{content.fingerprint}</dd></div>
        <div><dt>Simulation input</dt><dd>{content.simulationInputArtifactVersionId}<br />{content.simulationInputFingerprint}</dd></div>
        <div><dt>Runtime</dt><dd>{content.compiledRuntimeFingerprint}</dd></div>
        <div><dt>Snapshot</dt><dd>{content.snapshotId}</dd></div>
      </dl></details>
    </section>

    <section className="playtest-report-grid">
      <CoverageTable title="Passage coverage" rows={report.passageCoverage.items.map((item) => ({
        id: item.passageId, value: `${item.visitCount} visits · ${item.sampleCount} samples`, gap: item.visitCount === 0,
      }))} navigate={props.onNavigateStableId} />
      <CoverageTable title="Choice coverage" rows={report.choiceCoverage.items.map((item) => ({
        id: item.choiceId,
        value: `${item.selectionCount} selected · ${item.observedEnabledCount} observed enabled`,
        gap: item.selectionCount === 0,
      }))} navigate={props.onNavigateStableId} />
    </section>

    <section className="playtest-report-grid">
      <section className="brief-section"><h3>Route coverage</h3><div className="compact-table">{report.routeCoverage.map((item) =>
        <div key={item.routeId}><button className="stable-id-link" onClick={() => props.onNavigateStableId?.(item.routeId)}>{item.label}</button>
          <span>{item.sampleCount} samples · {(item.frequency * 100).toFixed(1)}% · {item.associatedPassageSampleCount} with associated content · decisions {item.decisionIds.join(", ") || "none"}</span></div>)}</div>
        {sharedDecisionIds.length > 0 && <p>Observed shared decisions: {sharedDecisionIds.join(", ")}</p>}</section>
      <section className="brief-section"><h3>Ending coverage</h3><div className="compact-table">{report.endingCoverage.map((item) =>
        <div key={item.endingId}><button className="stable-id-link" onClick={() => props.onNavigateStableId?.(item.endingId)}>{item.label}</button>
          <span>{item.completedCount} eligible · {item.ineligibleCount} ineligible · {item.observedCount} observed</span></div>)}</div></section>
    </section>

    <section className="brief-section"><h3>Mechanic and relationship trajectories</h3>
      <div className="mechanic-trajectory-list">{report.mechanics.map((item) => <details key={item.mechanicKey}>
        <summary>{item.label} · {item.category} · {item.observedWriteCount} writes · {item.samplesWithObservedDownstreamConsequence} samples with later structured consequence</summary>
        <dl className="simulation-metadata">
          <div><dt>Range</dt><dd>{JSON.stringify(item.initialValue)} initial · {item.observedMinimum ?? "n/a"} min · {item.observedMaximum ?? "n/a"} max</dd></div>
          <div><dt>Changed by</dt><dd>{item.choiceIdsCausingChanges.join(", ") || "No observed writes"}</dd></div>
          <div><dt>Later choice reads</dt><dd>{item.downstreamReadChoiceIds.join(", ") || "None declared"}</dd></div>
          <div><dt>Ending reads</dt><dd>{item.downstreamEndingIds.join(", ") || "None declared"}</dd></div>
          <div><dt>Final distribution</dt><dd>{JSON.stringify(item.finalDistribution)}</dd></div>
          <div><dt>Route distributions</dt><dd>{JSON.stringify(item.routeFinalDistributions)}</dd></div>
        </dl>
      </details>)}</div>
    </section>

    <section className="playtest-report-grid">
      <section className="brief-section"><h3>Continuity &amp; thread evidence</h3>
        <p>{report.continuity.requiredBeforeKnownCount} required-before-known observations · {report.continuity.payoffBeforeSetupCount} payoff-before-setup observations.</p>
        <div className="compact-table">{report.continuity.threadObservations.map((thread) => <div key={thread.threadId}>
          <button className="stable-id-link" onClick={() => props.onNavigateStableId?.(thread.threadId)}>{thread.threadId}</button>
          <span>{thread.setupSampleCount} setup · {thread.payoffSampleCount} payoff · {thread.payoffWithoutSetupSampleCount} payoff without observed setup</span>
        </div>)}</div>
      </section>
      <section className="brief-section"><h3>Pacing &amp; choice density</h3>
        <p>{report.pacing.minimumWords?.toLocaleString() ?? "n/a"} min · {report.pacing.medianWords?.toLocaleString() ?? "n/a"} median · {report.pacing.maximumWords?.toLocaleString() ?? "n/a"} max words.</p>
        <p>{report.pacing.longLinearStretchCount} long linear stretches observed · {report.pacing.denseChoiceRegionCount} dense choice regions observed.</p>
        <p>Word basis: {Object.entries(report.pacing.basisCounts).map(([basis, count]) => `${basis} ${count}`).join(" · ")}</p>
      </section>
    </section>

    <section className="brief-section"><h3>Route-exclusive content</h3><div className="compact-table">{report.routeExclusiveContent.map((item) =>
      <div key={item.routeId}><button className="stable-id-link" onClick={() => props.onNavigateStableId?.(item.routeId)}>{item.routeId}</button>
        <span>{item.observedPassageIds.length}/{item.authoredPassageIds.length} exclusive passages · {item.observedWords.toLocaleString()}/{item.authoredWords.toLocaleString()} words observed · {item.acceptedWordVolume.toLocaleString()} accepted-word volume</span></div>)}</div></section>

    <section className="brief-section playtest-findings"><header><div><h3>Deterministic findings</h3><p>Sample absence is labeled as bounded evidence, never proof of impossibility.</p>
      <p>{findingRetention.retainedFindingCount}/{findingRetention.totalFindingCount} retained from all generated evidence{findingRetention.truncated ? `; ${findingRetention.omittedFindingCount} omitted by deterministic bounds` : ""}.</p></div>
      <label>Filter findings<select aria-label="Filter playtest findings" value={props.findingFilter} onChange={(event) => props.setFindingFilter(event.target.value)}>
        <option value="all">All</option><option value="hard-error">Hard errors</option><option value="warning">Warnings</option>
        <option value="coverage-gap">Coverage gaps</option><option value="observation">Observations</option>
        <option value="continuity">Continuity</option><option value="mechanic">Mechanics</option><option value="pacing">Pacing</option>
      </select></label></header>
      <div className="finding-list">{props.findings.slice(0, 250).map((finding) => <FindingRow key={finding.id} finding={finding} navigate={props.onNavigateStableId} />)}</div>
      {props.findings.length > 250 && <p>Showing the first 250 of {props.findings.length} filtered findings.</p>}
    </section>

    <section className="brief-section playtest-samples"><header><div><h3>Samples &amp; replay</h3><p>All samples retain compact paths. Only one replay trace is loaded and rendered at a time.</p></div>
      <label>Find sample<input aria-label="Find playtest sample" value={props.sampleFilter} onChange={(event) => props.setSampleFilter(event.target.value)} placeholder="index, ID, route, ending" /></label></header>
      <div className="representative-actions">
        {Object.entries(report.representatives).map(([label, id]) => id && <button key={label} onClick={() => props.setSelectedSampleId(id)}>{humanize(label)}</button>)}
      </div>
      <div className="sample-metadata-list" role="list" aria-label="Compact playtest sample summaries">{props.filteredSamples.map((sample) =>
        <button role="listitem" className={sample.id === props.selectedSampleId ? "selected" : ""} key={sample.id} onClick={() => props.setSelectedSampleId(sample.id)}>
          <span>#{sample.index} · {sample.result.kind}{sample.endingId ? ` · ${sample.endingId}` : ""}</span>
          <small>{sample.stepCount} steps · {sample.words.total.toLocaleString()} words ({sample.words.basis}) · {sample.routeIds.join(", ") || "shared"}</small>
        </button>)}</div>
      {props.selectedSample && <section className="selected-sample" aria-label="Selected playtest sample">
        <h4>Sample #{props.selectedSample.index}</h4>
        <p>{props.selectedSample.id}</p>
        <p>{props.selectedSample.choiceIds.length} exact choices · trace {props.selectedSample.traceFingerprint}</p>
        {props.selectedSample.hardFailure && <p className="error">Hard runtime evidence: {props.selectedSample.hardFailureCodes.join(", ")}</p>}
        <button className="primary" disabled={props.busy} onClick={() => void props.replaySelected()}>Replay exact sample</button>
      </section>}
      {props.replay && <ReplayEvidence replay={props.replay} navigate={props.onNavigateStableId} />}
    </section>
  </section>;
}

function CoverageTable({ title, rows, navigate }: {
  title: string;
  rows: Array<{ id: string; value: string; gap: boolean }>;
  navigate?: (id: string) => void;
}) {
  return <section className="brief-section coverage-table"><h3>{title}</h3><div className="compact-table">
    {rows.slice(0, 300).map((row) => <div className={row.gap ? "coverage-gap" : ""} key={row.id}>
      <button className="stable-id-link" onClick={() => navigate?.(row.id)}>{row.id}</button><span>{row.value}</span>
    </div>)}
  </div>{rows.length > 300 && <p>Showing 300 of {rows.length} metadata rows.</p>}</section>;
}

function FindingRow({ finding, navigate }: { finding: PlaytestFinding; navigate?: (id: string) => void }) {
  const ids = [...finding.passageIds, ...finding.choiceIds, ...finding.mechanicKeys, ...finding.routeIds, ...finding.endingIds];
  return <article className={`playtest-finding ${finding.evidenceLevel}`}>
    <header><strong>{finding.code}</strong><span>{finding.evidenceLevel}</span></header>
    <p>{finding.message}</p>
    {ids.length > 0 && <p className="finding-links">{ids.map((id) => <button className="stable-id-link" key={id} onClick={() => navigate?.(id)}>{id}</button>)}</p>}
    {finding.sampleId && <small>Sample {finding.sampleIndex} · trace {finding.traceFingerprint}</small>}
  </article>;
}

function ReplayEvidence({ replay, navigate }: { replay: PlaytestReplay; navigate?: (id: string) => void }) {
  return <section className="replay-evidence" aria-label="Verified playtest replay">
    <header><h4>Verified deterministic replay</h4><strong>{replay.trace.result.kind}</strong></header>
    <p>{replay.trace.fingerprint}</p>
    <p>{replay.trace.visitedPassageIds.length} visited passages · {replay.trace.selectedChoiceIds.length} choices.</p>
    <div className="simulation-steps">{replay.trace.steps.map((step) => <details key={`${step.stepIndex}-${step.selectedChoiceId}`}>
      <summary>Step {step.stepIndex + 1}: {step.passageId} → {step.selectedChoiceId} → {step.nextPassageId}</summary>
      <p>{step.enabledChoiceIds.length} choices were enabled: {step.enabledChoiceIds.join(", ")}</p>
      <p><button className="stable-id-link" onClick={() => navigate?.(step.passageId)}>{step.passageId}</button>
        <button className="stable-id-link" onClick={() => navigate?.(step.selectedChoiceId)}>{step.selectedChoiceId}</button></p>
      {step.stateDelta.length > 0 && <ul>{step.stateDelta.map((delta) => <li key={delta.path}><code>{delta.path}</code>: {JSON.stringify(delta.before)} → {JSON.stringify(delta.after)}</li>)}</ul>}
    </details>)}</div>
  </section>;
}

function humanize(value: string): string {
  return value.replace(/SampleId$/, "").replace(/([A-Z])/g, " $1").trim().replace(/^./, (letter) => letter.toUpperCase());
}
