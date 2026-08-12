import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LongFormEndingPlanSchema, LongFormRoutePlanSchema } from "@story-to-cyoa/pipeline";
import { openDatabase, PassageDraftRepository, PassagePlanRepository, WorkflowRepository } from "@story-to-cyoa/persistence";
import { afterEach, describe, expect, it } from "vitest";
import { DeterministicNarrativeReviewProvider } from "../src/services/narrative-review-provider.js";
import { buildApp } from "../src/app.js";
import { repairImpactRouteSections } from "../src/services/repair-planning-service.js";

const apps: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function fixture(
  databasePath?: string,
  beforeEvidence?: (value: { projectId: string; plan: Record<string, any> }) => void,
) {
  const provider = new DeterministicNarrativeReviewProvider();
  const app = buildApp({ narrativeReviewProvider: provider, databasePath }); apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Repair planning" } })).json();
  const projectId = created.project.id as string;
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}` })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`, payload: { versionId: generated[artifactId].id } });
  }
  const mechanics = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics` })).json();
  const savedMechanics = (await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{ id: "effect-repair", label: "Repair effects", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key), effectGuidance: ["Exercise deterministic state."] }],
    },
  })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`, payload: { versionId: savedMechanics.mechanics.id } });
  const plan = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  const snapshot = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` })).json();
  expect((await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id } })).statusCode).toBe(201);
  beforeEvidence?.({ projectId, plan });
  const input = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs` })).json();
  const run = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/runs`, payload: { inputArtifactVersionId: input.id, choiceIds: ["invented-choice"] } })).json();
  expect(run.content.trace.findings).toHaveLength(1);
  const campaign = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/playtests/campaigns`, payload: { inputArtifactVersionId: input.id, seed: "repair-evidence", policy: { sampleCount: 3, maxStepsPerSample: 30 } } })).json();
  const scopePassageIds = [plan.structure.content.startPassageId];
  const review = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/narrative-review/plans`, payload: { simulationInputVersionId: input.id, scopePassageIds, campaignVersionIds: [campaign.id] } })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/narrative-review/plans/${review.plan.id}/authorize`, payload: { fingerprint: review.plan.fingerprint } });
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/narrative-review/plans/${review.plan.id}/start` });
  for (let count = 0; count < 100; count += 1) {
    const current = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/narrative-review/plans/${review.plan.id}` })).json();
    if (current.job.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return { app, projectId, plan, snapshot, input, run, campaign, provider };
}

const repairRoot = (projectId: string) => `/api/long-form/projects/${projectId}/repair`;

describe("Foundation 6A repair planning API", () => {
  it("derives exact multi-route relationships for every route-section kind", () => {
    const routes = LongFormRoutePlanSchema.parse({
      title: "Typed routes", overview: "", totalWordTarget: 50_000,
      routes: [
        { id: "r1", name: "One", endingHookIds: [], entryConditions: [], relationshipArcs: [] },
        { id: "r2", name: "Two", endingHookIds: ["hook-2"], entryConditions: [], relationshipArcs: [] },
      ],
      acts: [
        { id: "a1", routeId: "r1", label: "One", wordTarget: 10_000 },
        { id: "a2", routeId: "r2", label: "Two", wordTarget: 10_000 },
        { id: "shared", routeId: null, label: "Shared", wordTarget: 10_000 },
      ],
      decisionPoints: [{
        id: "decision", label: "Choose", actId: "a1", question: "",
        choices: [
          { id: "r-not-a-route", label: "Two", destinationActId: "a2", routeId: "r2", conditions: [], consequences: [] },
          { id: "shared-choice", label: "Shared", destinationActId: "shared", routeId: null, conditions: [], consequences: [] },
        ],
      }],
      reconvergences: [{ id: "join", label: "Join", fromActIds: ["a1", "a2"], toActId: "shared", requirements: ["r-not-a-route"], preservedDifferences: [] }],
      endingHooks: [{ id: "hook-2", label: "Finish", routeId: "r2", type: "success", summary: "" }],
      unresolvedQuestions: [],
    });
    const endings = LongFormEndingPlanSchema.parse({
      title: "Endings", overview: "", projectWordTarget: 50_000, endingWordTarget: 1_000,
      endings: [{ id: "ending-2", hookId: "hook-2", routeId: "r2", title: "Finish", type: "success", summary: "", thematicPayoff: "", wordTarget: 1_000 }],
      unresolvedQuestions: [],
    });
    const sections = repairImpactRouteSections(routes, endings.endings);
    expect(sections.find((item) => item.kind === "act" && item.id === "a1")).toMatchObject({
      routeIds: ["r1"], ownedDecisionIds: ["decision"], reconvergenceIds: ["join"],
    });
    expect(sections.find((item) => item.kind === "act" && item.id === "a2")).toMatchObject({ incomingDecisionIds: ["decision"], reconvergenceIds: ["join"] });
    expect(sections.find((item) => item.kind === "decision")).toMatchObject({ owningActId: "a1", destinationActIds: ["a2", "shared"], routeIds: ["r1", "r2"] });
    expect(sections.find((item) => item.kind === "reconvergence")).toMatchObject({ fromActIds: ["a1", "a2"], toActId: "shared", routeIds: ["r1", "r2"] });
    expect(sections.find((item) => item.kind === "ending-hook")).toMatchObject({ routeIds: ["r2"], endingIds: ["ending-2"] });
    expect(sections.some((item) => item.routeIds.includes("r-not-a-route"))).toBe(false);
  });

  it("resolves exact immutable F3/F5A/F5B/F5C evidence and rejects reference tampering", async () => {
    const value = await fixture();
    const kinds = ["foundation-3-static-validation", "foundation-5a-runtime", "foundation-5b-playtest", "foundation-5c-narrative-review"] as const;
    for (const sourceKind of kinds) {
      const listed = (await value.app.inject({ method: "GET", url: `${repairRoot(value.projectId)}/findings?sourceKind=${sourceKind}` })).json();
      expect(listed).toMatchObject({ truncated: false, limit: 500 });
      expect(listed.items.length, sourceKind).toBeGreaterThan(0);
      expect(listed.items[0]).not.toHaveProperty("reference");
      const exact = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/findings/resolve`, payload: listed.items[0].locator });
      expect(exact.statusCode, exact.body).toBe(200);
      expect(exact.json()).toMatchObject({ sourceFingerprint: listed.items[0].sourceFingerprint, sourceState: "current", reference: { kind: sourceKind, projectId: value.projectId } });
      const invalidLineage = structuredClone(exact.json());
      if (sourceKind === "foundation-3-static-validation") invalidLineage.reference.snapshotVersion += 1;
      else if (sourceKind === "foundation-5a-runtime") invalidLineage.reference.traceFingerprint = "0".repeat(64);
      else if (sourceKind === "foundation-5b-playtest") invalidLineage.reference.finding.fingerprint = "0".repeat(64);
      else invalidLineage.reference.attemptId = "wrong-attempt";
      const lineageRejected = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/targets`, payload: { findings: [invalidLineage], intent: { schemaVersion: 1, category: "structural", note: "" } } });
      expect(lineageRejected.statusCode, sourceKind).toBe(409);
      const tampered = structuredClone(exact.json()); tampered.reference.projectId = "another-project";
      const rejected = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/targets`, payload: { findings: [tampered], intent: { schemaVersion: 1, category: "structural", note: "" } } });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().code).toBe("repair_cross_project_source");
    }
  }, 15_000);

  it("previews and reopens a durable exact plan without provider calls or canonical mutation, then marks it historical", async () => {
    const value = await fixture();
    const beforeCalls = value.provider.calls.length;
    const beforePlan = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).body;
    const listed = (await value.app.inject({ method: "GET", url: `${repairRoot(value.projectId)}/findings?sourceKind=foundation-5a-runtime` })).json();
    const finding = (await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/findings/resolve`, payload: listed.items[0].locator })).json();
    const intent = { schemaVersion: 1, category: "passage-plan", note: "Repair only the exact runtime failure." };
    const oversized = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/targets`, payload: { findings: Array.from({ length: 9 }, () => finding), intent } });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json().code).toBe("repair_findings_too_large");
    const options = (await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/targets`, payload: { findings: [finding], intent } })).json();
    const target = options.targets.find((item: { targetKey: string }) => item.targetKey.startsWith("passage:"));
    expect(target).toBeDefined();
    const request = { findings: [finding], intent, targets: [target.target] };
    const preview = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/plans/preview`, payload: request });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ currentState: { status: "current" }, eligibleForGeneration: true, definition: { authorizedTargets: [target.target], providerNeeded: "manual-deterministic" } });
    expect(value.provider.calls).toHaveLength(beforeCalls);
    expect((await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).body).toBe(beforePlan);
    const saved = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/plans`, payload: request });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().definitionFingerprint).toBe(preview.json().fingerprint);
    const passage = value.plan.passages.find((item: { entityId: string }) => item.entityId === value.plan.structure.content.startPassageId);
    await value.app.inject({ method: "PUT", url: `/api/long-form/projects/${value.projectId}/passage-plan/entities/passage/${passage.entityId}`, payload: { ...passage.content, title: `${passage.content.title} changed` } });
    const reopened = (await value.app.inject({ method: "GET", url: `${repairRoot(value.projectId)}/plans/${saved.json().id}` })).json();
    expect(reopened.definition).toEqual(saved.json().definition);
    expect(reopened.currentState.status).toBe("historical");
    expect(reopened.eligibleForGeneration).toBe(false);
    const stalePreview = await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/plans/preview`, payload: request });
    expect(stalePreview.statusCode).toBe(409);
    expect(value.provider.calls).toHaveLength(beforeCalls);
  }, 15_000);

  it("previews accepted-root prose dependencies across lifecycle copies and a transitive chain", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-repair-roots-")); directories.push(directory);
    const databasePath = join(directory, "story.sqlite");
    const acceptedIds: { a?: string; b?: string; c?: string; d?: string } = {};
    const value = await fixture(databasePath, ({ projectId, plan }) => {
      const passageA = plan.structure.content.startPassageId as string;
      const otherPassages = plan.passages.map((item: { entityId: string }) => item.entityId).filter((id: string) => id !== passageA);
      const [passageB, passageC, passageD] = otherPassages;
      expect([passageB, passageC, passageD].every(Boolean)).toBe(true);
      const database = openDatabase(databasePath);
      const drafts = new PassageDraftRepository(database);
      const passagePlans = new PassagePlanRepository(database);
      const workflow = new WorkflowRepository(database);
      const upstreamVersions = Object.fromEntries(["brief", "bible", "routes", "endings", "mechanics"].map((artifactId) => [artifactId, workflow.get(projectId, artifactId).approvedVersionId!]));
      const accept = (passageId: string, neighbors: Record<string, string>) => {
        const base = passagePlans.currentEntity(projectId, "passage", passageId)!;
        const candidate = drafts.createVersion({
          projectId, passageId, basedOnPassagePlanVersionId: base.id,
          proseMarkdown: `Accepted prose for ${passageId}`, sourceKind: "manual", upstreamVersions,
          neighboringDraftVersions: neighbors,
        });
        return drafts.transition(projectId, passageId, candidate.id, "accepted");
      };
      const acceptedA = accept(passageA, {});
      const acceptedB = accept(passageB!, { [passageA]: acceptedA.id });
      const acceptedC = accept(passageC!, { [passageB!]: acceptedB.id });
      const acceptedD = accept(passageD!, {});
      const reviewedA = drafts.transition(projectId, passageA, acceptedA.id, "reviewed");
      const lockedA = drafts.transition(projectId, passageA, reviewedA.id, "locked");
      const roots = drafts.acceptedVersionRoots(projectId);
      expect(roots[reviewedA.id]).toBe(roots[acceptedA.id]);
      expect(roots[lockedA.id]).toBe(roots[acceptedA.id]);
      expect(drafts.getVersion(projectId, acceptedB.id)?.stale).toBe(false);
      Object.assign(acceptedIds, { a: lockedA.id, b: acceptedB.id, c: acceptedC.id, d: acceptedD.id });
      database.close();
    });
    const listed = (await value.app.inject({ method: "GET", url: `${repairRoot(value.projectId)}/findings?sourceKind=foundation-5a-runtime` })).json();
    const finding = (await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/findings/resolve`, payload: listed.items[0].locator })).json();
    const intent = { schemaVersion: 1, category: "prose", note: "Repair exact accepted prose." };
    const options = (await value.app.inject({ method: "POST", url: `${repairRoot(value.projectId)}/targets`, payload: { findings: [finding], intent } })).json();
    const proseTarget = options.targets.find((item: { targetKey: string }) => item.targetKey.startsWith("prose:"));
    expect(proseTarget).toBeDefined();
    expect(proseTarget.target.passageId).toBe(value.plan.structure.content.startPassageId);

    const beforeCalls = value.provider.calls.length;
    const preview = await value.app.inject({
      method: "POST", url: `${repairRoot(value.projectId)}/plans/preview`,
      payload: { findings: [finding], intent, targets: [proseTarget.target] },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    const nodes = preview.json().definition.impactGraph.nodes as Array<{ entityKind: string; entityId: string }>;
    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKind: "passage-draft", entityId: acceptedIds.b }),
      expect.objectContaining({ entityKind: "passage-draft", entityId: acceptedIds.c }),
    ]));
    expect(nodes.some((node) => node.entityId === acceptedIds.d)).toBe(false);
    expect(value.provider.calls).toHaveLength(beforeCalls);
  }, 15_000);
});
