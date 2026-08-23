import { afterEach, describe, expect, it } from "vitest";
import type { RepairProposalRecord } from "@story-to-cyoa/domain";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactRepository,
  NarrativeReviewRepository,
  PassageDraftRepository,
  PassagePlanRepository,
  ProjectRepository,
  RepairApplicationRepository,
  type RepairApplicationMutationResult,
  RepairPlanRepository,
  RepairProposalRepository,
  WorkflowRepository,
  openDatabase,
} from "@story-to-cyoa/persistence";
import {
  buildRepairProposal,
  deterministicRepairEntityId,
  repairProposalCandidateSchema,
  RepairProposalUnitCandidateSchema,
  repairProposalFingerprint,
  type ChoicePlan,
  type NarrativeThread,
  type PassagePlan,
  type PassageStructure,
  type RepairProposalBaseState,
} from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";
import { DeterministicRepairProposalProvider } from "../src/services/repair-proposal-provider.js";
import { RepairApplicationService, foundation3FindingPresence } from "../src/services/repair-application-service.js";
import { RepairPlanningService } from "../src/services/repair-planning-service.js";
import { SimulationService } from "../src/services/simulation-service.js";
import { PlaytestService } from "../src/services/playtest-service.js";

const apps: ReturnType<typeof buildApp>[] = [];
const temporaryDirectories: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function fixture(category: "passage-plan" | "prose" | "prose-locked" | "mixed" | "large" | "ending" | "mechanic" = "passage-plan", databasePath?: string) {
  const provider = new DeterministicRepairProposalProvider();
  const app = buildApp({ repairProposalProvider: provider, ...(databasePath ? { databasePath } : {}) }); apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Repair applications" } })).json();
  const projectId = created.project.id as string;
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
  let bibleContent: { relationships: Array<{ id: string }> } | null = null;
  let endingsContent: { endings: Array<Record<string, unknown> & { id: string; routeId: string }> } | null = null;
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}` })).json();
    let version = generated[artifactId];
    if (artifactId === "bible" && category === "mixed") {
      const content = {
        ...generated.bible.content,
        characters: [
          { id: "character-a", name: "A", role: "Lead", summary: "", motivations: [], knowledge: [], plannedArc: "" },
          { id: "character-b", name: "B", role: "Ally", summary: "", motivations: [], knowledge: [], plannedArc: "" },
        ],
        relationships: [{ id: "relationship-repair", characterIds: ["character-a", "character-b"], label: "A and B", currentState: "Uneasy allies", plannedArc: "Earn trust" }],
      };
      const savedBible = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/bible`, payload: content });
      expect(savedBible.statusCode, savedBible.body).toBe(201);
      version = savedBible.json().bible;
    }
    if (artifactId === "bible") bibleContent = version.content;
    if (artifactId === "endings") endingsContent = version.content;
    const approval = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`, payload: { versionId: version.id } });
    expect(approval.statusCode, approval.body).toBe(200);
  }
  const mechanics = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics` })).json();
  const savedMechanicsResponse = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
    ...mechanics.mechanics.content,
    choiceEffectPlans: [{ id: "effect-repair", label: "Repair effects", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: [...mechanics.mechanics.content.visibleStats, ...mechanics.mechanics.content.relationships].map((item: { key: string }) => item.key), effectGuidance: ["Exercise deterministic state."] }],
  } });
  expect(savedMechanicsResponse.statusCode, savedMechanicsResponse.body).toBe(201);
  const savedMechanics = savedMechanicsResponse.json();
  const mechanicsApproval = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`, payload: { versionId: savedMechanics.mechanics.id } });
  expect(mechanicsApproval.statusCode, mechanicsApproval.body).toBe(200);
  const passagePlanResponse = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` });
  expect(passagePlanResponse.statusCode, passagePlanResponse.body).toBe(201);
  let passagePlan = passagePlanResponse.json();
  if (category === "large") {
    const routeId = passagePlan.passages[0].content.routeIds[0] as string;
    const endingId = passagePlan.passages.find((item: { content: { endingId: string | null } }) => item.content.endingId).content.endingId as string;
    const largeSave = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan`, payload: largePassagePlan(routeId, endingId) });
    expect(largeSave.statusCode, largeSave.body).toBe(201);
    passagePlan = largeSave.json();
  }
  if (category === "mixed") {
    const passage = passagePlan.passages.find((item: { entityId: string }) => item.entityId === passagePlan.structure.content.startPassageId);
    const relationshipId = bibleContent?.relationships[0]?.id;
    if (!passage || !relationshipId) throw new Error("Mixed fixture requires a passage and relationship");
    const passageSave = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${passage.entityId}`, payload: {
      ...passage.content, relationshipIds: [...new Set([...passage.content.relationshipIds, relationshipId])],
    } });
    expect(passageSave.statusCode, passageSave.body).toBe(201);
    passagePlan = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  }
  if (category === "ending") {
    const sourceEnding = endingsContent?.endings.find((ending) => endingsContent!.endings.some((candidate) =>
      candidate.id !== ending.id && candidate.routeId === ending.routeId));
    const replacementEnding = sourceEnding && endingsContent?.endings.find((ending) =>
      ending.id !== sourceEnding.id && ending.routeId === sourceEnding.routeId);
    if (!sourceEnding || !replacementEnding) throw new Error("Ending fixture requires two generated endings on one route");
    const terminalPassages = passagePlan.passages.filter((item: { content: { endingId: string | null } }) =>
      item.content.endingId === sourceEnding.id);
    if (!terminalPassages.length) throw new Error("Ending fixture requires one generated terminal passage");
    for (const passage of terminalPassages) {
      const passageSave = await app.inject({
        method: "PUT",
        url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${passage.entityId}`,
        payload: { ...passage.content, endingId: replacementEnding.id },
      });
      expect(passageSave.statusCode, passageSave.body).toBe(201);
    }
    passagePlan = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  }
  if (category === "mechanic") {
    const mechanicSave = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...savedMechanics.mechanics.content,
      flags: [...savedMechanics.mechanics.content.flags, {
        id: "flag-repair-unused", key: "repair_unused", label: "Unused repair flag",
        meaning: "An intentionally unused flag for a bounded typed repair.",
      }],
      choiceEffectPlans: savedMechanics.mechanics.content.choiceEffectPlans.map((plan: { mechanicKeys: string[] }) => ({
        ...plan, mechanicKeys: [...plan.mechanicKeys, "repair_unused"],
      })),
    } });
    expect(mechanicSave.statusCode, mechanicSave.body).toBe(201);
    const mechanicApproval = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`, payload: { versionId: mechanicSave.json().mechanics.id } });
    expect(mechanicApproval.statusCode, mechanicApproval.body).toBe(200);
  }
  const snapshot = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id } });
  if (category === "prose" || category === "prose-locked") {
    const passageId = passagePlan.structure.content.startPassageId as string;
    const candidateResponse = await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`, payload: {
      proseMarkdown: "Accepted prose that a repair application must preserve byte-for-byte.", authorNote: "Foundation 6C protection fixture",
    } });
    expect(candidateResponse.statusCode, candidateResponse.body).toBe(201);
    const candidateId = candidateResponse.json().draft.id as string;
    const acceptancePreview = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/preview`, payload: {
      selections: [{ passageId, candidateDraftVersionId: candidateId }],
    } });
    expect(acceptancePreview.statusCode, acceptancePreview.body).toBe(200);
    const acceptance = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`, payload: {
      selections: acceptancePreview.json().selections, previewFingerprint: acceptancePreview.json().fingerprint,
    } });
    expect(acceptance.statusCode, acceptance.body).toBe(201);
    if (category === "prose-locked") {
      const acceptedId = acceptance.json().application.resultingAcceptedVersions[passageId] as string;
      const reviewed = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/transition`, payload: { versionId: acceptedId, status: "reviewed" } });
      expect(reviewed.statusCode, reviewed.body).toBe(201);
      const locked = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/transition`, payload: { versionId: reviewed.json().draft.id, status: "locked" } });
      expect(locked.statusCode, locked.body).toBe(201);
    }
  }
  const input = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/runs`, payload: { inputArtifactVersionId: input.id, choiceIds: ["invented-choice"] } });

  const root = `/api/long-form/projects/${projectId}/repair`;
  const sourceKind = category === "ending" || category === "mechanic" ? "foundation-3-static-validation" : "foundation-5a-runtime";
  const listed = (await app.inject({ method: "GET", url: `${root}/findings?sourceKind=${sourceKind}` })).json();
  const findingSummary = category === "ending" || category === "mechanic"
    ? listed.items.find((item: { entityIds: string[] }) => item.entityIds.some((id) => id.startsWith(`${category}:`)))
    : listed.items[0];
  if (!findingSummary) throw new Error(`Missing ${sourceKind} repair finding`);
  const finding = (await app.inject({ method: "POST", url: `${root}/findings/resolve`, payload: findingSummary.locator })).json();
  const intentCategory = category === "mixed" ? "relationship" : category === "large" ? "passage-plan" : category === "prose-locked" ? "prose" : category;
  const intent = { schemaVersion: 1, category: intentCategory, note: "Repair exact runtime evidence." };
  const options = (await app.inject({ method: "POST", url: `${root}/targets`, payload: { findings: [finding], intent } })).json();
  const prefixes = category === "prose" || category === "prose-locked" ? ["prose:"] : category === "mixed" ? ["passage:", "prose:", "relationship:"]
    : category === "ending" ? ["ending:"] : category === "mechanic" ? ["mechanic:"] : ["passage:"];
  const targets = prefixes.map((prefix) => options.targets.find((item: { targetKey: string }) => item.targetKey.startsWith(prefix)))
    .filter((item: unknown) => Boolean(item));
  if (targets.length !== prefixes.length) throw new Error(`Missing deterministic repair targets: ${prefixes.join(", ")}; available: ${options.targets.map((item: { targetKey: string }) => item.targetKey).join(", ")}`);
  const planResponse = await app.inject({ method: "POST", url: `${root}/plans`, payload: { findings: [finding], intent, targets: targets.map((item: { target: unknown }) => item.target) } });
  expect(planResponse.statusCode, planResponse.body).toBe(201);
  const plan = planResponse.json();
  let proposal: Record<string, unknown>;
  if (category === "passage-plan" || category === "large" || category === "ending" || category === "mechanic") {
    const saved = await app.inject({ method: "POST", url: `${root}/proposals/manual`, payload: { repairPlanId: plan.id } });
    expect(saved.statusCode, saved.body).toBe(201); proposal = saved.json();
  } else {
    const generation = (await app.inject({ method: "POST", url: `${root}/proposal-generations`, payload: { repairPlanId: plan.id } })).json();
    await app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/authorize`, payload: { fingerprint: generation.generation.fingerprint } });
    await app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    const completed = await waitForJob(app, projectId, generation.generation.id);
    proposal = (await app.inject({ method: "GET", url: `${root}/proposals/${completed.job.proposalId}` })).json();
  }
  return { app, provider, projectId, root, passagePlan, plan, proposal };
}

function largePassagePlan(routeId: string, endingId: string) {
  const passageIds = Array.from({ length: 300 }, (_, index) => `passage-${String(index).padStart(3, "0")}`);
  return {
    schemaVersion: 1,
    structure: {
      schemaVersion: 1, title: "Large repair project", projectWordTarget: 150_000, typicalPathWordTarget: 150_000,
      startPassageId: passageIds[0],
      acts: [{ id: "act-main", label: "Main act", purpose: "", summary: "", wordTarget: 150_000, routeIds: [routeId], sequenceIds: ["sequence-main"], position: 0 }],
      sequences: [{ id: "sequence-main", actId: "act-main", label: "Main sequence", purpose: "", summary: "", wordTarget: 150_000,
        routeIds: [routeId], passageIds, entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned" }],
      characterAvailability: [],
    },
    passages: passageIds.map((id, index) => ({
      id, sequenceId: "sequence-main", title: `Passage ${index}`, kind: index === 299 ? "epilogue" : "scene",
      purpose: `Plan beat ${index}`, summary: "", wordTarget: 500, routeIds: [routeId], tags: [], characterIds: [],
      relationshipIds: [], locationIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [],
      preservedDifferenceIds: [], choiceIds: index === 299 ? [] : [`choice-${String(index).padStart(3, "0")}`],
      terminal: index === 299, endingId: index === 299 ? endingId : null, draftingNotes: [], unresolvedQuestions: [],
      planningStatus: "planned", position: index,
    })),
    choices: passageIds.slice(0, -1).map((sourcePassageId, index) => ({
      id: `choice-${String(index).padStart(3, "0")}`, sourcePassageId, label: "Continue", destinationPassageId: passageIds[index + 1],
      narrativeIntent: "", consequencePreview: "", condition: null, unavailableBehavior: "disabled", unavailableExplanation: "",
      effects: [], sourceDecisionIds: [], position: 0,
    })),
    threads: [],
  };
}

function directService(databasePath: string) {
  const database = openDatabase(databasePath);
  const projects = new ProjectRepository(database);
  const artifacts = new ArtifactRepository(database);
  const workflow = new WorkflowRepository(database);
  const drafts = new PassageDraftRepository(database);
  const passagePlans = new PassagePlanRepository(
    database,
    (mutation) => drafts.handlePassagePlanMutationInTransaction(mutation),
  );
  const simulations = new SimulationService(projects, artifacts, workflow, passagePlans, drafts);
  const playtests = new PlaytestService(projects, artifacts, simulations);
  const planning = new RepairPlanningService(
    projects, artifacts, workflow, passagePlans, drafts, new NarrativeReviewRepository(database),
    new RepairPlanRepository(database), simulations, playtests,
  );
  return {
    database,
    projects,
    artifacts,
    workflow,
    drafts,
    passagePlans,
    planning,
    proposals: new RepairProposalRepository(database),
    applications: new RepairApplicationRepository(database),
    service: new RepairApplicationService(
      database, projects, artifacts, workflow, passagePlans, drafts, planning,
      new RepairProposalRepository(database), new RepairApplicationRepository(database),
    ),
  };
}

function applicationBoundaryState(value: ReturnType<typeof directService>): string {
  const tables = [
    "passage_entity_versions", "passage_entity_heads", "artifact_versions", "artifact_workflow_state",
    "artifact_dependencies", "passage_plan_state", "passage_draft_staleness_events", "repair_applications",
  ];
  return JSON.stringify(Object.fromEntries(tables.map((table) => [
    table, value.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ])));
}

function repairBase(value: ReturnType<typeof directService>, projectId: string): RepairProposalBaseState {
  const artifact = <T>(artifactId: "bible" | "routes" | "endings" | "mechanics") => {
    const versionId = value.workflow.get(projectId, artifactId).approvedVersionId;
    const version = versionId ? value.artifacts.getVersion<T>(versionId) : undefined;
    if (!version) throw new Error(`Missing approved ${artifactId} fixture artifact`);
    return { versionId: version.id, content: version.content };
  };
  const structure = value.passagePlans.currentStructure<PassageStructure>(projectId);
  if (!structure) throw new Error("Missing fixture passage structure");
  return {
    structure: structure.content,
    passages: value.passagePlans.currentEntities<PassagePlan>(projectId, "passage").map((item) => ({ versionId: item.id, content: item.content })),
    choices: value.passagePlans.currentEntities<ChoicePlan>(projectId, "choice").map((item) => ({ versionId: item.id, content: item.content })),
    threads: value.passagePlans.currentEntities<NarrativeThread>(projectId, "thread").map((item) => ({ versionId: item.id, content: item.content })),
    bible: artifact("bible"), routes: artifact("routes"), endings: artifact("endings"), mechanics: artifact("mechanics"),
  } as RepairProposalBaseState;
}

function createGeneratedProposal(
  value: Awaited<ReturnType<typeof fixture>>,
  direct: ReturnType<typeof directService>,
  entityKind: "choice" | "thread",
) {
  const plan = direct.planning.get(value.projectId, value.plan.id);
  const base = repairBase(direct, value.projectId);
  const expectedBase = plan.definition.expectedBases.find((item) => item.kind === "passage-entity-version" && item.entityKind === "passage");
  if (!expectedBase || expectedBase.kind !== "passage-entity-version" || expectedBase.entityKind !== "passage") {
    throw new Error("Generated-entity fixture requires an authorized passage base");
  }
  const passage = base.passages.find((item) => item.content.id === expectedBase.entityId);
  const destination = base.passages.find((item) => item.content.id !== expectedBase.entityId);
  if (!passage || !destination) throw new Error("Generated-entity fixture requires two passages");
  const generationFingerprint = repairProposalFingerprint({ kind: `foundation-6c-generated-${entityKind}`, plan: plan.definitionFingerprint });
  const unitId = `unit-generated-${entityKind}`;
  const groupLogicalKey = `passage-and-generated-${entityKind}`;
  const generatedLogicalKey = `new-${entityKind}`;
  const generatedId = deterministicRepairEntityId({
    repairPlanDefinitionFingerprint: plan.definitionFingerprint,
    generationFingerprint,
    unitId,
    groupLogicalKey,
    entityKind,
    logicalKey: generatedLogicalKey,
  });
  const findingFingerprints = plan.definition.resolvedFindings.map((item) => item.sourceFingerprint).sort();
  const generatedOperation = entityKind === "choice" ? {
    logicalKey: "create-choice", groupKey: groupLogicalKey, kind: "add-entity" as const,
    entityKind, entityId: generatedId, authorizedParentTargetKey: expectedBase.targetKey, generatedLogicalKey,
    after: {
      id: generatedId, sourcePassageId: passage.content.id, label: "Take the repaired path",
      destinationPassageId: destination.content.id, narrativeIntent: "Exercise the explicitly repaired branch.",
      consequencePreview: "A new route opens.", condition: null, unavailableBehavior: "disabled" as const,
      unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: passage.content.choiceIds.length,
    }, sourceFindingFingerprints: findingFingerprints,
  } : {
    logicalKey: "create-thread", groupKey: groupLogicalKey, kind: "add-entity" as const,
    entityKind, entityId: generatedId, authorizedParentTargetKey: expectedBase.targetKey, generatedLogicalKey,
    after: {
      id: generatedId, label: "Generated repair thread", description: "A bounded repair thread.",
      setupPassageIds: [passage.content.id], payoffPassageIds: [destination.content.id], routeIds: [],
      required: false, status: "planned" as const, waiverRationale: "",
    }, sourceFindingFingerprints: findingFingerprints,
  };
  const operations = entityKind === "choice" ? [{
    logicalKey: "update-passage", groupKey: groupLogicalKey, kind: "update-entity" as const,
    entityKind: "passage" as const, entityId: passage.content.id, expectedBase,
    after: { ...passage.content, choiceIds: [...passage.content.choiceIds, generatedId] },
    sourceFindingFingerprints: findingFingerprints,
  }, generatedOperation] : [generatedOperation];
  const candidate = RepairProposalUnitCandidateSchema.parse({
    schemaId: repairProposalCandidateSchema.id, schemaVersion: repairProposalCandidateSchema.version,
    repairPlanDefinitionFingerprint: plan.definitionFingerprint, generationFingerprint, unitId,
    contextFingerprint: repairProposalFingerprint({ unitId, expectedBase }),
    generatedIds: [{ logicalKey: generatedLogicalKey, entityKind, authorizedParentTargetKey: expectedBase.targetKey, id: generatedId }],
    groups: [{
      logicalKey: groupLogicalKey, label: `Repair with deterministic ${entityKind}`,
      summary: "One atomic structural repair.", sourceFindingFingerprints: findingFingerprints,
      authorizedTargetKeys: [expectedBase.targetKey], dependsOnGroupKeys: [], operations,
    }],
  });
  const proposal = buildRepairProposal({
    projectId: value.projectId, repairPlanId: plan.id, repairPlanArtifactVersionId: plan.artifactVersionId,
    repairPlan: plan.definition, generationFingerprint, mode: "manual-deterministic", providerId: null,
    modelId: null, jobId: null, candidates: [{ candidate, attemptId: null }], base,
    createdAt: new Date().toISOString(),
  });
  direct.proposals.create(value.projectId, proposal);
  return { proposal, groupIds: proposal.groups.map((group) => group.id), generatedId, passage, destination, expectedBase, base };
}

function applyThroughRepository(
  value: ReturnType<typeof directService>,
  projectId: string,
  proposalId: string,
  groupIds: string[],
  previewFingerprint: string,
  alter?: (result: RepairApplicationMutationResult) => void,
) {
  const proposalVersion = value.proposals.get<RepairProposalRecord>(projectId, proposalId);
  if (!proposalVersion) throw new Error("Missing direct persistence proposal fixture");
  const preview = value.service.preview(projectId, proposalId, groupIds);
  const privateService = value.service as unknown as PrivateRepairMutation;
  return value.applications.apply({
    projectId,
    proposalId,
    proposalArtifactVersionId: proposalVersion.id,
    proposalDefinitionFingerprint: proposalVersion.content.definitionFingerprint,
    explicitlySelectedGroupIds: groupIds,
    previewFingerprint,
    mutateInTransaction: (proposal) => {
      const result = privateService.mutate(proposal, preview);
      alter?.(result);
      return result;
    },
  });
}

interface PrivateRepairMutation {
  mutate(proposal: RepairProposalRecord, preview: ReturnType<RepairApplicationService["preview"]>): RepairApplicationMutationResult;
}

async function waitForJob(app: ReturnType<typeof buildApp>, projectId: string, generationId: string) {
  for (let count = 0; count < 200; count += 1) {
    const current = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/repair/proposal-generations/${generationId}` })).json();
    if (current.job.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Proposal generation did not finish");
}

describe("Foundation 6C repair application", () => {
  it("matches Foundation 3 dispositions against the exact passage or planning validation source", () => {
    const source = (entityType: "passage" | "mechanic" | "ending", entityId: string, code: string) => ({
      code, severity: "warning" as const, entityType, entityId, message: "Exact source finding.",
      evidence: [entityId], suggestion: "Repair it.", acknowledged: false,
    });
    const passage = source("passage", "passage-a", "passage.warning");
    const mechanic = source("mechanic", "resolve", "mechanic.warning");
    const ending = source("ending", "ending-a", "ending.warning");
    const validation = (input: { passage?: boolean; mechanic?: boolean; ending?: boolean; unrelated?: boolean }) => ({
      status: "valid" as const, errors: [], warnings: [], resultingEntityFingerprints: [],
      effectiveStateFingerprint: "a".repeat(64), evidenceFingerprint: "b".repeat(64),
      passageValidation: {
        findings: input.passage ? [passage] : [],
        budgets: { project: { target: 0, planned: 0, difference: 0 }, acts: [], sequences: [], routes: [] },
        coverage: { reachablePassageIds: [], unreachablePassageIds: [], endingCoverage: [], routeCoverage: [], pathWords: { minimum: null, maximum: null, representative: null, truncated: false }, mechanicCoverage: [] },
      },
      planningFindings: [
        ...(input.mechanic ? [{ code: mechanic.code, severity: mechanic.severity, artifactId: "mechanics" as const, entityId: mechanic.entityId, message: mechanic.message }] : []),
        ...(input.ending ? [{ code: ending.code, severity: ending.severity, artifactId: "endings" as const, entityId: ending.entityId, message: ending.message }] : []),
        ...(input.unrelated ? [{ code: mechanic.code, severity: mechanic.severity, artifactId: "mechanics" as const, entityId: "other-mechanic", message: "Same severity and code, different entity." }] : []),
      ],
    });
    expect(foundation3FindingPresence(passage, validation({ passage: true }))).toMatchObject({ remains: true, matchedSource: "passage-validation" });
    expect(foundation3FindingPresence(passage, validation({}))).toEqual({ remains: false, matchedSource: null, matchedFindingFingerprint: null });
    expect(foundation3FindingPresence(mechanic, validation({ mechanic: true }))).toMatchObject({ remains: true, matchedSource: "planning-validation" });
    expect(foundation3FindingPresence(mechanic, validation({ unrelated: true }))).toEqual({ remains: false, matchedSource: null, matchedFindingFingerprint: null });
    expect(foundation3FindingPresence(ending, validation({ ending: true }))).toMatchObject({ remains: true, matchedSource: "planning-validation" });
    expect(foundation3FindingPresence(ending, validation({}))).toEqual({ remains: false, matchedSource: null, matchedFindingFingerprint: null });
    expect(foundation3FindingPresence(mechanic, validation({ mechanic: true })).matchedFindingFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("previews without writes, applies exact groups atomically, retains audit, and rejects duplicates", async () => {
    const value = await fixture();
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const groupIds = proposal.groups.map((group) => group.id);
    const before = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).body;
    const preview = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groupIds } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ applyAllowed: true, providerCalls: 0, canonicalMutations: 0, explicitlySelectedGroupIds: groupIds });
    expect((await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).body).toBe(before);
    expect(value.provider.calls).toHaveLength(0);

    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds: groupIds, previewFingerprint: preview.json().previewFingerprint } });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(applied.json()).toMatchObject({ result: "applied", proposalId: proposal.id, explicitlySelectedGroupIds: groupIds });
    expect(applied.json().resultingVersions).toHaveLength(proposal.operations.length);
    expect(applied.json().verification.dispositions[0]).toMatchObject({
      status: "still-present",
      verificationKind: "exact-simulation-replay",
      evidence: { sourceFindingCode: "runtime.choice-missing" },
    });
    const history = (await value.app.inject({ method: "GET", url: `${value.root}/applications` })).json();
    expect(history.items.map((item: { id: string }) => item.id)).toEqual([applied.json().id]);
    expect(value.provider.calls).toHaveLength(0);

    const duplicate = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds: groupIds, previewFingerprint: preview.json().previewFingerprint } });
    expect(duplicate.statusCode).toBe(409);
  }, 20_000);

  it("rejects a stale preview after a competing passage edit with zero repair mutation", async () => {
    const value = await fixture();
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const groupIds = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groupIds } })).json();
    const operation = proposal.operations[0]!;
    const current = value.passagePlan.passages.find((item: { entityId: string }) => item.entityId === operation.entityId);
    await value.app.inject({ method: "PUT", url: `/api/long-form/projects/${value.projectId}/passage-plan/entities/passage/${operation.entityId}`, payload: { ...current.content, title: `${current.content.title} competing edit` } });
    const versionsBefore = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan/entities/passage/${operation.entityId}/versions` })).json().length;
    const stale = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds: groupIds, previewFingerprint: preview.previewFingerprint } });
    expect(stale.statusCode).toBe(409); expect(stale.json().code).toBe("stale_repair_proposal");
    const versionsAfter = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan/entities/passage/${operation.entityId}/versions` })).json().length;
    expect(versionsAfter).toBe(versionsBefore);
    expect((await value.app.inject({ method: "GET", url: `${value.root}/applications` })).json().items).toEqual([]);
  }, 20_000);

  it("rechecks exact bases inside the application transaction after an outer preflight race", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-race-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const groupIds = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groupIds } })).json();
    const passageId = proposal.operations[0]!.entityId;
    const direct = directService(databasePath);
    let failure: unknown;
    try {
      direct.service.apply(value.projectId, proposal.id, groupIds, preview.previewFingerprint, {
        beforeTransactionalPrecondition: () => {
          const competingDatabase = openDatabase(databasePath);
          const competingPlans = new PassagePlanRepository(competingDatabase);
          const current = competingPlans.currentEntity<PassagePlan>(value.projectId, "passage", passageId);
          if (!current) throw new Error("Race fixture passage is missing");
          competingPlans.saveEntity(value.projectId, "passage", passageId, { ...current.content, title: `${current.content.title} raced` });
          competingDatabase.close();
        },
      });
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "stale_repair_proposal" });
    expect(direct.passagePlans.listEntityVersions(value.projectId, "passage", passageId)).toHaveLength(2);
    expect(direct.service.list(value.projectId)).toEqual([]);
    direct.database.close();
  }, 30_000);

  it("defends exact passage bases and canonical results against direct persistence bypasses", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-persistence-boundary-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const proposal = value.proposal as RepairProposalRecord;
    const groups = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groups } })).json();
    const direct = directService(databasePath);
    const operation = proposal.operations[0]!;
    if (operation.kind !== "update-entity" || operation.expectedBase.kind !== "passage-entity-version") throw new Error("Passage bypass fixture is invalid");
    const counts = () => ({
      applications: (direct.database.prepare("SELECT COUNT(*) count FROM repair_applications").get() as { count: number }).count,
      versions: (direct.database.prepare("SELECT COUNT(*) count FROM passage_entity_versions").get() as { count: number }).count,
    });
    const before = counts();

    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, (result) => {
      result.application.resultingVersions[0]!.versionId = operation.expectedBase.versionId;
    })).toThrow(/exact new current entity version/);
    expect(counts()).toEqual(before);

    const unrelated = direct.passagePlans.currentEntities(value.projectId, "passage").find((item) => item.entityId !== operation.entityId);
    if (!unrelated) throw new Error("Passage bypass fixture needs an unrelated version");
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, (result) => {
      result.application.resultingVersions[0]!.versionId = unrelated.id;
    })).toThrow(/exact new current entity version/);
    expect(counts()).toEqual(before);

    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, () => {
      direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "passage", operation.entityId, {
        ...(operation.after as Record<string, unknown>), title: "Forged newer result",
      });
    })).toThrow(/exact new current entity version/);
    expect(counts()).toEqual(before);

    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, (result) => {
      result.application.definitionFingerprint = "f".repeat(64);
      result.application.id = `rap_${"f".repeat(32)}`;
    })).toThrow(/definition fingerprint/);
    expect(counts()).toEqual(before);

    direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "passage", operation.entityId, operation.after);
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint))
      .toThrow(/exact passage base changed/);
    expect(direct.applications.list(value.projectId)).toEqual([]);
    direct.database.close();
  }, 30_000);

  it("rejects stale artifact and prose bases at the direct persistence boundary", async () => {
    const artifactDirectory = mkdtempSync(join(tmpdir(), "cyoa-repair-artifact-base-")); temporaryDirectories.push(artifactDirectory);
    const artifactPath = join(artifactDirectory, "project.sqlite");
    const artifactValue = await fixture("mechanic", artifactPath);
    const artifactProposal = artifactValue.proposal as RepairProposalRecord;
    const artifactGroups = artifactProposal.groups.map((group) => group.id);
    const artifactPreview = (await artifactValue.app.inject({ method: "POST", url: `${artifactValue.root}/proposals/${artifactProposal.id}/application-preview`, payload: { selectedGroupIds: artifactGroups } })).json();
    const artifactDirect = directService(artifactPath);
    const artifactOperation = artifactProposal.operations[0]!;
    if (artifactOperation.kind !== "update-entity" || artifactOperation.expectedBase.kind !== "artifact-entity-version") throw new Error("Artifact bypass fixture is invalid");
    expect(() => applyThroughRepository(artifactDirect, artifactValue.projectId, artifactProposal.id, artifactGroups, artifactPreview.previewFingerprint, (result) => {
      result.application.resultingVersions[0]!.versionId = artifactOperation.expectedBase.artifactVersionId;
    })).toThrow(/exact new current artifact version/);
    expect(artifactDirect.applications.list(artifactValue.projectId)).toEqual([]);
    const mechanicHead = artifactDirect.artifacts.getCurrent(artifactValue.projectId, "mechanics")!;
    artifactDirect.artifacts.saveArtifact({ projectId: artifactValue.projectId, artifactId: "mechanics", artifactType: "mechanics", content: mechanicHead.content });
    expect(() => applyThroughRepository(artifactDirect, artifactValue.projectId, artifactProposal.id, artifactGroups, artifactPreview.previewFingerprint))
      .toThrow(/exact artifact base changed/);
    expect(artifactDirect.applications.list(artifactValue.projectId)).toEqual([]);
    artifactDirect.database.close();

    const proseDirectory = mkdtempSync(join(tmpdir(), "cyoa-repair-prose-base-")); temporaryDirectories.push(proseDirectory);
    const prosePath = join(proseDirectory, "project.sqlite");
    const proseValue = await fixture("prose", prosePath);
    const proseProposal = proseValue.proposal as RepairProposalRecord;
    const proseGroups = proseProposal.groups.map((group) => group.id);
    const prosePreview = (await proseValue.app.inject({ method: "POST", url: `${proseValue.root}/proposals/${proseProposal.id}/application-preview`, payload: { selectedGroupIds: proseGroups } })).json();
    const proseDirect = directService(prosePath);
    const proseOperation = proseProposal.operations.find((item) => item.kind === "create-passage-draft-candidate");
    if (!proseOperation || proseOperation.expectedBase.kind !== "passage-prose-head") throw new Error("Prose bypass fixture is invalid");
    proseDirect.drafts.createVersion({
      projectId: proseValue.projectId, passageId: proseOperation.entityId,
      basedOnPassagePlanVersionId: proseOperation.expectedBase.passagePlanVersionId,
      proseMarkdown: "A competing candidate.", sourceKind: "manual",
      upstreamVersions: proseOperation.expectedBase.upstreamVersions,
      neighboringDraftVersions: proseOperation.expectedBase.neighboringDraftVersions,
    });
    expect(() => applyThroughRepository(proseDirect, proseValue.projectId, proseProposal.id, proseGroups, prosePreview.previewFingerprint))
      .toThrow(/exact prose head changed/);
    expect(proseDirect.applications.list(proseValue.projectId)).toEqual([]);
    proseDirect.database.close();
  }, 40_000);

  it("rejects every canonical mutation outside the selected operation footprint", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-footprint-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const direct = directService(databasePath);
    const proposal = value.proposal as RepairProposalRecord;
    const groups = proposal.groups.map((group) => group.id);
    const preview = direct.service.preview(value.projectId, proposal.id, groups);
    const selected = proposal.operations[0]!;
    const unrelatedPassage = direct.passagePlans.currentEntities<PassagePlan>(value.projectId, "passage")
      .find((item) => item.entityId !== selected.entityId)!;
    const unrelatedChoice = direct.passagePlans.currentEntities<ChoicePlan>(value.projectId, "choice")[0]!;
    const counts = () => ({
      entities: (direct.database.prepare("SELECT COUNT(*) count FROM passage_entity_versions WHERE project_id = ?").get(value.projectId) as { count: number }).count,
      artifacts: (direct.database.prepare("SELECT COUNT(*) count FROM artifact_versions WHERE project_id = ?").get(value.projectId) as { count: number }).count,
      drafts: (direct.database.prepare("SELECT COUNT(*) count FROM passage_draft_versions WHERE project_id = ?").get(value.projectId) as { count: number }).count,
      stale: (direct.database.prepare("SELECT COUNT(*) count FROM passage_draft_staleness_events WHERE project_id = ?").get(value.projectId) as { count: number }).count,
      applications: direct.applications.list(value.projectId).length,
    });
    const before = counts();
    const attacks: Array<() => unknown> = [
      () => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, () => {
        direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "passage", unrelatedPassage.entityId, {
          ...unrelatedPassage.content, title: "Unauthorized passage Z mutation",
        });
      }),
      () => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, () => {
        direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "choice", unrelatedChoice.entityId, {
          ...unrelatedChoice.content, label: "Unauthorized choice mutation",
        });
      }),
      () => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, () => {
        const mechanics = direct.artifacts.getCurrent(value.projectId, "mechanics")!;
        direct.artifacts.saveArtifactInTransaction({
          projectId: value.projectId, artifactId: "mechanics", artifactType: "mechanics", content: mechanics.content,
        });
      }),
    ];
    for (const attack of attacks) {
      expect(attack).toThrow(/unauthorized canonical mutation/);
      expect(counts()).toEqual(before);
    }
    const applied = direct.service.apply(value.projectId, proposal.id, groups, preview.previewFingerprint);
    expect(applied.result).toBe("applied");
    expect(direct.applications.list(value.projectId)).toHaveLength(1);
    direct.database.close();
  }, 40_000);

  it("rejects every unrelated secondary-state mutation and rolls the selected repair back", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-secondary-footprint-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const direct = directService(databasePath);
    const proposal = value.proposal as RepairProposalRecord;
    const groups = proposal.groups.map((group) => group.id);
    const target = proposal.operations.find((operation) => operation.entityKind === "passage")!;
    const passage = direct.passagePlans.currentEntity<PassagePlan>(value.projectId, "passage", target.entityId)!;
    const upstreamVersions = Object.fromEntries(["bible", "routes", "endings", "mechanics"].map((artifactId) => [
      artifactId, direct.workflow.get(value.projectId, artifactId).approvedVersionId!,
    ]));
    const draft = direct.drafts.createVersion({
      projectId: value.projectId, passageId: passage.entityId, basedOnPassagePlanVersionId: passage.id,
      proseMarkdown: "A draft used to verify deterministic repair staleness.", sourceKind: "manual",
      upstreamVersions, neighboringDraftVersions: {},
    });
    direct.drafts.insertStalenessInTransaction({
      projectId: value.projectId, passageId: passage.entityId, draftVersionId: draft.id,
      reasonCode: "fixture-historical-stale", sourceEntityKind: "fixture", sourceEntityId: "historical",
      fromVersionId: passage.id, toVersionId: passage.id, changedFields: ["fixture"],
    });
    const historicalEvent = (direct.database.prepare(`SELECT id FROM passage_draft_staleness_events
      WHERE project_id = ? AND reason_code = 'fixture-historical-stale'`).get(value.projectId) as { id: string }).id;
    const brief = direct.artifacts.getCurrent(value.projectId, "brief")!;
    const routes = direct.artifacts.getCurrent(value.projectId, "routes")!;
    const dependency = direct.database.prepare(`SELECT upstream_artifact_id, dependent_artifact_id
      FROM artifact_dependencies WHERE project_id = ? ORDER BY upstream_artifact_id, dependent_artifact_id LIMIT 1`)
      .get(value.projectId) as { upstream_artifact_id: string; dependent_artifact_id: string };
    const preview = direct.service.preview(value.projectId, proposal.id, groups);
    const before = applicationBoundaryState(direct);
    const attacks: Array<() => void> = [
      () => { direct.workflow.markDraft(value.projectId, "brief"); },
      () => { direct.workflow.markStale(value.projectId, "brief"); },
      () => { direct.database.prepare(`UPDATE artifact_workflow_state SET status = 'approved', approved_version_id = ?
        WHERE project_id = ? AND artifact_id = 'bible'`).run(routes.id, value.projectId); },
      () => { direct.database.prepare(`UPDATE passage_plan_state SET status = 'empty', approved_snapshot_id = NULL
        WHERE project_id = ?`).run(value.projectId); },
      () => { direct.database.prepare("UPDATE artifact_versions SET stale = CASE stale WHEN 0 THEN 1 ELSE 0 END WHERE id = ?")
        .run(brief.id); },
      () => { direct.database.prepare(`INSERT INTO artifact_dependencies
        (project_id, upstream_artifact_id, dependent_artifact_id) VALUES (?, 'unauthorized-upstream', 'unauthorized-dependent')`)
        .run(value.projectId); },
      () => { direct.database.prepare(`DELETE FROM artifact_dependencies WHERE project_id = ?
        AND upstream_artifact_id = ? AND dependent_artifact_id = ?`)
        .run(value.projectId, dependency.upstream_artifact_id, dependency.dependent_artifact_id); },
      () => { direct.drafts.insertStalenessInTransaction({
        projectId: value.projectId, passageId: passage.entityId, draftVersionId: draft.id,
        reasonCode: "unauthorized-extra-stale", sourceEntityKind: "passage", sourceEntityId: "unselected-passage",
        fromVersionId: passage.id, toVersionId: passage.id, changedFields: ["unauthorized"],
      }); },
      () => { direct.database.prepare("UPDATE passage_draft_staleness_events SET reason_code = 'rewritten' WHERE id = ?")
        .run(historicalEvent); },
      () => { direct.database.prepare("DELETE FROM passage_draft_staleness_events WHERE id = ?").run(historicalEvent); },
    ];
    for (const attack of attacks) {
      expect(() => applyThroughRepository(
        direct, value.projectId, proposal.id, groups, preview.previewFingerprint, attack,
      )).toThrow(/unauthorized canonical mutation|staleness audit|immutable|append-only/);
      expect(applicationBoundaryState(direct)).toBe(before);
      expect(direct.applications.list(value.projectId)).toEqual([]);
    }

    const existingIds = new Set((direct.database.prepare("SELECT id FROM passage_draft_staleness_events").all() as Array<{ id: string }>)
      .map((row) => row.id));
    const applied = direct.service.apply(value.projectId, proposal.id, groups, preview.previewFingerprint);
    const persisted = (direct.database.prepare(`SELECT id, reason_code reasonCode, source_entity_kind sourceEntityKind,
      source_entity_id sourceEntityId, draft_version_id draftVersionId, passage_id passageId
      FROM passage_draft_staleness_events ORDER BY id`).all() as Array<Record<string, unknown>>)
      .filter((row) => !existingIds.has(String(row.id)));
    expect(applied.stalenessEvents.map((event) => ({ ...event })).sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual(persisted.sort((left, right) => String(left.id).localeCompare(String(right.id))));
    expect(applied.stalenessEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ draftVersionId: draft.id, sourceEntityKind: "passage", sourceEntityId: passage.entityId }),
    ]));
    direct.database.close();
  }, 50_000);

  it("rejects equivalent cross-project workflow, plan, stale, dependency, and draft-staleness writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-secondary-cross-project-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const direct = directService(databasePath);
    const proposal = value.proposal as RepairProposalRecord;
    const groups = proposal.groups.map((group) => group.id);
    const preview = direct.service.preview(value.projectId, proposal.id, groups);
    const other = direct.projects.create("Unrelated project", "unrelated-project", "long-form");
    const artifact = direct.artifacts.saveArtifact({
      projectId: other.id, artifactId: "brief", artifactType: "brief", content: { id: "other-brief" },
    });
    direct.workflow.markDraft(other.id, "brief");
    direct.passagePlans.initialize(other.id, { startPassageId: "other-passage" }, [{
      kind: "passage", id: "other-passage", content: { id: "other-passage" },
    }]);
    const passage = direct.passagePlans.currentEntity(other.id, "passage", "other-passage")!;
    const draft = direct.drafts.createVersion({
      projectId: other.id, passageId: "other-passage", basedOnPassagePlanVersionId: passage.id,
      proseMarkdown: "Unrelated project prose.", sourceKind: "manual",
      upstreamVersions: { brief: artifact.id }, neighboringDraftVersions: {},
    });
    const before = applicationBoundaryState(direct);
    const attacks: Array<() => void> = [
      () => { direct.workflow.markStale(other.id, "brief"); },
      () => { direct.passagePlans.markStale(other.id); },
      () => { direct.database.prepare("UPDATE artifact_versions SET stale = 1 WHERE id = ?").run(artifact.id); },
      () => { direct.database.prepare(`INSERT INTO artifact_dependencies
        (project_id, upstream_artifact_id, dependent_artifact_id) VALUES (?, 'other-upstream', 'other-dependent')`).run(other.id); },
      () => { direct.drafts.insertStalenessInTransaction({
        projectId: other.id, passageId: "other-passage", draftVersionId: draft.id,
        reasonCode: "cross-project-stale", sourceEntityKind: "passage", sourceEntityId: "other-passage",
        fromVersionId: passage.id, toVersionId: passage.id, changedFields: ["cross-project"],
      }); },
    ];
    for (const attack of attacks) {
      expect(() => applyThroughRepository(
        direct, value.projectId, proposal.id, groups, preview.previewFingerprint, attack,
      )).toThrow(/unauthorized canonical mutation/);
      expect(applicationBoundaryState(direct)).toBe(before);
      expect(direct.applications.list(value.projectId)).toEqual([]);
    }
    direct.database.close();
  }, 50_000);

  it("rejects extra draft and passage writes around an otherwise valid prose repair", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-prose-footprint-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("prose", databasePath);
    const direct = directService(databasePath);
    const proposal = value.proposal as RepairProposalRecord;
    const groups = proposal.groups.map((group) => group.id);
    const preview = direct.service.preview(value.projectId, proposal.id, groups);
    const selectedPassageId = proposal.operations.find((item) => item.kind === "create-passage-draft-candidate")!.entityId;
    const unrelated = direct.passagePlans.currentEntities<PassagePlan>(value.projectId, "passage")
      .find((item) => item.entityId !== selectedPassageId)!;
    const upstreamVersions = Object.fromEntries(["bible", "routes", "endings", "mechanics"].map((artifactId) => [
      artifactId, direct.artifacts.getCurrent(value.projectId, artifactId)!.id,
    ]));
    const counts = () => ({
      entities: (direct.database.prepare("SELECT COUNT(*) count FROM passage_entity_versions WHERE project_id = ?").get(value.projectId) as { count: number }).count,
      drafts: (direct.database.prepare("SELECT COUNT(*) count FROM passage_draft_versions WHERE project_id = ?").get(value.projectId) as { count: number }).count,
      applications: direct.applications.list(value.projectId).length,
    });
    const before = counts();
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, () => {
      direct.drafts.createVersionInTransaction({
        projectId: value.projectId, passageId: unrelated.entityId, basedOnPassagePlanVersionId: unrelated.id,
        proseMarkdown: "Unauthorized extra draft.", sourceKind: "manual", upstreamVersions, neighboringDraftVersions: {},
      });
    })).toThrow(/unauthorized canonical mutation/);
    expect(counts()).toEqual(before);
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, () => {
      direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "passage", unrelated.entityId, {
        ...unrelated.content, title: "Unauthorized prose-side passage mutation",
      });
    })).toThrow(/unauthorized canonical mutation/);
    expect(counts()).toEqual(before);
    const applied = direct.service.apply(value.projectId, proposal.id, groups, preview.previewFingerprint);
    expect(applied.resultingVersions).toEqual([expect.objectContaining({ entityKind: "passage-prose" })]);
    direct.database.close();
  }, 40_000);

  it("creates a normal candidate with durable repair lineage and leaves accepted prose unchanged", async () => {
    const value = await fixture("prose");
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const groupIds = proposal.groups.map((group) => group.id);
    const passageId = proposal.operations[0]!.entityId;
    const before = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/drafts/passages/${passageId}` })).json();
    expect(before.head).toMatchObject({ accepted: { lifecycleStatus: "accepted", proseMarkdown: "Accepted prose that a repair application must preserve byte-for-byte." }, acceptedLocked: false });
    const providerCallsBeforeApplication = value.provider.calls.length;
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groupIds } })).json();
    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds: groupIds, previewFingerprint: preview.previewFingerprint } });
    expect(applied.statusCode, applied.body).toBe(201);
    const result = applied.json().resultingVersions[0];
    const after = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/drafts/passages/${passageId}` })).json();
    expect(after.head.current).toMatchObject({ id: result.versionId, lifecycleStatus: "candidate", sourceKind: "manual" });
    expect(after.head.accepted).toEqual(before.head.accepted);
    expect(after.head.acceptedLocked).toBe(false);
    expect(value.provider.calls.length).toBe(providerCallsBeforeApplication);
  }, 20_000);

  it("creates a repair candidate without unlocking, accepting, or changing locked prose", async () => {
    const value = await fixture("prose-locked");
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const selectedGroupIds = proposal.groups.map((group) => group.id);
    const passageId = proposal.operations[0]!.entityId;
    const before = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/drafts/passages/${passageId}` })).json();
    expect(before.head).toMatchObject({ accepted: { lifecycleStatus: "locked", proseMarkdown: "Accepted prose that a repair application must preserve byte-for-byte." }, acceptedLocked: true });
    const providerCallsBeforeApplication = value.provider.calls.length;
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds } })).json();
    expect(preview.applyAllowed).toBe(true);
    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds, previewFingerprint: preview.previewFingerprint } });
    expect(applied.statusCode, applied.body).toBe(201);
    const after = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/drafts/passages/${passageId}` })).json();
    expect(after.head.current).toMatchObject({ lifecycleStatus: "candidate", sourceKind: "manual" });
    expect(after.head.accepted).toEqual(before.head.accepted);
    expect(after.head.acceptedLocked).toBe(true);
    expect(value.provider.calls.length).toBe(providerCallsBeforeApplication);
  }, 20_000);

  it("rejects forged repair-draft provenance completely and atomically", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-provenance-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("prose", databasePath);
    const proposal = value.proposal as RepairProposalRecord;
    const groups = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groups } })).json();
    const direct = directService(databasePath);
    const counts = () => ({
      applications: direct.applications.list(value.projectId).length,
      drafts: (direct.database.prepare("SELECT COUNT(*) count FROM passage_draft_versions").get() as { count: number }).count,
      links: (direct.database.prepare("SELECT COUNT(*) count FROM repair_application_draft_links").get() as { count: number }).count,
    });
    const before = counts();
    const forged: Array<(result: RepairApplicationMutationResult) => void> = [
      (result) => { result.draftLinks[0]!.provenance.proposalDefinitionFingerprint = "f".repeat(64); },
      (result) => { result.draftLinks[0]!.provenance.repairPlanId = "forged-plan"; },
      (result) => { result.draftLinks[0]!.provenance.sourceFindingFingerprints = ["f".repeat(64)]; },
      (result) => { result.draftLinks[0]!.provenance.passagePlanBaseVersionId = "forged-passage-version"; },
      (result) => { result.draftLinks[0]!.provenance.expectedCurrentDraftVersionId = "forged-current"; },
      (result) => { result.draftLinks[0]!.provenance.expectedAcceptedDraftVersionId = "forged-accepted"; },
      (result) => { result.draftLinks[0]!.provenance.upstreamVersions = { ...result.draftLinks[0]!.provenance.upstreamVersions, bible: "forged-upstream" }; },
      (result) => { result.draftLinks[0]!.provenance.neighboringDraftVersions = { "forged-neighbor": "forged-version" }; },
      (result) => {
        result.draftLinks[0]!.passageId = "wrong-passage";
        result.draftLinks[0]!.provenance.passageId = "wrong-passage";
      },
    ];
    for (const alter of forged) {
      expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groups, preview.previewFingerprint, alter))
        .toThrow(/provenance|draft candidate/);
      expect(counts()).toEqual(before);
    }
    const applied = direct.service.apply(value.projectId, proposal.id, groups, preview.previewFingerprint);
    const proseResult = applied.resultingVersions.find((item) => item.entityKind === "passage-prose")!;
    direct.database.exec("DROP TRIGGER repair_application_draft_links_immutable_update");
    direct.database.prepare("UPDATE repair_application_draft_links SET provenance_json = json_remove(provenance_json, '$.passageId') WHERE draft_version_id = ?")
      .run(proseResult.versionId);
    expect(direct.applications.getDraftProvenance(value.projectId, proseResult.versionId)?.passageId).toBe(proseResult.entityId);
    direct.database.close();
  }, 30_000);

  it("rejects duplicate, unknown, and tampered selections before canonical writes", async () => {
    const value = await fixture();
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }> };
    for (const selectedGroupIds of [[proposal.groups[0]!.id, proposal.groups[0]!.id], ["unknown-group"]]) {
      const response = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds } });
      expect(response.statusCode).toBe(400);
    }
    const malformed = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: {
      selectedGroupIds: proposal.groups.map((group) => group.id), previewFingerprint: "0".repeat(64), operations: [{ arbitrary: true }],
    } });
    expect(malformed.statusCode).toBe(409);
    expect((await value.app.inject({ method: "GET", url: `${value.root}/applications` })).json().items).toEqual([]);
  }, 20_000);

  it("rolls back a mixed structure, artifact, prose, staleness, and audit transaction, then commits it coherently", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-application-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("mixed", databasePath);
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityKind: string }> };
    expect(proposal.operations.map((operation) => operation.entityKind).sort()).toEqual(["passage", "passage-prose", "relationship"]);
    const groupIds = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: groupIds } })).json();
    expect(preview.applyAllowed).toBe(true);

    const direct = directService(databasePath);
    const counts = () => Object.fromEntries(["passage_entity_versions", "artifact_versions", "passage_draft_versions", "passage_draft_staleness_events", "repair_applications", "repair_application_result_versions", "repair_application_draft_links"]
      .map((table) => [table, (direct.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count]));
    const before = counts();
    expect(() => direct.service.apply(value.projectId, proposal.id, groupIds, preview.previewFingerprint, { simulateFailure: true }))
      .toThrow(/Simulated repair application failure/);
    expect(counts()).toEqual(before);

    const applied = direct.service.apply(value.projectId, proposal.id, groupIds, preview.previewFingerprint);
    expect(applied.resultingVersions.map((item) => item.entityKind).sort()).toEqual(["passage", "passage-prose", "relationship"]);
    expect((direct.database.prepare("SELECT COUNT(*) AS count FROM repair_application_result_versions WHERE application_id = ?")
      .get(applied.id) as { count: number }).count).toBe(3);
    expect((direct.database.prepare("SELECT lifecycle_status FROM passage_draft_versions WHERE id = ?")
      .get(applied.resultingVersions.find((item) => item.entityKind === "passage-prose")!.versionId) as { lifecycle_status: string }).lifecycle_status)
      .toBe("candidate");
    expect(direct.workflow.get(value.projectId, "bible").status).toBe("draft");
    for (const artifactId of ["routes", "endings", "mechanics"]) {
      expect(direct.workflow.get(value.projectId, artifactId).status).toBe("stale");
      expect(direct.artifacts.getCurrent(value.projectId, artifactId)?.stale).toBe(true);
    }
    expect(direct.passagePlans.state(value.projectId).status).toBe("stale");
    const persistedStaleness = direct.database.prepare(`SELECT id, reason_code reasonCode,
      source_entity_kind sourceEntityKind, source_entity_id sourceEntityId,
      draft_version_id draftVersionId, passage_id passageId
      FROM passage_draft_staleness_events WHERE project_id = ? ORDER BY id`).all(value.projectId);
    expect(applied.stalenessEvents.map((event) => ({ ...event })).sort((left, right) => left.id.localeCompare(right.id)))
      .toEqual((persistedStaleness as Array<Record<string, unknown>>)
        .sort((left, right) => String(left.id).localeCompare(String(right.id))));
    expect(() => direct.database.prepare(`INSERT INTO repair_application_result_versions
      (project_id, application_id, operation_id, entity_kind, entity_id, version_id) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(value.projectId, applied.id, "forged-operation", "passage", "forged-passage", applied.resultingVersions[0]!.versionId))
      .toThrow(/result version lineage mismatch/);
    direct.database.close();
  }, 30_000);

  it("applies only one selected independent group and leaves the other proposal targets untouched", async () => {
    const value = await fixture("mixed");
    const proposal = value.proposal as {
      id: string;
      groups: Array<{ id: string; authorizedTargetKeys: string[] }>;
    };
    const selected = proposal.groups.find((group) => group.authorizedTargetKeys.some((key) => key.startsWith("relationship:")));
    if (!selected) throw new Error("Mixed fixture requires an independent relationship group");
    const passageBefore = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).json();
    const passageEntities = (plan: { passages: unknown[]; choices: unknown[]; threads: unknown[] }) => ({
      passages: plan.passages, choices: plan.choices, threads: plan.threads,
    });
    const queueBefore = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/drafts/review-queue` })).json();
    const bibleVersionsBefore = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/bible/versions` })).json();
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds: [selected.id] } })).json();
    expect(preview).toMatchObject({
      applyAllowed: true,
      explicitlySelectedGroupIds: [selected.id],
      requiredDependencyGroupIds: [],
      effectiveGroupIds: [selected.id],
    });
    expect(preview.operations).toEqual([expect.objectContaining({ entityKind: "relationship" })]);
    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: {
      selectedGroupIds: [selected.id], previewFingerprint: preview.previewFingerprint,
    } });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(applied.json().resultingVersions).toEqual([expect.objectContaining({ entityKind: "relationship" })]);
    const passageAfter = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).json();
    expect(passageEntities(passageAfter)).toEqual(passageEntities(passageBefore));
    const queueAfter = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/drafts/review-queue` })).json();
    expect(queueAfter.items).toEqual(queueBefore.items);
    const bibleVersionsAfter = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/bible/versions` })).json();
    expect(bibleVersionsAfter).toHaveLength(bibleVersionsBefore.length + 1);
  }, 30_000);

  it("applies a passage update and its deterministic new choice atomically with exact history", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-generated-choice-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const direct = directService(databasePath);
    const { proposal, groupIds, generatedId: choiceId, passage, destination, expectedBase, base } = createGeneratedProposal(value, direct, "choice");
    const preview = direct.service.preview(value.projectId, proposal.id, groupIds);
    expect(preview).toMatchObject({ applyAllowed: true, generatedEntityIds: [{ entityKind: "choice", entityId: choiceId }] });
    const generatedChoiceOperation = proposal.operations.find((item) => item.kind === "add-entity" && item.entityKind === "choice")!;
    direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "choice", choiceId, generatedChoiceOperation.after);
    expect(direct.service.preview(value.projectId, proposal.id, groupIds)).toMatchObject({
      applyAllowed: false, errors: expect.arrayContaining([expect.stringMatching(/collides with canonical content/)]),
    });
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groupIds, preview.previewFingerprint))
      .toThrow(/collides with an existing stable ID/);
    direct.database.prepare("DELETE FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'choice' AND entity_id = ?")
      .run(value.projectId, choiceId);
    direct.database.prepare("DELETE FROM passage_entity_versions WHERE project_id = ? AND entity_kind = 'choice' AND entity_id = ?")
      .run(value.projectId, choiceId);

    direct.passagePlans.insertEntityVersionInTransaction<NarrativeThread>(value.projectId, "thread", choiceId, {
      id: choiceId, label: "Cross-kind collision", description: "", setupPassageIds: [], payoffPassageIds: [],
      routeIds: [], required: false, status: "planned", waiverRationale: "",
    });
    expect(direct.service.preview(value.projectId, proposal.id, groupIds)).toMatchObject({
      applyAllowed: false, errors: expect.arrayContaining([expect.stringMatching(/collides with canonical content/)]),
    });
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groupIds, preview.previewFingerprint))
      .toThrow(/collides with an existing stable ID/);
    direct.database.prepare("DELETE FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'thread' AND entity_id = ?")
      .run(value.projectId, choiceId);
    direct.database.prepare("DELETE FROM passage_entity_versions WHERE project_id = ? AND entity_kind = 'thread' AND entity_id = ?")
      .run(value.projectId, choiceId);

    const mechanics = direct.artifacts.getCurrent<Record<string, unknown>>(value.projectId, "mechanics")!;
    const originalMechanics = JSON.stringify(mechanics.content);
    direct.database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify({
      ...mechanics.content,
      unresolvedQuestions: [
        ...((mechanics.content.unresolvedQuestions as unknown[]) ?? []),
        { id: choiceId, question: "Collision introduced after proposal creation.", answer: "" },
      ],
    }), mechanics.id);
    expect(direct.service.preview(value.projectId, proposal.id, groupIds)).toMatchObject({
      applyAllowed: false, errors: expect.arrayContaining([expect.stringMatching(/collides with canonical content/)]),
    });
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groupIds, preview.previewFingerprint))
      .toThrow(/collides with an existing stable ID/);
    direct.database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(originalMechanics, mechanics.id);

    const unrelatedForProse = base.passages.find((item) => item.content.id !== passage.content.id)!;
    direct.drafts.createVersion({
      projectId: value.projectId, passageId: unrelatedForProse.content.id,
      basedOnPassagePlanVersionId: unrelatedForProse.versionId,
      proseMarkdown: `This ordinary prose mentions ${choiceId} without declaring an ID.`, sourceKind: "manual",
      upstreamVersions: {
        bible: base.bible.versionId, routes: base.routes.versionId,
        endings: base.endings.versionId, mechanics: base.mechanics.versionId,
      }, neighboringDraftVersions: {},
    });
    expect(direct.service.preview(value.projectId, proposal.id, groupIds).applyAllowed).toBe(true);
    const unrelatedVersions = new Map(base.passages.filter((item) => item.content.id !== passage.content.id)
      .map((item) => [item.content.id, item.versionId]));
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groupIds, preview.previewFingerprint, () => {
      direct.database.prepare("DELETE FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'choice' AND entity_id = ?")
        .run(value.projectId, choiceId);
      direct.database.prepare("DELETE FROM passage_entity_versions WHERE project_id = ? AND entity_kind = 'choice' AND entity_id = ?")
        .run(value.projectId, choiceId);
    })).toThrow(/exact new current entity version/);
    expect(direct.passagePlans.currentEntity(value.projectId, "choice", choiceId)).toBeUndefined();
    expect(direct.applications.list(value.projectId)).toEqual([]);
    const applied = direct.service.apply(value.projectId, proposal.id, groupIds, preview.previewFingerprint);
    expect(applied.resultingVersions.map((item) => `${item.entityKind}:${item.entityId}`).sort()).toEqual([
      `choice:${choiceId}`, `passage:${passage.content.id}`,
    ]);
    const repairedPassage = direct.passagePlans.currentEntity<PassagePlan>(value.projectId, "passage", passage.content.id);
    const generatedChoice = direct.passagePlans.currentEntity<ChoicePlan>(value.projectId, "choice", choiceId);
    expect(repairedPassage?.content.choiceIds).toContain(choiceId);
    expect(generatedChoice?.content).toMatchObject({ id: choiceId, sourcePassageId: passage.content.id, destinationPassageId: destination.content.id });
    for (const [passageId, versionId] of unrelatedVersions) {
      expect(direct.passagePlans.currentEntity(value.projectId, "passage", passageId)?.id).toBe(versionId);
    }
    expect(direct.passagePlans.listEntityVersions(value.projectId, "passage", passage.content.id).map((item) => item.id)).toContain(expectedBase.versionId);
    direct.database.close();
  }, 30_000);

  it("rejects a generated thread ID that collides with a newer cross-kind stable ID", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-generated-thread-")); temporaryDirectories.push(directory);
    const databasePath = join(directory, "project.sqlite");
    const value = await fixture("passage-plan", databasePath);
    const direct = directService(databasePath);
    const { proposal, groupIds, generatedId: threadId } = createGeneratedProposal(value, direct, "thread");
    const preview = direct.service.preview(value.projectId, proposal.id, groupIds);
    expect(preview.applyAllowed).toBe(true);
    const sourceChoice = direct.passagePlans.currentEntities<ChoicePlan>(value.projectId, "choice")[0]!;
    direct.passagePlans.insertEntityVersionInTransaction(value.projectId, "choice", threadId, {
      ...sourceChoice.content, id: threadId,
    });
    expect(direct.service.preview(value.projectId, proposal.id, groupIds)).toMatchObject({
      applyAllowed: false, errors: expect.arrayContaining([expect.stringMatching(/collides with canonical content/)]),
    });
    expect(() => applyThroughRepository(direct, value.projectId, proposal.id, groupIds, preview.previewFingerprint))
      .toThrow(/collides with an existing stable ID/);
    expect(direct.applications.list(value.projectId)).toEqual([]);
    direct.database.prepare("DELETE FROM passage_entity_heads WHERE project_id = ? AND entity_kind = 'choice' AND entity_id = ?")
      .run(value.projectId, threadId);
    direct.database.prepare("DELETE FROM passage_entity_versions WHERE project_id = ? AND entity_kind = 'choice' AND entity_id = ?")
      .run(value.projectId, threadId);
    const applied = direct.service.apply(value.projectId, proposal.id, groupIds, preview.previewFingerprint);
    expect(applied.resultingVersions).toEqual([expect.objectContaining({ entityKind: "thread", entityId: threadId })]);
    direct.database.close();
  }, 30_000);

  it("keeps a 300-passage repair bounded to one selected entity and preserves every unrelated version", async () => {
    const value = await fixture("large");
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]!.entityId).toBe("passage-000");
    const before = new Map(value.passagePlan.passages.map((item: { entityId: string; id: string }) => [item.entityId, item.id]));
    const selectedGroupIds = proposal.groups.map((group) => group.id);
    const previewResponse = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds } });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json();
    expect(preview).toMatchObject({ applyAllowed: true, providerCalls: 0, operations: [{ entityId: "passage-000" }] });
    expect(Buffer.byteLength(previewResponse.body, "utf8")).toBeLessThan(1_000_000);
    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds, previewFingerprint: preview.previewFingerprint } });
    expect(applied.statusCode, applied.body).toBe(201);
    const after = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).json();
    expect(after.passages).toHaveLength(300);
    for (const item of after.passages as Array<{ entityId: string; id: string }>) {
      if (item.entityId === "passage-000") expect(item.id).not.toBe(before.get(item.entityId));
      else expect(item.id).toBe(before.get(item.entityId));
    }
    expect((await value.app.inject({ method: "GET", url: `${value.root}/applications` })).json().items).toHaveLength(1);
    expect(value.provider.calls).toHaveLength(0);
  }, 30_000);

  it("applies one typed ending repair as one immutable artifact version without changing sibling endings or routes", async () => {
    const value = await fixture("ending");
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const targetId = proposal.operations[0]!.entityId;
    const endingVersionsBefore = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/endings/versions` })).json();
    const routeVersionsBefore = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/routes/versions` })).json();
    const oldHead = endingVersionsBefore[0];
    const selectedGroupIds = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds } })).json();
    expect(preview.applyAllowed).toBe(true);
    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds, previewFingerprint: preview.previewFingerprint } });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(applied.json().resultingVersions).toEqual([expect.objectContaining({ entityKind: "ending", entityId: targetId })]);
    expect(applied.json().verification.dispositions[0].evidence).toMatchObject({
      validationFingerprint: applied.json().validationFingerprint,
      validationResult: expect.stringMatching(/present|absent/),
    });
    const endingVersionsAfter = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/endings/versions` })).json();
    const routeVersionsAfter = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/routes/versions` })).json();
    expect(endingVersionsAfter).toHaveLength(endingVersionsBefore.length + 1);
    expect(endingVersionsAfter.find((item: { id: string }) => item.id === oldHead.id).content).toEqual(oldHead.content);
    const newHead = endingVersionsAfter[0];
    expect(newHead.content.endings.find((item: { id: string }) => item.id === targetId).summary)
      .not.toBe(oldHead.content.endings.find((item: { id: string }) => item.id === targetId).summary);
    expect(newHead.content.endings.filter((item: { id: string }) => item.id !== targetId))
      .toEqual(oldHead.content.endings.filter((item: { id: string }) => item.id !== targetId));
    expect(routeVersionsAfter.map((item: { id: string }) => item.id)).toEqual(routeVersionsBefore.map((item: { id: string }) => item.id));
    expect(value.provider.calls).toHaveLength(0);
  }, 30_000);

  it("applies one typed mechanic repair in one immutable artifact version and preserves every sibling mechanic", async () => {
    const value = await fixture("mechanic");
    const proposal = value.proposal as { id: string; groups: Array<{ id: string }>; operations: Array<{ entityId: string }> };
    const targetId = proposal.operations[0]!.entityId;
    const versionsBefore = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/mechanics/versions` })).json();
    const oldHead = versionsBefore[0];
    const selectedGroupIds = proposal.groups.map((group) => group.id);
    const preview = (await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/application-preview`, payload: { selectedGroupIds } })).json();
    expect(preview).toMatchObject({ applyAllowed: true, validation: { status: "valid" } });
    const applied = await value.app.inject({ method: "POST", url: `${value.root}/proposals/${proposal.id}/apply`, payload: { selectedGroupIds, previewFingerprint: preview.previewFingerprint } });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(applied.json().resultingVersions).toEqual([expect.objectContaining({ entityKind: "mechanic", entityId: targetId })]);
    expect(applied.json().verification.dispositions[0].evidence).toMatchObject({
      validationFingerprint: applied.json().validationFingerprint,
      validationResult: expect.stringMatching(/present|absent/),
    });
    const versionsAfter = (await value.app.inject({ method: "GET", url: `/api/projects/${value.projectId}/artifacts/mechanics/versions` })).json();
    expect(versionsAfter).toHaveLength(versionsBefore.length + 1);
    expect(versionsAfter.find((item: { id: string }) => item.id === oldHead.id).content).toEqual(oldHead.content);
    const mechanics = (content: { visibleStats: Array<{ key: string }>; relationships: Array<{ key: string }>; flags: Array<{ key: string }>; resources: Array<{ key: string }> }) =>
      [...content.visibleStats, ...content.relationships, ...content.flags, ...content.resources];
    const oldMechanics = mechanics(oldHead.content);
    const newMechanics = mechanics(versionsAfter[0].content);
    expect(newMechanics.find((item) => item.key === targetId)).not.toEqual(oldMechanics.find((item) => item.key === targetId));
    expect(newMechanics.filter((item) => item.key !== targetId)).toEqual(oldMechanics.filter((item) => item.key !== targetId));
    expect(value.provider.calls).toHaveLength(0);
  }, 30_000);
});
