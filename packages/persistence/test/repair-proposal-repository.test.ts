import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REPAIR_PLANNING_POLICY_V1,
  repairFindingReferenceSchema,
  repairImpactSchema,
  repairPlanSchema,
  type RepairPlanDefinition,
} from "@story-to-cyoa/domain";
import {
  REPAIR_PROPOSAL_POLICY_V1,
  buildRepairProposal,
  defaultLongFormEndingPlan,
  defaultLongFormMechanicsPlan,
  defaultLongFormRoutePlan,
  defaultLongFormStoryBible,
  defaultPassagePlanBundle,
  defaultProjectBrief,
  deterministicRepairEntityId,
  repairProposalCandidateSchema,
  type RepairProposalBaseState,
  type RepairProposalRecord,
  type RepairProposalUnitCandidate,
} from "../../pipeline/src/index.js";
import {
  ArtifactRepository,
  PassagePlanRepository,
  ProjectRepository,
  RepairPlanRepository,
  RepairProposalGenerationRepository,
  RepairProposalRepository,
  openDatabase,
  type RepairProposalGenerationAggregateShape,
} from "../src/index.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(JSON.parse(JSON.stringify(value)))).digest("hex"); }

type Generation = RepairProposalGenerationAggregateShape & {
  baseFingerprint: string;
  base: RepairProposalBaseState;
  generation: RepairProposalGenerationAggregateShape["generation"] & {
    providerId: string; modelId: string; policy: typeof REPAIR_PROPOSAL_POLICY_V1; mode: "ai-assisted"; estimatedInputTokens: number;
  };
  job: RepairProposalGenerationAggregateShape["job"] & {
    status: string; startedAt: string | null; finishedAt: string | null; proposalId: string | null;
    proposalArtifactVersionId: string | null; error: unknown;
  };
};

function fixture(providerNeeded: "manual-deterministic" | "ai-assisted" = "manual-deterministic") {
  const database = openDatabase();
  const project = new ProjectRepository(database).create("Repair persistence", undefined, "long-form");
  const brief = defaultProjectBrief("Repair persistence");
  const bible = defaultLongFormStoryBible({ title: brief.workingTitle });
  const routes = defaultLongFormRoutePlan(brief);
  const endings = defaultLongFormEndingPlan(routes);
  const mechanics = defaultLongFormMechanicsPlan(bible, endings);
  mechanics.choiceEffectPlans = [{ id: "effect-repair", label: "Repair", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: mechanics.visibleStats.map((item) => item.key), effectGuidance: ["Exercise state."] }];
  const bundle = defaultPassagePlanBundle(brief, routes, endings);
  const plans = new PassagePlanRepository(database);
  plans.initialize(project.id, bundle.structure, [
    ...bundle.passages.map((content) => ({ kind: "passage" as const, id: content.id, content })),
    ...bundle.choices.map((content) => ({ kind: "choice" as const, id: content.id, content })),
    ...bundle.threads.map((content) => ({ kind: "thread" as const, id: content.id, content })),
  ]);
  const artifacts = new ArtifactRepository(database);
  const bibleVersion = artifacts.saveArtifact({ projectId: project.id, artifactId: "bible", content: bible });
  const routesVersion = artifacts.saveArtifact({ projectId: project.id, artifactId: "routes", content: routes });
  const endingsVersion = artifacts.saveArtifact({ projectId: project.id, artifactId: "endings", content: endings });
  const mechanicsVersion = artifacts.saveArtifact({ projectId: project.id, artifactId: "mechanics", content: mechanics });
  const passage = plans.currentEntities<typeof bundle.passages[number]>(project.id, "passage")[0]!;
  const expectedBase = { kind: "passage-entity-version" as const, targetKey: `passage:${passage.entityId}`, entityKind: "passage" as const, entityId: passage.entityId, versionId: passage.id };
  const finding = { code: "repair", severity: "warning" as const, entityType: "passage" as const, entityId: passage.entityId, message: "Repair the exact passage.", evidence: [passage.entityId], suggestion: "Repair it.", acknowledged: false };
  const findingFingerprint = fingerprint(finding);
  const reference = {
    schemaId: repairFindingReferenceSchema.id, schemaVersion: 1 as const, kind: "foundation-3-static-validation" as const,
    projectId: project.id, snapshotId: "snapshot", snapshotVersion: 1, structureVersionId: plans.currentStructure(project.id)!.id,
    upstreamVersions: {}, findingFingerprint, finding,
  };
  const target = { kind: "passage-plan-passage" as const, passageId: passage.entityId };
  const node = { id: `direct:${target.kind}:${expectedBase.targetKey}`, classification: "direct" as const, entityKind: target.kind, entityId: expectedBase.targetKey, label: expectedBase.targetKey, reason: "Exact scope" };
  const graphCore = { schemaId: repairImpactSchema.id, schemaVersion: 1 as const, policyId: "foundation-6a-impact-v1" as const, nodes: [node], edges: [] };
  const definition: RepairPlanDefinition = {
    schemaId: repairPlanSchema.id, schemaVersion: 1, projectId: project.id, selectedFindings: [reference],
    resolvedFindings: [{ reference, sourceFingerprint: findingFingerprint, sourceState: "current", stateReasons: [], categoryCode: "repair", message: finding.message, entityKeys: [expectedBase.targetKey] }],
    intent: { schemaVersion: 1, category: "passage-plan", note: "" }, authorizedTargets: [target], expectedBases: [expectedBase],
    impactGraph: { ...graphCore, fingerprint: fingerprint(graphCore) }, sourceState: "current", providerNeeded, contextAvailability: [],
    policy: { ...REPAIR_PLANNING_POLICY_V1 },
  };
  const definitionFingerprint = fingerprint(definition);
  const plan = new RepairPlanRepository(database).create(project.id, {
    id: `repair-plan-${randomUUID()}`, definitionFingerprint, definition, createdAt: "2026-08-12T00:00:00.000Z",
  });
  const base: RepairProposalBaseState = {
    structure: bundle.structure,
    passages: plans.currentEntities(project.id, "passage").map((item) => ({ versionId: item.id, content: item.content as typeof bundle.passages[number] })),
    choices: plans.currentEntities(project.id, "choice").map((item) => ({ versionId: item.id, content: item.content as typeof bundle.choices[number] })),
    threads: plans.currentEntities(project.id, "thread").map((item) => ({ versionId: item.id, content: item.content as typeof bundle.threads[number] })),
    bible: { versionId: bibleVersion.id, content: bible }, routes: { versionId: routesVersion.id, content: routes },
    endings: { versionId: endingsVersion.id, content: endings }, mechanics: { versionId: mechanicsVersion.id, content: mechanics },
  };
  return { database, projectId: project.id, plan, definition, definitionFingerprint, expectedBase, findingFingerprint, passage, base };
}

function candidate(input: ReturnType<typeof fixture>, generationFingerprint: string, unitId: string, contextFingerprint: string): RepairProposalUnitCandidate {
  return {
    schemaId: repairProposalCandidateSchema.id, schemaVersion: 1,
    repairPlanDefinitionFingerprint: input.definitionFingerprint, generationFingerprint, unitId, contextFingerprint, generatedIds: [],
    groups: [{ logicalKey: "repair-passage", label: "Repair passage", summary: "Exact repair", sourceFindingFingerprints: [input.findingFingerprint],
      authorizedTargetKeys: [input.expectedBase.targetKey], dependsOnGroupKeys: [], operations: [{
        logicalKey: "update-passage", groupKey: "repair-passage", kind: "update-entity", entityKind: "passage", entityId: input.passage.entityId,
        expectedBase: input.expectedBase, after: { ...input.passage.content, draftingNotes: ["Repaired."] }, sourceFindingFingerprints: [input.findingFingerprint],
      }] }],
  };
}

function manualProposal(input: ReturnType<typeof fixture>): RepairProposalRecord {
  const generationFingerprint = "b".repeat(64); const unitId = "manual-unit"; const contextFingerprint = "c".repeat(64);
  return buildRepairProposal({ projectId: input.projectId, repairPlanId: input.plan.content.id, repairPlanArtifactVersionId: input.plan.id,
    repairPlan: input.definition, generationFingerprint, mode: "manual-deterministic", providerId: null, modelId: null, jobId: null,
    candidates: [{ candidate: candidate(input, generationFingerprint, unitId, contextFingerprint), attemptId: null }], base: input.base, createdAt: "2026-08-12T00:01:00.000Z" });
}

function generatedProposal(input: ReturnType<typeof fixture>): RepairProposalRecord {
  const generationFingerprint = "d".repeat(64); const unitId = "manual-generated-unit"; const contextFingerprint = "e".repeat(64);
  const groupKey = "add-thread"; const generatedLogicalKey = "new-thread";
  const generatedId = deterministicRepairEntityId({ repairPlanDefinitionFingerprint: input.definitionFingerprint, generationFingerprint,
    unitId, groupLogicalKey: groupKey, entityKind: "thread", logicalKey: generatedLogicalKey });
  const output: RepairProposalUnitCandidate = {
    schemaId: repairProposalCandidateSchema.id, schemaVersion: 1, repairPlanDefinitionFingerprint: input.definitionFingerprint,
    generationFingerprint, unitId, contextFingerprint,
    generatedIds: [{ logicalKey: generatedLogicalKey, entityKind: "thread", authorizedParentTargetKey: input.expectedBase.targetKey, id: generatedId }],
    groups: [{ logicalKey: groupKey, label: "Add thread", summary: "Bounded child creation", sourceFindingFingerprints: [input.findingFingerprint],
      authorizedTargetKeys: [input.expectedBase.targetKey], dependsOnGroupKeys: [], operations: [
        { logicalKey: "update-parent", groupKey, kind: "update-entity", entityKind: "passage", entityId: input.passage.entityId,
          expectedBase: input.expectedBase, after: { ...input.passage.content, setupThreadIds: [...input.passage.content.setupThreadIds, generatedId] }, sourceFindingFingerprints: [input.findingFingerprint] },
        { logicalKey: "create-thread", groupKey, kind: "add-entity", entityKind: "thread", entityId: generatedId,
          authorizedParentTargetKey: input.expectedBase.targetKey, generatedLogicalKey,
          after: { id: generatedId, label: "Repair thread", description: "", setupPassageIds: [input.passage.entityId], payoffPassageIds: [],
            routeIds: [], required: false, status: "planned", waiverRationale: "" }, sourceFindingFingerprints: [input.findingFingerprint] },
      ] }],
  };
  return buildRepairProposal({ projectId: input.projectId, repairPlanId: input.plan.content.id, repairPlanArtifactVersionId: input.plan.id,
    repairPlan: input.definition, generationFingerprint, mode: "manual-deterministic", providerId: null, modelId: null, jobId: null,
    candidates: [{ candidate: output, attemptId: null }], base: input.base, createdAt: "2026-08-12T00:01:30.000Z" });
}

function generation(input: ReturnType<typeof fixture>, discriminator = "a") {
  const providerId = `offline-${discriminator}`; const modelId = `model-${discriminator}`; const policy = { ...REPAIR_PROPOSAL_POLICY_V1 };
  const baseFingerprint = fingerprint(input.base); const targetKeys = [input.expectedBase.targetKey];
  const definition = { repairPlanId: input.plan.content.id, repairPlanArtifactVersionId: input.plan.id,
    repairPlanDefinitionFingerprint: input.definitionFingerprint, providerId, modelId, policy, baseFingerprint,
    units: [{ position: 0, targetKeys }] };
  const generationFingerprint = fingerprint(definition);
  const unitId = `rpu_${fingerprint({ fingerprint: generationFingerprint, position: 0, keys: targetKeys }).slice(0, 32)}`;
  const context = { schemaVersion: 1, repairPlan: { id: input.plan.content.id, artifactVersionId: input.plan.id, definitionFingerprint: input.definitionFingerprint,
    selectedFindingFingerprints: [input.findingFingerprint], authorizedTargetKeys: targetKeys, expectedBases: [input.expectedBase] },
    unit: { id: unitId, position: 0, targetKeys, generationFingerprint }, quotedAuthoringEvidence: {}, systemRepairInstructions: {} };
  const contextFingerprint = fingerprint(context); const serializedContextBytes = Buffer.byteLength(JSON.stringify(context), "utf8");
  const aggregate: Generation = {
    schemaVersion: 1, projectId: input.projectId, baseFingerprint, base: input.base,
    generation: { id: `generation-${discriminator}`, fingerprint: generationFingerprint, definitionFingerprint: generationFingerprint, status: "planned", authorizedFingerprint: null,
      repairPlanId: input.plan.content.id, repairPlanArtifactVersionId: input.plan.id, repairPlanDefinitionFingerprint: input.definitionFingerprint,
      providerId, modelId, policy, mode: "ai-assisted", estimatedInputTokens: Math.ceil(serializedContextBytes / 4) },
    job: { id: `job-${discriminator}`, status: "planned", createdAt: "2026-08-12T00:02:00.000Z", startedAt: null, finishedAt: null,
      proposalId: null, proposalArtifactVersionId: null, error: null, units: [{ id: unitId, position: 0, targetKeys, context, contextFingerprint,
        inputFingerprint: fingerprint({ fingerprint: generationFingerprint, id: unitId, contextFingerprint }), estimatedInputTokens: Math.ceil(serializedContextBytes / 4),
        serializedContextBytes, maximumOutputTokens: policy.maxOutputTokensPerUnit, diagnostics: { included: targetKeys, omitted: [], requiredContextComplete: true },
        status: "pending", attempts: [], candidates: [] }] },
  };
  return aggregate;
}

function runToReady(repository: RepairProposalGenerationRepository, initial: Generation, input: ReturnType<typeof fixture>) {
  repository.create(initial);
  const authorized = structuredClone(initial); authorized.generation.status = "authorized"; authorized.generation.authorizedFingerprint = authorized.generation.fingerprint; authorized.job.status = "authorized"; repository.update(authorized);
  const running = structuredClone(authorized); running.job.status = "running"; running.job.startedAt = "2026-08-12T00:03:00.000Z"; repository.update(running);
  const attemptStarted = structuredClone(running); const unit = attemptStarted.job.units[0]!; unit.status = "running";
  const attempt = { id: `attempt-${initial.generation.id}`, number: 1, status: "running", startedAt: "2026-08-12T00:03:01.000Z", finishedAt: null, error: null,
    repair: { maximum: 1, performed: 0, malformedBytes: null, malformedSha256: null }, usage: null, providerMetadata: [] };
  unit.attempts.push(attempt); repository.update(attemptStarted);
  const ready = structuredClone(attemptStarted); const readyUnit = ready.job.units[0]!; const readyAttempt = readyUnit.attempts[0] as typeof attempt;
  readyAttempt.status = "completed"; readyAttempt.finishedAt = "2026-08-12T00:04:00.000Z"; readyUnit.status = "completed";
  const output = candidate(input, ready.generation.fingerprint, readyUnit.id, (readyUnit as unknown as { contextFingerprint: string }).contextFingerprint);
  readyUnit.candidates.push({ attemptId: readyAttempt.id, fingerprint: fingerprint(output), candidate: output });
  ready.job.status = "completed"; ready.job.finishedAt = "2026-08-12T00:04:00.000Z";
  const proposal = buildRepairProposal({ projectId: input.projectId, repairPlanId: input.plan.content.id, repairPlanArtifactVersionId: input.plan.id,
    repairPlan: input.definition, generationFingerprint: ready.generation.fingerprint, mode: "ai-assisted", providerId: ready.generation.providerId,
    modelId: ready.generation.modelId, jobId: ready.job.id, candidates: [{ candidate: output, attemptId: readyAttempt.id }], base: input.base,
    createdAt: "2026-08-12T00:04:01.000Z" });
  return { ready, proposal };
}

function reseal(value: RepairProposalRecord): RepairProposalRecord {
  const { id: _id, definitionFingerprint: _definitionFingerprint, createdAt, ...definition } = value;
  const definitionFingerprint = fingerprint(definition);
  return { ...definition, id: `rpp_${definitionFingerprint.slice(0, 32)}`, definitionFingerprint, createdAt } as RepairProposalRecord;
}

describe("Repair proposal persistence", () => {
  it("persists and reopens an exact pipeline-produced proposal", () => {
    const value = fixture(); const proposal = manualProposal(value); const repository = new RepairProposalRepository(value.database);
    const saved = repository.create(value.projectId, proposal);
    expect(saved.content).toEqual(proposal); expect(repository.get(value.projectId, proposal.id)?.content).toEqual(proposal);
    expect(repository.getVersion(value.projectId, saved.id)?.content).toEqual(proposal); expect(repository.list(value.projectId)[0]?.content).toEqual(proposal);
    value.database.close();
  });

  it("rejects resealed forged operation, group, base, payload, diff, identity, unlock, and validation contracts", () => {
    const value = fixture(); const valid = manualProposal(value); const repository = new RepairProposalRepository(value.database);
    const invalids: RepairProposalRecord[] = [];
    const mutate = (change: (proposal: RepairProposalRecord) => void) => { const forged = structuredClone(valid); change(forged); invalids.push(reseal(forged)); };
    mutate((item) => { item.operations[0]!.entityKind = "ending"; });
    mutate((item) => { item.operations[0]!.targetKey = "passage:wrong"; });
    mutate((item) => { item.operations[0]!.expectedBase = { ...value.expectedBase, entityKind: "choice" }; });
    mutate((item) => { (item.operations[0]!.before as Record<string, unknown>).summary = "tampered"; });
    mutate((item) => { (item.operations[0]!.after as Record<string, unknown>).forged = true; item.operations[0]!.fieldDiffs.push({ field: "forged", before: undefined, after: true }); });
    mutate((item) => { item.operations[0]!.fieldDiffs = []; });
    mutate((item) => { (item.operations[0]!.after as Record<string, unknown>).id = "forged"; item.operations[0]!.fieldDiffs.push({ field: "id", before: value.passage.entityId, after: "forged" }); });
    mutate((item) => { item.operations[0]!.requiresUnlock = true; });
    mutate((item) => { item.operations[0]!.groupId = "wrong"; });
    mutate((item) => { item.groups[0]!.authorizedTargetKeys = ["passage:outside"]; });
    mutate((item) => { item.validation.resultingEntityFingerprints[0]!.fingerprint = "0".repeat(64); });
    mutate((item) => { item.validation.warnings = ["forged"]; });
    for (const forged of invalids) expect(() => repository.create(value.projectId, forged)).toThrow();
    const generated = generatedProposal(value);
    const undeclared = structuredClone(generated); undeclared.generatedIds = [];
    const orphan = structuredClone(generated); orphan.generatedIds.push({ logicalKey: "orphan", entityKind: "thread", authorizedParentTargetKey: value.expectedBase.targetKey, id: `rpg_thread_${"0".repeat(32)}` });
    const mismatch = structuredClone(generated); mismatch.generatedIds[0]!.authorizedParentTargetKey = "passage:wrong";
    for (const forged of [undeclared, orphan, mismatch].map(reseal)) expect(() => repository.create(value.projectId, forged)).toThrow();
    expect(repository.list(value.projectId)).toEqual([]); value.database.close();
  });

  it("validates generation artifacts on get, list, and every history transition", () => {
    for (const method of ["get", "list", "history"] as const) {
      const value = fixture("ai-assisted"); const repository = new RepairProposalGenerationRepository(value.database); const initial = generation(value, method); repository.create(initial);
      const row = value.database.prepare("SELECT id, content_json FROM artifact_versions WHERE artifact_type = ?").get("repair-proposal-generation") as { id: string; content_json: string };
      const corrupted = JSON.parse(row.content_json) as Generation; (corrupted.base as unknown as Record<string, unknown>).forged = true;
      value.database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(corrupted), row.id);
      expect(() => method === "get" ? repository.get(value.projectId, initial.generation.id) : method === "list" ? repository.list(value.projectId) : repository.history(value.projectId, initial.generation.id)).toThrow();
      value.database.close();
    }
  });

  it("rejects direct-SQL corruption of context, fingerprints, definition, state, identity, and candidate lineage", () => {
    const corruptions: Array<(value: Generation) => void> = [
      (item) => { (item.job.units[0] as unknown as { context: Record<string, unknown> }).context.forged = true; },
      (item) => { (item.job.units[0] as unknown as { contextFingerprint: string }).contextFingerprint = "0".repeat(64); },
      (item) => { (item.job.units[0] as unknown as { inputFingerprint: string }).inputFingerprint = "0".repeat(64); },
      (item) => { item.generation.providerId = "forged"; },
      (item) => { item.generation.policy.maxUnits = 99; },
      (item) => { item.job.status = "completed"; },
      (item) => { item.generation.id = "forged"; },
    ];
    for (const [index, corrupt] of corruptions.entries()) {
      const value = fixture("ai-assisted"); const repository = new RepairProposalGenerationRepository(value.database); const initial = generation(value, `corrupt-${index}`); repository.create(initial);
      const row = value.database.prepare("SELECT id, content_json FROM artifact_versions WHERE artifact_type = ?").get("repair-proposal-generation") as { id: string; content_json: string };
      const content = JSON.parse(row.content_json) as Generation; corrupt(content); value.database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(content), row.id);
      expect(() => repository.get(value.projectId, initial.generation.id)).toThrow(); value.database.close();
    }
  });

  it("rejects candidate attempt/fingerprint lineage corruption and malformed middle history", () => {
    for (const kind of ["attempt", "fingerprint", "middle"] as const) {
      const value = fixture("ai-assisted"); const repository = new RepairProposalGenerationRepository(value.database); const initial = generation(value, kind);
      const { ready, proposal } = runToReady(repository, initial, value); new RepairProposalRepository(value.database).completeGeneration(ready, proposal);
      const rows = value.database.prepare("SELECT id, version, content_json FROM artifact_versions WHERE artifact_type = ? ORDER BY version").all("repair-proposal-generation") as Array<{ id: string; version: number; content_json: string }>;
      const target = kind === "middle" ? rows[1]! : rows.at(-1)!; const content = JSON.parse(target.content_json) as Generation;
      if (kind === "attempt") (content.job.units[0]!.candidates[0] as { attemptId: string }).attemptId = "wrong";
      else if (kind === "fingerprint") (content.job.units[0]!.candidates[0] as { fingerprint: string }).fingerprint = "0".repeat(64);
      else content.job.status = "running";
      value.database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(content), target.id);
      expect(() => repository.history(value.projectId, initial.generation.id)).toThrow(); value.database.close();
    }
  });

  it("atomically binds final proposal completion to the exact generation, job, units, attempts, context, and candidates", () => {
    const value = fixture("ai-assisted"); const generations = new RepairProposalGenerationRepository(value.database); const proposals = new RepairProposalRepository(value.database);
    const first = runToReady(generations, generation(value, "a"), value); const second = runToReady(generations, generation(value, "b"), value);
    expect(() => proposals.completeGeneration(first.ready, second.proposal)).toThrow("lineage");
    expect(proposals.get(value.projectId, second.proposal.id)).toBeUndefined();
    expect(generations.get<Generation>(value.projectId, first.ready.generation.id)?.content.job.status).toBe("running");
    const forgeries = [
      (item: RepairProposalRecord) => { item.provenance.jobId = "wrong"; },
      (item: RepairProposalRecord) => { item.provenance.providerId = "wrong"; },
      (item: RepairProposalRecord) => { item.provenance.modelId = "wrong"; },
      (item: RepairProposalRecord) => { item.provenance.candidates[0]!.unitId = "wrong"; },
      (item: RepairProposalRecord) => { item.provenance.candidates[0]!.attemptId = "wrong"; },
      (item: RepairProposalRecord) => { item.provenance.candidates[0]!.contextFingerprint = "0".repeat(64); },
      (item: RepairProposalRecord) => { item.provenance.candidates[0]!.candidateFingerprint = "0".repeat(64); },
      (item: RepairProposalRecord) => { item.provenance.candidates = []; },
      (item: RepairProposalRecord) => { item.provenance.candidates.push(structuredClone(item.provenance.candidates[0]!)); },
    ];
    for (const forge of forgeries) { const item = structuredClone(first.proposal); forge(item); expect(() => proposals.completeGeneration(first.ready, reseal(item))).toThrow(); }
    expect(proposals.get(value.projectId, first.proposal.id)).toBeUndefined();
    expect(generations.get<Generation>(value.projectId, first.ready.generation.id)?.content.job.status).toBe("running");
    const completed = proposals.completeGeneration(first.ready, first.proposal, { simulateFailure: false });
    expect(completed.generation.content.job.status).toBe("completed"); expect(completed.proposal.content).toEqual(first.proposal);
    value.database.close();
  });
});
