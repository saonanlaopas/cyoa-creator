import { useEffect, useMemo, useState } from "react";
import type {
  LongFormEndingPlan, LongFormMechanicsPlan, LongFormRoutePlan, LongFormStoryBible,
} from "../../api/long-form.js";
import {
  acknowledgePassageFinding,
  approvePassagePlan,
  clearPassageFindingAcknowledgement,
  createPassagePlan,
  createPassageSnapshot,
  downloadPassagePlan,
  listPassageEntityVersions,
  loadPassagePlan,
  restorePassageEntity,
  restorePassageSnapshot,
  savePassagePlan,
  type ChoicePlan,
  type NarrativeThread,
  type PassageFinding,
  type PassagePlan,
  type PassagePlanState,
  type PassageStructure,
  type PlanningStatus,
} from "../../api/passage-plan.js";

const id = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const move = <T,>(items: T[], index: number, direction: -1 | 1): T[] => {
  const next = [...items];
  const target = index + direction;
  if (target < 0 || target >= next.length) return items;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};
const replace = <T extends { id: string }>(items: T[], value: T) =>
  items.map((item) => item.id === value.id ? value : item);
const entityElementId = (type: string, entityId: string) => `passage-plan-${type}-${encodeURIComponent(entityId)}`;
const conditionKeys = (condition: ChoicePlan["condition"]): string[] => {
  if (!condition) return [];
  if (condition.kind === "compare") return [condition.mechanicKey];
  if (condition.kind === "not") return conditionKeys(condition.item);
  if (condition.kind === "all" || condition.kind === "any") return condition.items.flatMap(conditionKeys);
  return [];
};
type MechanicOption = {
  key: string;
  label: string;
  valueKind: "number" | "boolean" | "string";
  minimum?: number;
  maximum?: number;
  initial: number | boolean | string;
};
const mechanicOptions = (mechanics: LongFormMechanicsPlan | null): MechanicOption[] => [
  ...(mechanics?.visibleStats ?? []).map((item) => ({
    key: item.key, label: item.label, valueKind: "number" as const,
    minimum: item.minimum, maximum: item.maximum, initial: item.initial,
  })),
  ...(mechanics?.relationships ?? []).map((item) => ({
    key: item.key, label: item.label, valueKind: "number" as const,
    minimum: item.minimum, maximum: item.maximum, initial: item.initial,
  })),
  ...(mechanics?.flags ?? []).map((item) => ({
    key: item.key, label: item.label, valueKind: "boolean" as const, initial: false,
  })),
  ...(mechanics?.resources ?? []).map((item) => ({
    key: item.key, label: item.label,
    valueKind: item.kind === "inventory" ? "string" as const : "number" as const,
    ...(item.kind === "inventory" ? {} : { minimum: 0 }),
    initial: item.kind === "inventory" ? "" : item.initial,
  })),
];

export function PassagePlanWorkspace(props: {
  projectId: string;
  mechanicsApproved: boolean;
  bible: LongFormStoryBible | null;
  routes: LongFormRoutePlan | null;
  endings: LongFormEndingPlan | null;
  mechanics: LongFormMechanicsPlan | null;
  message: string | null;
  setMessage(value: string | null): void;
}) {
  const [state, setState] = useState<PassagePlanState | null>(null);
  const [structure, setStructure] = useState<PassageStructure | null>(null);
  const [passages, setPassages] = useState<PassagePlan[]>([]);
  const [choices, setChoices] = useState<ChoicePlan[]>([]);
  const [threads, setThreads] = useState<NarrativeThread[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [view, setView] = useState<"outline" | "graph" | "findings">("outline");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [jumpId, setJumpId] = useState("");
  const [filters, setFilters] = useState({
    act: "", route: "", status: "", character: "", mechanic: "", ending: "", findings: false, unresolved: false,
  });
  const [bulkStatus, setBulkStatus] = useState<PlanningStatus>("planned");
  const [bulkTag, setBulkTag] = useState("");
  const [overrideRationale, setOverrideRationale] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Array<{ id: string; version: number; createdAt: string }>>([]);
  const [focusEntity, setFocusEntity] = useState<{ type: string; id: string } | null>(null);

  const load = async () => {
    const next = await loadPassagePlan(props.projectId);
    setState(next);
    setStructure(next.structure?.content ?? null);
    setPassages(next.passages.map((item) => item.content));
    setChoices(next.choices.map((item) => item.content));
    setThreads(next.threads.map((item) => item.content));
    const available = new Set(next.passages.map((item) => item.entityId));
    setSelectedId((current) => available.has(current) ? current : next.structure?.content.startPassageId ?? next.passages[0]?.entityId ?? "");
  };
  useEffect(() => { void load().catch((reason: Error) => props.setMessage(reason.message)); }, [props.projectId]);

  const selected = passages.find((passage) => passage.id === selectedId) ?? null;
  useEffect(() => {
    if (!selectedId) return setHistory([]);
    void listPassageEntityVersions<PassagePlan>(props.projectId, "passage", selectedId).then(setHistory);
  }, [props.projectId, selectedId, state?.passages]);

  const choicesByPassage = useMemo(() => new Map(passages.map((passage) => [
    passage.id, choices.filter((choice) => choice.sourcePassageId === passage.id).sort((a, b) => a.position - b.position),
  ])), [passages, choices]);
  const findingsByEntity = useMemo(() => {
    const map = new Map<string, PassageFinding[]>();
    state?.report?.findings.forEach((finding) => map.set(finding.entityId, [...(map.get(finding.entityId) ?? []), finding]));
    return map;
  }, [state?.report]);
  const sequenceById = useMemo(() => new Map(structure?.sequences.map((item) => [item.id, item]) ?? []), [structure]);
  useEffect(() => {
    if (!focusEntity || view !== "outline") return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(entityElementId(focusEntity.type, focusEntity.id));
      if (typeof target?.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setFocusEntity(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusEntity, view, filters]);

  const visible = useMemo(() => passages.filter((passage) => {
    const sequence = sequenceById.get(passage.sequenceId);
    const choiceList = choicesByPassage.get(passage.id) ?? [];
    const haystack = `${passage.id} ${passage.title} ${passage.purpose} ${passage.summary} ${passage.tags.join(" ")}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase()))
      && (!filters.act || sequence?.actId === filters.act)
      && (!filters.route || passage.routeIds.includes(filters.route))
      && (!filters.status || passage.planningStatus === filters.status)
      && (!filters.character || passage.characterIds.includes(filters.character))
      && (!filters.mechanic || choiceList.some((choice) =>
        conditionKeys(choice.condition).includes(filters.mechanic) || choice.effects.some((effect) => effect.mechanicKey === filters.mechanic)))
      && (!filters.ending || passage.endingId === filters.ending)
      && (!filters.findings || (findingsByEntity.get(passage.id)?.length ?? 0) > 0
        || choiceList.some((choice) => (findingsByEntity.get(choice.id)?.length ?? 0) > 0))
      && (!filters.unresolved || passage.unresolvedQuestions.length > 0);
  }), [passages, search, filters, sequenceById, choicesByPassage, findingsByEntity]);

  if (!state) return <section className="artifact-pane"><p>Loading passage plan…</p></section>;
  if (!state.structure || !structure) return <section className="artifact-pane">
    <header className="artifact-header"><div><p className="eyebrow">Stage 6</p><h1>Passage plan</h1>
      <p>Build the executable structure before drafting prose.</p></div></header>
    <section className="panel">
      <p>This stage is completely local. It seeds a stable-ID outline from the approved routes and endings.</p>
      {!props.mechanicsApproved && <p className="warning">Approve mechanics before creating the passage plan.</p>}
      <button className="primary" disabled={busy || !props.mechanicsApproved} onClick={async () => {
        setBusy(true);
        try { await createPassagePlan(props.projectId); await load(); props.setMessage("Passage-plan workspace created locally."); }
        catch (reason) { props.setMessage((reason as Error).message); }
        finally { setBusy(false); }
      }}>Create passage plan</button>
    </section>
  </section>;

  const persist = async () => {
    const next = await savePassagePlan(props.projectId, { schemaVersion: 1, structure, passages, choices, threads });
    setState(next); setStructure(next.structure!.content);
    setPassages(next.passages.map((item) => item.content));
    setChoices(next.choices.map((item) => item.content));
    setThreads(next.threads.map((item) => item.content));
    return next;
  };
  const save = async () => {
    setBusy(true);
    try { await persist(); props.setMessage("Passage plan saved as immutable entity versions."); }
    catch (reason) { props.setMessage((reason as Error).message); }
    finally { setBusy(false); }
  };
  const selectEntity = (entityType: PassageFinding["entityType"], entityId: string) => {
    if (entityType === "passage") {
      setSelectedId(entityId);
      setFocusEntity({ type: "passage", id: entityId });
    }
    if (entityType === "choice") {
      const choice = choices.find((item) => item.id === entityId);
      if (choice) {
        setSelectedId(choice.sourcePassageId);
        setFocusEntity({ type: "choice", id: choice.id });
      }
    }
    if (entityType === "act") {
      setFilters({ ...filters, act: entityId });
      setFocusEntity({ type: "act", id: entityId });
    }
    if (entityType === "sequence") {
      const sequence = sequenceById.get(entityId);
      if (sequence) {
        setFilters({ ...filters, act: sequence.actId });
        const firstPassage = sequence.passageIds.find((id) => passages.some((item) => item.id === id));
        if (firstPassage) setSelectedId(firstPassage);
        setFocusEntity({ type: "sequence", id: sequence.id });
      }
    }
    if (entityType === "thread") setFocusEntity({ type: "thread", id: entityId });
    if (entityType === "mechanic") setFilters({ ...filters, mechanic: entityId });
    if (entityType === "route") setFilters({ ...filters, route: entityId });
    if (entityType === "ending") setFilters({ ...filters, ending: entityId });
    setView("outline");
  };
  const selectFinding = (finding: PassageFinding) => selectEntity(finding.entityType, finding.entityId);

  return <section className="artifact-pane passage-plan-workspace">
    <header className="artifact-header">
      <div><p className="eyebrow">Stage 6</p><h1>Passage plan</h1>
        <p>Structure v{state.structure.version} · {state.state.status} · {passages.length} passages · {choices.length} choices</p></div>
      <div className="artifact-actions">
        <button onClick={() => void downloadPassagePlan(props.projectId, "markdown")}>Export Markdown</button>
        <button onClick={() => void downloadPassagePlan(props.projectId, "json")}>Export JSON</button>
        <button onClick={() => void downloadPassagePlan(props.projectId, "bundle")}>Project bundle</button>
        <button disabled={busy} onClick={() => void save()}>Save plan</button>
        <button disabled={busy || Boolean(state.report?.findings.some((finding) => finding.severity === "error"))} onClick={async () => {
          setBusy(true);
          try {
            await persist();
            const snapshot = await createPassageSnapshot(props.projectId);
            await approvePassagePlan(props.projectId, snapshot.id);
            await load();
            props.setMessage(`Passage-plan snapshot v${snapshot.version} approved.`);
          } catch (reason) { props.setMessage((reason as Error).message); }
          finally { setBusy(false); }
        }}>Approve snapshot</button>
      </div>
    </header>
    {props.message && <p className={props.message.includes("approved") || props.message.includes("saved") ? "status good" : "error"} role="status">{props.message}</p>}

    <BudgetStrip report={state.report} />
    <nav className="passage-view-tabs">
      <button className={view === "outline" ? "primary" : ""} onClick={() => setView("outline")}>Outline</button>
      <button className={view === "graph" ? "primary" : ""} onClick={() => setView("graph")}>Graph</button>
      <button className={view === "findings" ? "primary" : ""} onClick={() => setView("findings")}>
        Coverage & findings ({state.report?.findings.length ?? 0})
      </button>
    </nav>

    {view === "findings" ? <CoverageDashboard
      state={state}
      rationale={overrideRationale}
      setRationale={setOverrideRationale}
      onSelect={selectFinding}
      onSelectEntity={selectEntity}
      onAcknowledge={async (finding) => {
        const rationale = overrideRationale[`${finding.code}:${finding.entityId}`] ?? "";
        if (!rationale.trim()) return props.setMessage("A warning override needs a rationale.");
        const result = await acknowledgePassageFinding(props.projectId, finding, rationale);
        setState({ ...state, report: result.report });
      }}
      onClearAcknowledgement={async (finding) => {
        const result = await clearPassageFindingAcknowledgement(props.projectId, finding);
        setState({ ...state, report: result.report });
      }}
    /> : view === "graph" ? <PassageGraph passages={visible} choices={choices} selectedId={selectedId} onSelect={setSelectedId} />
      : <>
        <PassageFilters
          structure={structure} routes={props.routes} bible={props.bible} mechanics={props.mechanics}
          endings={props.endings} search={search} setSearch={setSearch} filters={filters} setFilters={setFilters}
          jumpId={jumpId} setJumpId={setJumpId} onJump={() => {
            const passage = passages.find((item) => item.id === jumpId)
              ?? passages.find((item) => item.choiceIds.includes(jumpId));
            if (passage) setSelectedId(passage.id); else props.setMessage(`No passage or choice found for ${jumpId}.`);
          }}
        />
        <div className="passage-authoring-grid">
          <aside className="passage-outline">
            <StructureActions structure={structure} setStructure={setStructure} passages={passages} setPassages={setPassages}
              selectedId={selectedId} setSelectedId={setSelectedId} />
            <StructureEditor structure={structure} setStructure={setStructure} />
            <p className="field-note">{visible.length} of {passages.length} passages shown</p>
            {[...structure.acts].sort((a, b) => a.position - b.position).map((act, actIndex) =>
            <details id={entityElementId("act", act.id)} open key={act.id}>
              <summary><strong>{act.label}</strong> · {act.wordTarget.toLocaleString()} words
                <button type="button" disabled={actIndex === 0} onClick={(event) => {
                  event.preventDefault();
                  const acts = move(structure.acts, actIndex, -1).map((item, index) => ({ ...item, position: index }));
                  setStructure({ ...structure, acts });
                }}>↑</button>
                <button type="button" disabled={actIndex === structure.acts.length - 1} onClick={(event) => {
                  event.preventDefault();
                  const acts = move(structure.acts, actIndex, 1).map((item, index) => ({ ...item, position: index }));
                  setStructure({ ...structure, acts });
                }}>↓</button>
              </summary>
              {structure.sequences.filter((sequence) => sequence.actId === act.id).sort((a, b) => a.position - b.position).map((sequence) =>
                <div id={entityElementId("sequence", sequence.id)} className="outline-sequence" key={sequence.id}><strong>{sequence.label}</strong><small>{sequence.wordTarget.toLocaleString()} words</small>
                  {sequence.passageIds.map((passageId, passageIndex) => {
                    const passage = passages.find((item) => item.id === passageId);
                    if (!passage || !visible.some((item) => item.id === passage.id)) return null;
                    const severity = findingsByEntity.get(passage.id)?.[0]?.severity;
                    return <label id={entityElementId("passage", passage.id)} className={`outline-passage ${selectedId === passage.id ? "selected" : ""}`} key={passage.id}>
                      <input type="checkbox" checked={selectedIds.has(passage.id)} onChange={(event) => setSelectedIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(passage.id); else next.delete(passage.id);
                        return next;
                      })} />
                      <button type="button" onClick={() => setSelectedId(passage.id)}>{passage.title}</button>
                      <small>{passage.wordTarget}w · {passage.planningStatus}{severity ? ` · ${severity}` : ""}</small>
                      <button type="button" aria-label={`Move ${passage.title} up`} disabled={passageIndex === 0} onClick={() => {
                        const passageIds = move(sequence.passageIds, passageIndex, -1);
                        setStructure({ ...structure, sequences: replace(structure.sequences, { ...sequence, passageIds }) });
                        setPassages(passages.map((item) => item.sequenceId === sequence.id
                          ? { ...item, position: passageIds.indexOf(item.id) } : item));
                      }}>↑</button>
                      <button type="button" aria-label={`Move ${passage.title} down`} disabled={passageIndex === sequence.passageIds.length - 1} onClick={() => {
                        const passageIds = move(sequence.passageIds, passageIndex, 1);
                        setStructure({ ...structure, sequences: replace(structure.sequences, { ...sequence, passageIds }) });
                        setPassages(passages.map((item) => item.sequenceId === sequence.id
                          ? { ...item, position: passageIds.indexOf(item.id) } : item));
                      }}>↓</button>
                    </label>;
                  })}
                </div>)}
            </details>)}
            {selectedIds.size > 0 && <div className="bulk-editor">
              <strong>Bulk edit {selectedIds.size} passages</strong>
              <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as PlanningStatus)}>
                {["outline", "planned", "reviewed", "locked"].map((item) => <option key={item}>{item}</option>)}
              </select>
              <input value={bulkTag} onChange={(event) => setBulkTag(event.target.value)} placeholder="Optional tag" />
              <button type="button" onClick={() => {
                setPassages((items) => items.map((item) => selectedIds.has(item.id)
                  ? { ...item, planningStatus: bulkStatus, tags: bulkTag.trim() ? [...new Set([...item.tags, bulkTag.trim()])] : item.tags }
                  : item));
                setSelectedIds(new Set());
              }}>Apply locally</button>
            </div>}
          </aside>
          <main className="passage-detail">
            {selected ? <PassageEditor
              passage={selected} passages={passages} choices={choicesByPassage.get(selected.id) ?? []}
              sequences={structure.sequences} mechanics={props.mechanics} endings={props.endings}
              onChange={(passage) => setPassages(replace(passages, passage))}
              onMoveToSequence={(sequenceId) => {
                const destination = structure.sequences.find((item) => item.id === sequenceId);
                if (!destination || destination.id === selected.sequenceId) return;
                setStructure({
                  ...structure,
                  sequences: structure.sequences.map((sequence) => {
                    const withoutSelected = sequence.passageIds.filter((item) => item !== selected.id);
                    return sequence.id === destination.id
                      ? { ...sequence, passageIds: [...withoutSelected, selected.id] }
                      : { ...sequence, passageIds: withoutSelected };
                  }),
                });
                setPassages(replace(passages, {
                  ...selected,
                  sequenceId,
                  position: destination.passageIds.filter((item) => item !== selected.id).length,
                }));
              }}
              onChoicesChange={(next) => setChoices([
                ...choices.filter((choice) => choice.sourcePassageId !== selected.id), ...next,
              ])}
              onDelete={() => {
                setPassages(passages.filter((item) => item.id !== selected.id));
                setChoices(choices.filter((choice) => choice.sourcePassageId !== selected.id && choice.destinationPassageId !== selected.id));
                setStructure({
                  ...structure,
                  startPassageId: structure.startPassageId === selected.id ? null : structure.startPassageId,
                  sequences: structure.sequences.map((sequence) => ({ ...sequence, passageIds: sequence.passageIds.filter((item) => item !== selected.id) })),
                });
                setSelectedId("");
              }}
              history={history}
              onRestore={async (versionId) => {
                await restorePassageEntity(props.projectId, "passage", selected.id, versionId);
                await load();
              }}
            /> : <p>Select a passage from the outline.</p>}
          </main>
        </div>
        <ThreadEditor threads={threads} setThreads={setThreads} passages={passages} routes={props.routes}
          focusedThreadId={focusEntity?.type === "thread" ? focusEntity.id : null} />
      </>}

    <details className="artifact-history">
      <summary>Snapshots ({state.snapshots.length})</summary>
      {state.snapshots.map((snapshot) => <div className="snapshot-row" key={snapshot.id}>
        <span>Snapshot v{snapshot.version} · {snapshot.status} · {new Date(snapshot.createdAt).toLocaleString()}</span>
        <button disabled={busy || snapshot.id === state.state.approvedSnapshotId} onClick={async () => {
          setBusy(true);
          try { await restorePassageSnapshot(props.projectId, snapshot.id); await load(); props.setMessage(`Restored snapshot v${snapshot.version} as current draft heads.`); }
          catch (reason) { props.setMessage((reason as Error).message); }
          finally { setBusy(false); }
        }}>Restore</button>
      </div>)}
    </details>
  </section>;
}

function BudgetStrip({ report }: { report: PassagePlanState["report"] }) {
  if (!report) return null;
  const lines = [
    ...report.budgets.acts.map((item) => ({ ...item, level: "Act" })),
    ...report.budgets.routes.map((item) => ({ ...item, level: "Route" })),
    ...report.budgets.sequences.map((item) => ({ ...item, level: "Sequence" })),
  ];
  return <>
    <div className="route-budget passage-budget">
      <Metric label="Project planned" value={report.budgets.project.planned} />
      <Metric label="Project target" value={report.budgets.project.target} />
      <Metric label="Path minimum" value={report.coverage.pathWords.minimum ?? 0} />
      <Metric label="Representative" value={report.coverage.pathWords.representative ?? 0} />
      <Metric label="Path maximum" value={report.coverage.pathWords.maximum ?? 0} />
    </div>
    <details className="budget-details">
      <summary>Act, route, and sequence budgets</summary>
      <div className="coverage-table">
        {lines.map((item) => <div key={`${item.level}:${item.id}`}>
          <strong>{item.level} · {item.id}</strong>
          <span>{item.planned.toLocaleString()} planned</span>
          <span>{item.target.toLocaleString()} target</span>
          <span>{item.difference.toLocaleString()} remaining</span>
        </div>)}
      </div>
    </details>
  </>;
}

function PassageFilters(props: {
  structure: PassageStructure; routes: LongFormRoutePlan | null; bible: LongFormStoryBible | null;
  mechanics: LongFormMechanicsPlan | null; endings: LongFormEndingPlan | null;
  search: string; setSearch(value: string): void; filters: any; setFilters(value: any): void;
  jumpId: string; setJumpId(value: string): void; onJump(): void;
}) {
  const mechanics = mechanicOptions(props.mechanics);
  return <section className="passage-filters">
    <input value={props.search} onChange={(event) => props.setSearch(event.target.value)} placeholder="Search titles, IDs, summaries, and tags" />
    <select value={props.filters.act} onChange={(event) => props.setFilters({ ...props.filters, act: event.target.value })}><option value="">All acts</option>{props.structure.acts.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
    <select value={props.filters.route} onChange={(event) => props.setFilters({ ...props.filters, route: event.target.value })}><option value="">All routes</option>{props.routes?.routes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
    <select value={props.filters.status} onChange={(event) => props.setFilters({ ...props.filters, status: event.target.value })}><option value="">All statuses</option>{["outline", "planned", "reviewed", "locked"].map((item) => <option key={item}>{item}</option>)}</select>
    <select value={props.filters.character} onChange={(event) => props.setFilters({ ...props.filters, character: event.target.value })}><option value="">All characters</option>{props.bible?.characters.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
    <select value={props.filters.mechanic} onChange={(event) => props.setFilters({ ...props.filters, mechanic: event.target.value })}><option value="">All mechanics</option>{mechanics.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select>
    <select value={props.filters.ending} onChange={(event) => props.setFilters({ ...props.filters, ending: event.target.value })}><option value="">All endings</option>{props.endings?.endings.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>
    <label className="checkbox"><input type="checkbox" checked={props.filters.findings} onChange={(event) => props.setFilters({ ...props.filters, findings: event.target.checked })} /> Findings</label>
    <label className="checkbox"><input type="checkbox" checked={props.filters.unresolved} onChange={(event) => props.setFilters({ ...props.filters, unresolved: event.target.checked })} /> Unresolved</label>
    <div className="jump-control"><input value={props.jumpId} onChange={(event) => props.setJumpId(event.target.value)} placeholder="Jump to stable ID" /><button onClick={props.onJump}>Jump</button></div>
  </section>;
}

function StructureActions(props: {
  structure: PassageStructure; setStructure(value: PassageStructure): void;
  passages: PassagePlan[]; setPassages(value: PassagePlan[]): void;
  selectedId: string; setSelectedId(value: string): void;
}) {
  const selectedPassage = props.passages.find((item) => item.id === props.selectedId);
  const selectedSequence = props.structure.sequences.find((item) => item.id === selectedPassage?.sequenceId)
    ?? [...props.structure.sequences].sort((a, b) => a.position - b.position)[0];
  const selectedAct = props.structure.acts.find((item) => item.id === selectedSequence?.actId)
    ?? [...props.structure.acts].sort((a, b) => a.position - b.position)[0];
  return <div className="structure-actions">
    <button type="button" onClick={() => {
      const actId = id("act");
      props.setStructure({ ...props.structure, acts: [...props.structure.acts, {
        id: actId, label: "New act", purpose: "", summary: "", wordTarget: 0,
        routeIds: [], sequenceIds: [], position: props.structure.acts.length,
      }] });
    }}>Add act</button>
    <button type="button" disabled={!selectedAct} onClick={() => {
      const act = selectedAct!;
      const sequenceId = id("seq");
      props.setStructure({
        ...props.structure,
        acts: props.structure.acts.map((item) => item.id === act.id ? { ...item, sequenceIds: [...item.sequenceIds, sequenceId] } : item),
        sequences: [...props.structure.sequences, {
          id: sequenceId, actId: act.id, label: "New sequence", purpose: "", summary: "", wordTarget: 0,
          routeIds: [], passageIds: [], entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [],
          position: props.structure.sequences.filter((item) => item.actId === act.id).length, planningStatus: "outline",
        }],
      });
    }}>Add sequence</button>
    <button type="button" disabled={!selectedSequence} onClick={() => {
      const sequence = selectedSequence!;
      const passageId = id("passage");
      const passage: PassagePlan = {
        id: passageId, sequenceId: sequence.id, title: "New passage", kind: "scene", purpose: "", summary: "",
        wordTarget: 500, routeIds: sequence.routeIds, tags: [], characterIds: [], relationshipIds: [], locationIds: [],
        requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [], preservedDifferenceIds: [],
        choiceIds: [], terminal: false, endingId: null, draftingNotes: [], unresolvedQuestions: [],
        planningStatus: "outline", position: sequence.passageIds.length,
      };
      props.setPassages([...props.passages, passage]);
      props.setStructure({ ...props.structure, sequences: props.structure.sequences.map((item) =>
        item.id === sequence.id ? { ...item, passageIds: [...item.passageIds, passageId] } : item) });
      props.setSelectedId(passageId);
    }}>Add passage</button>
  </div>;
}

function StructureEditor(props: { structure: PassageStructure; setStructure(value: PassageStructure): void }) {
  return <details className="structure-editor">
    <summary>Edit project, act, and sequence budgets</summary>
    <label>Plan title<input value={props.structure.title} onChange={(event) => props.setStructure({ ...props.structure, title: event.target.value })} /></label>
    <div className="brief-grid">
      <label>Project words<input type="number" value={props.structure.projectWordTarget} onChange={(event) => props.setStructure({ ...props.structure, projectWordTarget: Number(event.target.value) })} /></label>
      <label>Typical path words<input type="number" value={props.structure.typicalPathWordTarget} onChange={(event) => props.setStructure({ ...props.structure, typicalPathWordTarget: Number(event.target.value) })} /></label>
      <label>Start passage ID<input value={props.structure.startPassageId ?? ""} onChange={(event) => props.setStructure({ ...props.structure, startPassageId: event.target.value || null })} /></label>
    </div>
    {props.structure.acts.map((act) => <article className="structure-record" key={act.id}>
      <div className="brief-grid">
        <label>Act label<input value={act.label} onChange={(event) => props.setStructure({ ...props.structure, acts: replace(props.structure.acts, { ...act, label: event.target.value }) })} /></label>
        <label>Word target<input type="number" min={0} value={act.wordTarget} onChange={(event) => props.setStructure({ ...props.structure, acts: replace(props.structure.acts, { ...act, wordTarget: Number(event.target.value) }) })} /></label>
      </div>
      <label>Purpose<textarea value={act.purpose} onChange={(event) => props.setStructure({ ...props.structure, acts: replace(props.structure.acts, { ...act, purpose: event.target.value }) })} /></label>
      <label>Summary<textarea value={act.summary} onChange={(event) => props.setStructure({ ...props.structure, acts: replace(props.structure.acts, { ...act, summary: event.target.value }) })} /></label>
      <Lines label="Route IDs" values={act.routeIds} onChange={(routeIds) => props.setStructure({ ...props.structure, acts: replace(props.structure.acts, { ...act, routeIds }) })} />
      {props.structure.sequences.filter((sequence) => sequence.actId === act.id).map((sequence, sequenceIndex, siblings) =>
        <details className="structure-sequence-record" key={sequence.id}>
          <summary>
            <strong>{sequence.label}</strong>
            <button type="button" disabled={sequenceIndex === 0} onClick={(event) => {
              event.preventDefault();
              const reordered = move(siblings, sequenceIndex, -1).map((item, position) => ({ ...item, position }));
              props.setStructure({ ...props.structure, sequences: props.structure.sequences.map((item) => reordered.find((candidate) => candidate.id === item.id) ?? item) });
            }}>↑</button>
            <button type="button" disabled={sequenceIndex === siblings.length - 1} onClick={(event) => {
              event.preventDefault();
              const reordered = move(siblings, sequenceIndex, 1).map((item, position) => ({ ...item, position }));
              props.setStructure({ ...props.structure, sequences: props.structure.sequences.map((item) => reordered.find((candidate) => candidate.id === item.id) ?? item) });
            }}>↓</button>
          </summary>
          <div className="brief-grid">
            <label>Sequence label<input value={sequence.label} onChange={(event) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, label: event.target.value }) })} /></label>
            <label>Word target<input type="number" min={0} value={sequence.wordTarget} onChange={(event) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, wordTarget: Number(event.target.value) }) })} /></label>
            <label>Status<select value={sequence.planningStatus} onChange={(event) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, planningStatus: event.target.value as PlanningStatus }) })}>{["outline", "planned", "reviewed", "locked"].map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <label>Purpose<textarea value={sequence.purpose} onChange={(event) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, purpose: event.target.value }) })} /></label>
          <label>Summary<textarea value={sequence.summary} onChange={(event) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, summary: event.target.value }) })} /></label>
          <Lines label="Route IDs" values={sequence.routeIds} onChange={(routeIds) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, routeIds }) })} />
          <Lines label="Entry goals" values={sequence.entryGoals} onChange={(entryGoals) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, entryGoals }) })} />
          <Lines label="Exit goals" values={sequence.exitGoals} onChange={(exitGoals) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, exitGoals }) })} />
          <Lines label="Required decision IDs" values={sequence.requiredDecisionIds} onChange={(requiredDecisionIds) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, requiredDecisionIds }) })} />
          <Lines label="Ending hook IDs" values={sequence.endingHookIds} onChange={(endingHookIds) => props.setStructure({ ...props.structure, sequences: replace(props.structure.sequences, { ...sequence, endingHookIds }) })} />
        </details>)}
    </article>)}
    <details className="brief-section">
      <summary><strong>Character availability ({props.structure.characterAvailability.length})</strong></summary>
      <button type="button" onClick={() => props.setStructure({
        ...props.structure,
        characterAvailability: [...props.structure.characterAvailability, {
          characterId: "", actIds: [], routeIds: [],
        }],
      })}>Add availability rule</button>
      {props.structure.characterAvailability.map((availability, index) =>
        <article className="structure-record" key={`${availability.characterId}:${index}`}>
          <label>Character ID<input value={availability.characterId} onChange={(event) => props.setStructure({
            ...props.structure,
            characterAvailability: props.structure.characterAvailability.map((item, itemIndex) =>
              itemIndex === index ? { ...item, characterId: event.target.value } : item),
          })} /></label>
          <Lines label="Available act IDs" values={availability.actIds} onChange={(actIds) => props.setStructure({
            ...props.structure,
            characterAvailability: props.structure.characterAvailability.map((item, itemIndex) =>
              itemIndex === index ? { ...item, actIds } : item),
          })} />
          <Lines label="Available route IDs" values={availability.routeIds} onChange={(routeIds) => props.setStructure({
            ...props.structure,
            characterAvailability: props.structure.characterAvailability.map((item, itemIndex) =>
              itemIndex === index ? { ...item, routeIds } : item),
          })} />
          <button type="button" className="danger" onClick={() => props.setStructure({
            ...props.structure,
            characterAvailability: props.structure.characterAvailability.filter((_, itemIndex) => itemIndex !== index),
          })}>Remove availability rule</button>
        </article>)}
    </details>
  </details>;
}

function PassageEditor(props: {
  passage: PassagePlan; passages: PassagePlan[]; choices: ChoicePlan[];
  sequences: PassageStructure["sequences"];
  mechanics: LongFormMechanicsPlan | null; endings: LongFormEndingPlan | null;
  onChange(value: PassagePlan): void; onMoveToSequence(sequenceId: string): void;
  onChoicesChange(value: ChoicePlan[]): void; onDelete(): void;
  history: Array<{ id: string; version: number; createdAt: string }>; onRestore(versionId: string): Promise<void>;
}) {
  const update = <K extends keyof PassagePlan>(key: K, value: PassagePlan[K]) => props.onChange({ ...props.passage, [key]: value });
  const mechanicItems = mechanicOptions(props.mechanics);
  return <article className="passage-editor">
    <header><div><p className="eyebrow">{props.passage.id}</p><h2>{props.passage.title}</h2></div>
      <button className="danger" onClick={props.onDelete}>Delete passage</button></header>
    <div className="brief-grid">
      <label>Title<input value={props.passage.title} onChange={(event) => update("title", event.target.value)} /></label>
      <label>Kind<select value={props.passage.kind} onChange={(event) => update("kind", event.target.value as PassagePlan["kind"])}>{["scene", "transition", "hub", "climax", "epilogue"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Word target<input type="number" min={0} value={props.passage.wordTarget} onChange={(event) => update("wordTarget", Number(event.target.value))} /></label>
      <label>Sequence<select value={props.passage.sequenceId} onChange={(event) => props.onMoveToSequence(event.target.value)}>
        {props.sequences.map((item) => <option value={item.id} key={item.id}>{item.label} · {item.id}</option>)}
      </select></label>
      <label>Status<select value={props.passage.planningStatus} onChange={(event) => update("planningStatus", event.target.value as PlanningStatus)}>{["outline", "planned", "reviewed", "locked"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Ending<select value={props.passage.endingId ?? ""} onChange={(event) => update("endingId", event.target.value || null)}><option value="">Not an ending</option>{props.endings?.endings.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
      <label className="checkbox"><input type="checkbox" checked={props.passage.terminal} onChange={(event) => update("terminal", event.target.checked)} /> Terminal</label>
    </div>
    <label>Purpose<textarea value={props.passage.purpose} onChange={(event) => update("purpose", event.target.value)} /></label>
    <label>Summary<textarea value={props.passage.summary} onChange={(event) => update("summary", event.target.value)} /></label>
    <div className="passage-reference-grid">
      <Lines label="Route IDs" values={props.passage.routeIds} onChange={(value) => update("routeIds", value)} />
      <Lines label="Tags" values={props.passage.tags} onChange={(value) => update("tags", value)} />
      <Lines label="Character IDs" values={props.passage.characterIds} onChange={(value) => update("characterIds", value)} />
      <Lines label="Relationship IDs" values={props.passage.relationshipIds} onChange={(value) => update("relationshipIds", value)} />
      <Lines label="Location IDs" values={props.passage.locationIds} onChange={(value) => update("locationIds", value)} />
      <Lines label="Required fact IDs" values={props.passage.requiredFactIds} onChange={(value) => update("requiredFactIds", value)} />
      <Lines label="Revealed fact IDs" values={props.passage.revealedFactIds} onChange={(value) => update("revealedFactIds", value)} />
      <Lines label="Setup thread IDs" values={props.passage.setupThreadIds} onChange={(value) => update("setupThreadIds", value)} />
      <Lines label="Payoff thread IDs" values={props.passage.payoffThreadIds} onChange={(value) => update("payoffThreadIds", value)} />
      <Lines label="Preserved difference IDs" values={props.passage.preservedDifferenceIds} onChange={(value) => update("preservedDifferenceIds", value)} />
      <Lines label="Drafting notes" values={props.passage.draftingNotes} onChange={(value) => update("draftingNotes", value)} />
      <Lines label="Unresolved questions" values={props.passage.unresolvedQuestions} onChange={(value) => update("unresolvedQuestions", value)} />
    </div>
    <header className="bible-section-heading"><h3>Choices</h3><button type="button" onClick={() => {
      const choiceId = id("choice");
      update("choiceIds", [...props.passage.choiceIds, choiceId]);
      props.onChoicesChange([...props.choices, {
        id: choiceId, sourcePassageId: props.passage.id, label: "New choice",
        destinationPassageId: props.passages.find((item) => item.id !== props.passage.id)?.id ?? props.passage.id,
        narrativeIntent: "", consequencePreview: "", condition: null, unavailableBehavior: "disabled",
        unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: props.choices.length,
      }]);
    }}>Add choice</button></header>
    {props.choices.map((choice, index) => <ChoiceEditor key={choice.id} choice={choice} passages={props.passages}
      mechanics={mechanicItems} onChange={(value) => props.onChoicesChange(props.choices.map((item) => item.id === value.id ? value : item))}
      onRemove={() => {
        update("choiceIds", props.passage.choiceIds.filter((item) => item !== choice.id));
        props.onChoicesChange(props.choices.filter((item) => item.id !== choice.id).map((item, position) => ({ ...item, position })));
      }}
      onMove={(direction) => {
        const next = move(props.choices, index, direction).map((item, position) => ({ ...item, position }));
        update("choiceIds", next.map((item) => item.id)); props.onChoicesChange(next);
      }} />)}
    <details className="artifact-history"><summary>Passage versions ({props.history.length})</summary>
      {props.history.map((version) => <div className="snapshot-row" key={version.id}><span>v{version.version} · {new Date(version.createdAt).toLocaleString()}</span><button onClick={() => void props.onRestore(version.id)}>Restore</button></div>)}
    </details>
  </article>;
}

function ChoiceEditor(props: {
  choice: ChoicePlan; passages: PassagePlan[]; mechanics: MechanicOption[];
  onChange(value: ChoicePlan): void; onRemove(): void; onMove(direction: -1 | 1): void;
}) {
  const compare = props.choice.condition?.kind === "compare" ? props.choice.condition : null;
  const conditionMechanic = compare ? props.mechanics.find((item) => item.key === compare.mechanicKey) : undefined;
  return <details id={entityElementId("choice", props.choice.id)} className="choice-editor" open>
    <summary>{props.choice.label} → {props.choice.destinationPassageId}</summary>
    <div className="brief-grid">
      <label>Label<input value={props.choice.label} onChange={(event) => props.onChange({ ...props.choice, label: event.target.value })} /></label>
      <label>Destination<select value={props.choice.destinationPassageId} onChange={(event) => props.onChange({ ...props.choice, destinationPassageId: event.target.value })}>{props.passages.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.id}</option>)}</select></label>
      <label>Unavailable<select value={props.choice.unavailableBehavior} onChange={(event) => props.onChange({ ...props.choice, unavailableBehavior: event.target.value as ChoicePlan["unavailableBehavior"] })}><option value="disabled">Visible, disabled</option><option value="hidden">Hidden</option></select></label>
      <label>Condition<select value={compare ? "compare" : "none"} onChange={(event) => props.onChange({
        ...props.choice,
        condition: event.target.value === "compare"
          ? { kind: "compare", mechanicKey: props.mechanics[0]?.key ?? "missing", operator: "gte", value: 1 }
          : null,
      })}><option value="none">Always available</option><option value="compare">Mechanic comparison</option></select></label>
    </div>
    {compare && <div className="mechanic-condition">
      <select value={compare.mechanicKey} onChange={(event) => {
        const mechanic = props.mechanics.find((item) => item.key === event.target.value)!;
        props.onChange({ ...props.choice, condition: {
          ...compare,
          mechanicKey: mechanic.key,
          operator: mechanic.valueKind === "number" ? "gte" : "eq",
          value: mechanic.initial,
        } });
      }}>{props.mechanics.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select>
      <select value={compare.operator} onChange={(event) => props.onChange({ ...props.choice, condition: { ...compare, operator: event.target.value as typeof compare.operator } })}>
        {(conditionMechanic?.valueKind === "number" ? ["eq", "neq", "gt", "gte", "lt", "lte"] : ["eq", "neq"])
          .map((item) => <option key={item}>{item}</option>)}
      </select>
      {conditionMechanic?.valueKind === "boolean"
        ? <select value={String(compare.value)} onChange={(event) => props.onChange({
          ...props.choice, condition: { ...compare, value: event.target.value === "true" },
        })}><option value="true">true</option><option value="false">false</option></select>
        : <input type={conditionMechanic?.valueKind === "number" ? "number" : "text"}
          min={conditionMechanic?.minimum} max={conditionMechanic?.maximum}
          value={String(compare.value)} onChange={(event) => props.onChange({
            ...props.choice,
            condition: { ...compare, value: conditionMechanic?.valueKind === "number" ? Number(event.target.value) : event.target.value },
          })} />}
    </div>}
    <label>Narrative intent<textarea value={props.choice.narrativeIntent} onChange={(event) => props.onChange({ ...props.choice, narrativeIntent: event.target.value })} /></label>
    <label>Consequence preview<textarea value={props.choice.consequencePreview} onChange={(event) => props.onChange({ ...props.choice, consequencePreview: event.target.value })} /></label>
    <label>Unavailable explanation<textarea value={props.choice.unavailableExplanation} onChange={(event) => props.onChange({ ...props.choice, unavailableExplanation: event.target.value })} /></label>
    <header className="bible-section-heading"><h4>Effects</h4><button type="button" disabled={!props.mechanics[0]} onClick={() => {
      const mechanic = props.mechanics[0]!;
      props.onChange({ ...props.choice, effects: [...props.choice.effects, {
        id: id("effect"), mechanicKey: mechanic.key,
        operation: mechanic.valueKind === "number" ? "add" : "set",
        value: mechanic.valueKind === "number" ? 1 : mechanic.initial,
        feedback: "", visibility: "visible",
      }] });
    }}>Add effect</button></header>
    {props.choice.effects.map((effect, index) => {
      const mechanic = props.mechanics.find((item) => item.key === effect.mechanicKey);
      const operations = mechanic?.valueKind === "number"
        ? ["set", "add", "subtract"] as const
        : mechanic?.valueKind === "boolean"
          ? ["set", "clear"] as const
          : ["set"] as const;
      return <div className="mechanic-condition mechanic-effect" key={effect.id}>
      <select value={effect.mechanicKey} onChange={(event) => {
        const nextMechanic = props.mechanics.find((item) => item.key === event.target.value)!;
        props.onChange({ ...props.choice, effects: props.choice.effects.map((item) => item.id === effect.id ? {
          ...item,
          mechanicKey: nextMechanic.key,
          operation: nextMechanic.valueKind === "number" ? "add" : "set",
          value: nextMechanic.valueKind === "number" ? 1 : nextMechanic.initial,
        } : item) });
      }}>{props.mechanics.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select>
      <select value={effect.operation} onChange={(event) => {
        const operation = event.target.value as typeof effect.operation;
        props.onChange({ ...props.choice, effects: props.choice.effects.map((item) => item.id === effect.id
          ? { ...item, operation, value: operation === "clear" ? null : item.value ?? mechanic?.initial ?? 0 }
          : item) });
      }}>{operations.map((item) => <option key={item}>{item}</option>)}</select>
      {mechanic?.valueKind === "boolean"
        ? <select disabled={effect.operation === "clear"} value={String(effect.value ?? false)} onChange={(event) => props.onChange({
          ...props.choice,
          effects: props.choice.effects.map((item) => item.id === effect.id
            ? { ...item, value: event.target.value === "true" } : item),
        })}><option value="true">true</option><option value="false">false</option></select>
        : <input disabled={effect.operation === "clear"} type={mechanic?.valueKind === "number" ? "number" : "text"}
          min={mechanic?.minimum} max={mechanic?.maximum}
          value={effect.value === null ? "" : String(effect.value)} onChange={(event) => props.onChange({
            ...props.choice,
            effects: props.choice.effects.map((item) => item.id === effect.id ? {
              ...item, value: mechanic?.valueKind === "number" ? Number(event.target.value) : event.target.value,
            } : item),
          })} />}
      <input placeholder="Player feedback" value={effect.feedback} onChange={(event) => props.onChange({ ...props.choice, effects: props.choice.effects.map((item) => item.id === effect.id ? { ...item, feedback: event.target.value } : item) })} />
      <button type="button" onClick={() => props.onChange({ ...props.choice, effects: props.choice.effects.filter((_, itemIndex) => itemIndex !== index) })}>Remove</button>
    </div>;
    })}
    <div className="proposal-actions"><button type="button" onClick={() => props.onMove(-1)}>↑</button><button type="button" onClick={() => props.onMove(1)}>↓</button><button type="button" className="danger" onClick={props.onRemove}>Remove choice</button></div>
  </details>;
}

function ThreadEditor(props: {
  threads: NarrativeThread[]; setThreads(value: NarrativeThread[]): void; passages: PassagePlan[];
  routes: LongFormRoutePlan | null; focusedThreadId: string | null;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (props.focusedThreadId) setOpen(true); }, [props.focusedThreadId]);
  return <details className="brief-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><strong>Narrative threads ({props.threads.length})</strong></summary>
    <button type="button" onClick={() => props.setThreads([...props.threads, {
      id: id("thread"), label: "New narrative thread", description: "", setupPassageIds: [], payoffPassageIds: [],
      routeIds: [], required: false, status: "planned", waiverRationale: "",
    }])}>Add thread</button>
    {props.threads.map((thread) => <article id={entityElementId("thread", thread.id)} className="bible-card" key={thread.id}>
      <div className="brief-grid"><label>Label<input value={thread.label} onChange={(event) => props.setThreads(replace(props.threads, { ...thread, label: event.target.value }))} /></label>
        <label>Status<select value={thread.status} onChange={(event) => props.setThreads(replace(props.threads, { ...thread, status: event.target.value as NarrativeThread["status"] }))}>{["planned", "partially-covered", "covered", "waived"].map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="checkbox"><input type="checkbox" checked={thread.required} onChange={(event) => props.setThreads(replace(props.threads, { ...thread, required: event.target.checked }))} /> Required</label></div>
      <label>Description<textarea value={thread.description} onChange={(event) => props.setThreads(replace(props.threads, { ...thread, description: event.target.value }))} /></label>
      <Lines label="Setup passage IDs" values={thread.setupPassageIds} onChange={(value) => props.setThreads(replace(props.threads, { ...thread, setupPassageIds: value }))} />
      <Lines label="Payoff passage IDs" values={thread.payoffPassageIds} onChange={(value) => props.setThreads(replace(props.threads, { ...thread, payoffPassageIds: value }))} />
      <Lines label="Route IDs" values={thread.routeIds} onChange={(value) => props.setThreads(replace(props.threads, { ...thread, routeIds: value }))} />
      <label>Waiver rationale<textarea value={thread.waiverRationale} onChange={(event) => props.setThreads(replace(props.threads, { ...thread, waiverRationale: event.target.value }))} /></label>
      <button type="button" className="danger" onClick={() => props.setThreads(props.threads.filter((item) => item.id !== thread.id))}>Remove thread</button>
    </article>)}
  </details>;
}

function PassageGraph(props: { passages: PassagePlan[]; choices: ChoicePlan[]; selectedId: string; onSelect(id: string): void }) {
  const visible = new Set(props.passages.map((item) => item.id));
  return <section className="passage-graph" aria-label="Filtered passage graph">
    {props.passages.map((passage) => <article className={passage.id === props.selectedId ? "selected" : ""} key={passage.id}>
      <button onClick={() => props.onSelect(passage.id)}><strong>{passage.title}</strong><small>{passage.id}</small></button>
      <ul>{props.choices.filter((choice) => choice.sourcePassageId === passage.id && visible.has(choice.destinationPassageId)).map((choice) =>
        <li key={choice.id}>{choice.label} → {props.passages.find((item) => item.id === choice.destinationPassageId)?.title}</li>)}</ul>
    </article>)}
  </section>;
}

function CoverageDashboard(props: {
  state: PassagePlanState; rationale: Record<string, string>; setRationale(value: Record<string, string>): void;
  onSelect(finding: PassageFinding): void;
  onSelectEntity(type: PassageFinding["entityType"], id: string): void;
  onAcknowledge(finding: PassageFinding): Promise<void>;
  onClearAcknowledgement(finding: PassageFinding): Promise<void>;
}) {
  const report = props.state.report!;
  return <section className="coverage-dashboard">
    <p className="field-note">Static analysis is conservative. Warnings identify paths to review; they are not proof that every runtime state will fail.</p>
    <div className="route-budget">
      <Metric label="Reachable" value={report.coverage.reachablePassageIds.length} />
      <Metric label="Unreachable" value={report.coverage.unreachablePassageIds.length} />
      <Metric label="Plausible endings" value={report.coverage.endingCoverage.filter((item) => item.plausible).length} />
      <Metric label="Errors" value={report.findings.filter((item) => item.severity === "error").length} />
      <Metric label="Warnings" value={report.findings.filter((item) => item.severity === "warning").length} />
    </div>
    <h3>Mechanics coverage</h3>
    <div className="coverage-table">{report.coverage.mechanicCoverage.map((item) =>
      <div key={item.key}>
        <button onClick={() => props.onSelectEntity("mechanic", item.key)}><strong>{item.key}</strong></button>
        <span>{item.writes.length} writes</span><span>{item.reads.length} reads</span>
        <span>{item.writes.map((id) => <button key={id} onClick={() => props.onSelectEntity("choice", id)}>{id}</button>)}</span>
        <span>{item.reads.map((id) => <button key={id} onClick={() => props.onSelectEntity("choice", id)}>{id}</button>)}</span>
      </div>)}</div>
    <h3>Route coverage</h3>
    <div className="coverage-table">{report.coverage.routeCoverage.map((item) =>
      <div key={item.routeId}>
        <button onClick={() => props.onSelectEntity("route", item.routeId)}><strong>{item.routeId}</strong></button>
        <span>{item.passageCount} passages</span><span>{item.endingCount} endings</span>
      </div>)}</div>
    <h3>Ending coverage</h3>
    <div className="coverage-table">{report.coverage.endingCoverage.map((item) =>
      <div key={item.endingId}>
        <button onClick={() => props.onSelectEntity("ending", item.endingId)}><strong>{item.endingId}</strong></button>
        <span>{item.plausible ? "Plausible path" : "No plausible path"}</span>
        <span>{item.incomingPassageIds.map((id) =>
          <button key={id} onClick={() => props.onSelectEntity("passage", id)}>{id}</button>)}</span>
      </div>)}</div>
    {report.coverage.pathWords.truncated && <p className="warning">
      Path enumeration reached its safety bound or encountered a cycle; displayed extrema cover analyzed simple paths only.
    </p>}
    <h3>Findings</h3>
    {report.findings.length === 0 && <p className="status good">No structural findings.</p>}
    {report.findings.map((finding) => {
      const key = `${finding.code}:${finding.entityId}`;
      return <article className={`finding-card validation-${finding.severity}`} key={key}>
        <header><button onClick={() => props.onSelect(finding)}>{finding.entityType} · {finding.entityId}</button><strong>{finding.severity}</strong></header>
        <p>{finding.message}</p><small>{finding.code}</small>
        {finding.evidence.length > 0 && <details><summary>Evidence</summary><p>{finding.evidence.join(", ")}</p></details>}
        <p className="field-note">{finding.suggestion}</p>
        {finding.severity === "warning" && (finding.acknowledged
          ? <div className="finding-override">
            <p>Acknowledged: {finding.overrideRationale}</p>
            <button onClick={() => void props.onClearAcknowledgement(finding)}>Remove acknowledgement</button>
          </div>
          : <div className="finding-override"><input value={props.rationale[key] ?? ""} onChange={(event) => props.setRationale({ ...props.rationale, [key]: event.target.value })} placeholder="Override rationale" /><button onClick={() => void props.onAcknowledge(finding)}>Acknowledge warning</button></div>)}
      </article>;
    })}
  </section>;
}

function Lines(props: { label: string; values: string[]; onChange(value: string[]): void }) {
  return <label>{props.label}<textarea value={props.values.join("\n")} onChange={(event) => props.onChange(lines(event.target.value))} /></label>;
}
function Metric(props: { label: string; value: number }) {
  return <div><strong>{props.value.toLocaleString()}</strong><span>{props.label}</span></div>;
}
