import { randomUUID } from "node:crypto";
import { ArtifactRepository, PassageDraftRepository, PassagePlanRepository, ProjectRepository, WorkflowRepository, remapStudioValue, type StoryDatabase } from "@story-to-cyoa/persistence";
import { repairApplicationDefinitionFromRecord, RepairApplicationRecordSchema, RepairPlanRecordSchema, RepairProposalRecordSchema, sourceCanonicalJson } from "@story-to-cyoa/domain";
import { compileNativeGame, narrativeReviewDigest, repairProposalFingerprint as repairDigest, selectCreativeDirectionContext, sourceInputFingerprint, type NativeCompilationInput, type ResolvedNativeCompilationInput } from "@story-to-cyoa/pipeline";
import { createNativePlayerConfig, currentNativePassage, initializeNativeGame, listNativeGameChoices, loadNativeGame, runDeterministicPath, runPlaytestCampaign, serializedBytes, stableFingerprint, type PlaytestCampaignRecord } from "@story-to-cyoa/runtime";
import { NativeCompilationService, type NativeBuildRecord } from "./native-compilation-service.js";
import { buildPlaytestAnalysisSource } from "./playtest-service.js";
import { SimulationService, type SimulationInputRecord, type SimulationRunRecord } from "./simulation-service.js";
import type { NarrativeReviewAggregate } from "./narrative-review-service.js";
import type { RepairProposalGenerationAggregate } from "./repair-proposal-service.js";

type Row = { id: string; artifact_id: string; artifact_type: string; content_json: string };

/** Rebind only a new copy, before immutable rows are inserted. Original histories are validated first. */
export function prepareStudioHistoryDuplicate(db: StoryDatabase, projectId: string, copyId: string, ids: Map<string, string>): Map<string, unknown> {
  const rows = db.prepare("SELECT id,artifact_id,artifact_type,content_json FROM artifact_versions WHERE project_id=? ORDER BY artifact_id,version").all(projectId) as Row[];
  const result = new Map<string, unknown>();
  const generatedEntityIds = new Set<string>();
  const projects = new ProjectRepository(db), artifacts = new ArtifactRepository(db), workflow = new WorkflowRepository(db), plans = new PassagePlanRepository(db), drafts = new PassageDraftRepository(db);
  const simulation = new SimulationService(projects, artifacts, workflow, plans, drafts);
  const native = new NativeCompilationService(projects, artifacts, workflow, plans, drafts);
  const mapped = <T>(value: T): T => remapStudioValue(value, ids) as T;
  const remember = (before: unknown, after: unknown): void => {
    if (!before || !after || typeof before !== "object" || typeof after !== "object") return;
    if (Array.isArray(before) && Array.isArray(after)) {
      before.forEach((item, index) => {
        const match = item && typeof item === "object" && typeof item.logicalKey === "string"
          ? after.find((candidate) => candidate?.logicalKey === item.logicalKey) : after[index];
        remember(item, match);
      }); return;
    }
    for (const [key, value] of Object.entries(before)) {
      const next = (after as Record<string, unknown>)[key];
      if (typeof value === "string" && typeof next === "string" && (key === "id" || /Fingerprint$|fingerprint$/.test(key)) && value !== next) ids.set(value, next);
      else remember(value, next);
    }
  };
  const save = (row: Row, before: unknown, after: unknown) => { remember(before, after); result.set(row.id, after); };
  const ofType = (type: string) => rows.filter((row) => row.artifact_type === type);

  for (const row of ofType("simulation-input")) {
    const original = JSON.parse(row.content_json) as SimulationInputRecord;
    const { id: _id, fingerprint: _fp, runtimeFingerprint, ...identity } = mapped(original);
    const fingerprint = stableFingerprint(identity);
    save(row, original, { ...identity, id: `simin_${fingerprint}`, fingerprint, runtimeFingerprint });
  }
  for (const row of ofType("simulation-run")) {
    const original = JSON.parse(row.content_json) as SimulationRunRecord, copy = mapped(original);
    const resolved = mapped(simulation.resolveInput(projectId, original.inputArtifactVersionId));
    const trace = runDeterministicPath(resolved.runtime, copy.inputFingerprint, copy.path);
    save(row, original, { ...copy, trace, id: `simrun_${stableFingerprint({ inputVersionId: copy.inputArtifactVersionId, traceFingerprint: trace.fingerprint })}` });
  }
  for (const row of ofType("playtest-campaign")) {
    const original = JSON.parse(row.content_json) as PlaytestCampaignRecord, copy = mapped(original);
    const resolved = mapped(simulation.resolveInput(projectId, original.simulationInputArtifactVersionId));
    const campaign = runPlaytestCampaign({ identity: { projectId: copyId, simulationInputArtifactVersionId: copy.simulationInputArtifactVersionId,
      simulationInputFingerprint: copy.simulationInputFingerprint, compiledRuntimeFingerprint: copy.compiledRuntimeFingerprint,
      snapshotId: copy.snapshotId, seed: copy.seed }, runtime: resolved.runtime, source: buildPlaytestAnalysisSource(resolved), policy: copy.policy });
    if (original.schemaVersion === 1) {
      const { findingRetention: _retention, fingerprint: _fingerprint, ...legacy } = campaign;
      const definition = { ...legacy, schemaVersion: 1 as const };
      save(row, original, { ...definition, fingerprint: stableFingerprint(definition) });
    } else save(row, original, campaign);
  }
  for (const row of ofType("narrative-review")) {
    const original = JSON.parse(row.content_json) as NarrativeReviewAggregate;
    if (!ids.has(original.plan.id)) ids.set(original.plan.id, randomUUID());
    if (!ids.has(original.job.id)) ids.set(original.job.id, randomUUID());
    for (const unit of original.job.units) for (const attempt of unit.attempts) if (!ids.has(attempt.id)) ids.set(attempt.id, randomUUID());
    const copy = mapped(original), { fingerprint: _fp, ...input } = copy.reviewInput;
    copy.reviewInput.fingerprint = narrativeReviewDigest(input);
    copy.job.units.forEach((unit) => {
      unit.id = `nru_${narrativeReviewDigest({ reviewInputFingerprint: copy.reviewInput.fingerprint, position: unit.position, passageIds: unit.passageIds }).slice(0, 24)}`;
      unit.context.identity.reviewInputFingerprint = copy.reviewInput.fingerprint;
      unit.context.identity.unitId = unit.id;
      unit.inputFingerprint = narrativeReviewDigest({ reviewInputFingerprint: copy.reviewInput.fingerprint, passageIds: unit.passageIds, categories: copy.plan.categories, policy: copy.plan.policy.id });
      unit.context.identity.inputFingerprint = unit.inputFingerprint;
      unit.contextFingerprint = narrativeReviewDigest(unit.context);
      unit.diagnostics.contextFingerprint = unit.contextFingerprint;
      unit.diagnostics.serializedBytes = Buffer.byteLength(sourceCanonicalJson(unit.context));
      unit.estimatedInputTokens = Math.max(1, Math.ceil(unit.diagnostics.serializedBytes / 4));
      unit.diagnostics.estimatedInputTokens = unit.estimatedInputTokens;
      for (const finding of unit.findings) {
        finding.unitId = unit.id;
        finding.reviewInputFingerprint = copy.reviewInput.fingerprint; finding.contextFingerprint = unit.contextFingerprint;
        const { schemaId: _schema, schemaVersion: _version, id: _finding, fingerprint: _fingerprint, ...durable } = finding;
        finding.fingerprint = narrativeReviewDigest(durable); finding.id = `nrf_${finding.fingerprint.slice(0, 24)}`;
      }
    });
    copy.plan.fingerprint = narrativeReviewDigest({ projectId: copyId, reviewInputFingerprint: copy.reviewInput.fingerprint,
      scopePassageIds: copy.plan.scopePassageIds, providerId: copy.plan.providerId, modelId: copy.plan.modelId, categories: copy.plan.categories, policy: copy.plan.policy,
      units: copy.job.units.map(({ context: _context, status: _status, attempts: _attempts, findings: _findings, ...unit }) => unit) });
    copy.plan.definitionFingerprint = copy.plan.fingerprint;
    copy.plan.estimatedInputTokens = copy.job.units.reduce((sum, unit) => sum + unit.estimatedInputTokens, 0);
    if (copy.plan.authorizedFingerprint) copy.plan.authorizedFingerprint = copy.plan.fingerprint;
    ids.set(row.artifact_id, `narrative-review:${copy.plan.id}`); save(row, original, copy);
  }
  for (const row of ofType("native-player-config")) {
    const original = JSON.parse(row.content_json);
    save(row, original, createNativePlayerConfig(mapped(original)));
  }
  const nativeInputs = new Map<string, ResolvedNativeCompilationInput>();
  for (const row of ofType("native-compilation-input")) {
    const original = JSON.parse(row.content_json) as NativeCompilationInput;
    const resolved = mapped(native.validateStoredInput(projectId, row.id).resolved);
    if (resolved.illustrations && resolved.input.illustrations) {
      resolved.input.illustrations.presentationFingerprint = stableFingerprint(resolved.illustrations.presentation);
      resolved.input.illustrations.versions = resolved.illustrations.versions.map((v) => ({ versionId: v.versionId, contentFingerprint: stableFingerprint(v.content) }));
    }
    for (const reference of resolved.input.upstreamArtifacts) reference.contentFingerprint = stableFingerprint(resolved.upstreamArtifacts.find((item) => item.versionId === reference.versionId)!.content);
    for (const selection of resolved.input.acceptedDrafts) {
      const oldSelection = original.acceptedDrafts.find((item) => item.passageId === selection.passageId)!;
      const draft = drafts.getVersion(projectId, oldSelection.versionId)!;
      selection.generationProvenanceFingerprint = draft.generationProvenance ? stableFingerprint(mapped(draft.generationProvenance)) : null;
    }
    resolved.upstreamArtifacts = resolved.upstreamArtifacts.map((item) => ({ ...item, ...resolved.input.upstreamArtifacts.find((ref) => ref.versionId === item.versionId)! }));
    resolved.acceptedDrafts = resolved.acceptedDrafts.map((item) => ({ ...item, selection: resolved.input.acceptedDrafts.find((ref) => ref.versionId === item.selection.versionId)! }));
    const { sourceInputFingerprint: _fp, ...identity } = resolved.input;
    resolved.input.sourceInputFingerprint = sourceInputFingerprint(identity); nativeInputs.set(row.id, resolved);
    save(row, original, resolved.input);
  }
  for (const row of ofType("native-build")) {
    const original = JSON.parse(row.content_json) as NativeBuildRecord;
    const resolved = nativeInputs.get(original.compilationInputArtifactVersionId)!;
    if (!resolved) throw new Error("studio_duplicate_native_input_missing");
    const bundle = compileNativeGame(resolved), game = loadNativeGame(bundle), state = initializeNativeGame(game);
    const copy: NativeBuildRecord = { ...mapped(original),
      id: `nativebuild_${stableFingerprint({ inputArtifactVersionId: ids.get(original.compilationInputArtifactVersionId)!, sourceInputFingerprint: resolved.input.sourceInputFingerprint, bundleFingerprint: bundle.bundleFingerprint })}`,
      sourceInputFingerprint: resolved.input.sourceInputFingerprint, bundleFingerprint: bundle.bundleFingerprint, runtimeFingerprint: bundle.runtimeFingerprint,
      serializedBytes: serializedBytes(bundle), validation: { valid: true, loaded: true, smokePassageId: currentNativePassage(game, state).id, availableChoiceCount: listNativeGameChoices(game, state).length } };
    save(row, original, copy);
  }
  for (const row of ofType("repair-plan")) {
    const original = RepairPlanRecordSchema.parse(JSON.parse(row.content_json));
    for (const reference of original.definition.selectedFindings) {
      if (reference.kind === "foundation-3-static-validation" || reference.kind === "foundation-5a-runtime") ids.set(reference.findingFingerprint, repairDigest(mapped(reference.finding)));
    }
    const copy = mapped(original);
    copy.definition.selectedFindings.sort((a, b) => repairDigest(a).localeCompare(repairDigest(b)));
    copy.definition.resolvedFindings.sort((a, b) => a.sourceFingerprint.localeCompare(b.sourceFingerprint));
    const graph = copy.definition.impactGraph, { fingerprint: _fp, ...core } = graph;
    graph.fingerprint = repairDigest(core); copy.definitionFingerprint = repairDigest(copy.definition);
    copy.id = `rp_${copy.definitionFingerprint.slice(0, 32)}`;
    ids.set(row.artifact_id, `repair-plan:${copy.id}`); save(row, original, copy);
  }
  for (const row of ofType("repair-proposal-generation")) {
    const original = JSON.parse(row.content_json) as RepairProposalGenerationAggregate;
    for (const id of [original.generation.id, original.job.id, ...original.job.units.flatMap((unit) => unit.attempts.map((attempt) => attempt.id))]) {
      if (!ids.has(id)) ids.set(id, randomUUID());
    }
    const copy = mapped(original), direction = copy.base.creativeDirection;
    copy.baseFingerprint = repairDigest(copy.base);
    copy.freshnessFingerprint = repairDigest({ ...copy.base, ...(direction ? { creativeDirection: {
      versionId: direction.content.materialFingerprint, content: selectCreativeDirectionContext(direction.content).context,
    } } : {}) });
    const generation = copy.generation;
    generation.fingerprint = repairDigest({ repairPlanId: generation.repairPlanId, repairPlanArtifactVersionId: generation.repairPlanArtifactVersionId,
      repairPlanDefinitionFingerprint: generation.repairPlanDefinitionFingerprint, providerId: generation.providerId, modelId: generation.modelId,
      policy: generation.policy, baseFingerprint: copy.freshnessFingerprint, units: copy.job.units.map(({ position, targetKeys }) => ({ position, targetKeys })) });
    generation.definitionFingerprint = generation.fingerprint;
    if (generation.authorizedFingerprint) generation.authorizedFingerprint = generation.fingerprint;
    copy.job.units.forEach((unit) => {
      unit.id = `rpu_${repairDigest({ fingerprint: generation.fingerprint, position: unit.position, keys: unit.targetKeys }).slice(0, 32)}`;
      unit.context.unit.id = unit.id; unit.context.unit.generationFingerprint = generation.fingerprint;
      unit.contextFingerprint = repairDigest(unit.context);
      unit.serializedContextBytes = Buffer.byteLength(JSON.stringify(unit.context));
      unit.estimatedInputTokens = Math.max(1, Math.ceil(unit.serializedContextBytes / 4));
      unit.inputFingerprint = repairDigest({ fingerprint: generation.fingerprint, id: unit.id, contextFingerprint: unit.contextFingerprint });
      for (const item of unit.candidates) {
        item.candidate.unitId = unit.id; item.candidate.contextFingerprint = unit.contextFingerprint;
        item.candidate.generationFingerprint = generation.fingerprint;
        for (const group of item.candidate.groups) for (const operation of group.operations) if (operation.kind === "add-entity") {
          const next = `rpg_${operation.entityKind}_${repairDigest({ repairPlanDefinitionFingerprint: generation.repairPlanDefinitionFingerprint,
            generationFingerprint: generation.fingerprint, unitId: unit.id, groupLogicalKey: group.logicalKey,
            entityKind: operation.entityKind, logicalKey: operation.generatedLogicalKey }).slice(0, 32)}`;
          ids.set(operation.entityId, next); ids.set(`${operation.entityKind}:${operation.entityId}`, `${operation.entityKind}:${next}`);
          generatedEntityIds.add(next);
        }
        item.candidate = mapped(item.candidate);
        item.fingerprint = repairDigest(item.candidate);
      }
    });
    generation.estimatedInputTokens = copy.job.units.reduce((sum, unit) => sum + unit.estimatedInputTokens, 0);
    ids.set(row.artifact_id, `repair-proposal-generation:${generation.id}`); save(row, original, copy);
  }
  for (const row of ofType("repair-proposal")) {
    const original = RepairProposalRecordSchema.parse(JSON.parse(row.content_json)); let copy = mapped(original);
    for (const operation of copy.operations) if (operation.kind === "add-entity") {
      const group = copy.groups.find((item) => item.id === operation.groupId)!, declaration = copy.generatedIds.find((item) => item.id === operation.entityId)!;
      // AI candidates were rebound above; manual candidates have their original unit identity.
      if (!generatedEntityIds.has(operation.entityId)) {
        const oldOperation = original.operations.find((item) => item.logicalKey === operation.logicalKey && item.kind === "add-entity")!;
        const oldGroup = original.groups.find((item) => item.id === oldOperation.groupId)!;
        const oldDeclaration = original.generatedIds.find((item) => item.id === oldOperation.entityId)!;
        const candidate = original.provenance.candidates.find((item) => oldOperation.entityId === `rpg_${operation.entityKind}_${repairDigest({
          repairPlanDefinitionFingerprint: original.repairPlanDefinitionFingerprint, generationFingerprint: original.generationFingerprint,
          unitId: item.unitId, groupLogicalKey: oldGroup.logicalKey, entityKind: operation.entityKind, logicalKey: oldDeclaration.logicalKey,
        }).slice(0, 32)}`);
        if (!candidate) throw new Error("studio_duplicate_generated_entity_lineage_invalid");
        const next = `rpg_${operation.entityKind}_${repairDigest({ repairPlanDefinitionFingerprint: copy.repairPlanDefinitionFingerprint,
          generationFingerprint: copy.generationFingerprint, unitId: ids.get(candidate.unitId) ?? candidate.unitId,
          groupLogicalKey: group.logicalKey, entityKind: operation.entityKind, logicalKey: declaration.logicalKey }).slice(0, 32)}`;
        ids.set(operation.entityId, next); ids.set(`${operation.entityKind}:${operation.entityId}`, `${operation.entityKind}:${next}`);
      }
    }
    copy = mapped(copy);
    for (const group of copy.groups) {
      const previous = group.id;
      group.id = `rpg_${repairDigest({ planFingerprint: copy.repairPlanDefinitionFingerprint, generationFingerprint: copy.generationFingerprint, logicalKey: group.logicalKey }).slice(0, 32)}`;
      ids.set(previous, group.id);
    }
    copy = mapped(copy);
    for (const operation of copy.operations) {
      const previous = operation.id;
      operation.id = `rpo_${repairDigest({ groupId: operation.groupId, logicalKey: operation.logicalKey, kind: operation.kind, entityKind: operation.entityKind, entityId: operation.entityId }).slice(0, 32)}`;
      ids.set(previous, operation.id);
    }
    copy = mapped(copy);
    copy.groups.forEach((group) => { group.operationIds.sort(); group.dependsOnGroupIds.sort(); });
    copy.groups.sort((a, b) => a.id.localeCompare(b.id)); copy.operations.sort((a, b) => a.id.localeCompare(b.id));
    copy.generatedIds.sort((a, b) => a.id.localeCompare(b.id));
    copy.validation.resultingEntityFingerprints = copy.operations.map((operation) => ({ entityKind: operation.entityKind,
      entityId: operation.entityId, fingerprint: repairDigest(operation.after) }))
      .sort((a, b) => `${a.entityKind}:${a.entityId}`.localeCompare(`${b.entityKind}:${b.entityId}`));
    const oldEvidence = copy.validation.evidenceFingerprint;
    copy.validation.evidenceFingerprint = repairDigest({ operations: copy.operations.map(({ id, entityKind, entityId, before, after }) => ({ id, entityKind, entityId, before, after })),
      effectiveStateFingerprint: copy.validation.effectiveStateFingerprint, passageValidation: copy.validation.passageValidation, planningFindings: copy.validation.planningFindings });
    ids.set(oldEvidence, copy.validation.evidenceFingerprint);
    const { id: _id, definitionFingerprint: _fp, createdAt: _created, ...definition } = copy;
    copy.definitionFingerprint = repairDigest(definition); copy.id = `rpp_${copy.definitionFingerprint.slice(0, 32)}`;
    ids.set(row.artifact_id, `repair-proposal:${copy.id}`); save(row, original, copy);
  }
  // Application rows are immutable too: remap their final definition before relational insertion.
  const applications = db.prepare("SELECT content_json FROM repair_applications WHERE project_id=?").all(projectId) as Array<{ content_json: string }>;
  for (const row of applications) {
    const original = RepairApplicationRecordSchema.parse(JSON.parse(row.content_json)), copy = mapped(original);
    copy.explicitlySelectedGroupIds.sort();
    copy.definitionFingerprint = repairDigest(repairApplicationDefinitionFromRecord(copy)); copy.id = `rap_${copy.definitionFingerprint.slice(0, 32)}`;
    remember(original, copy);
  }
  for (const row of ofType("repair-proposal-generation")) {
    const copy = result.get(row.id) as RepairProposalGenerationAggregate;
    if (copy.job.proposalId) copy.job.proposalId = ids.get(copy.job.proposalId) ?? copy.job.proposalId;
  }
  return result;
}
