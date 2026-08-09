import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DeterministicPassagePlanningProvider } from "../src/services/passage-planning-provider.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

async function approvedPassagePlan(app: ReturnType<typeof buildApp>, passageCount = 30, passageSummary = "") {
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Generation" } })).json();
  const projectId = created.project.id as string;
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
  const bible = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`, payload: { versionId: bible.bible.id } });
  const routes = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/routes` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`, payload: { versionId: routes.routes.id } });
  const endings = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/endings` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/endings/approve`, payload: { versionId: endings.endings.id } });
  const mechanics = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics` })).json();
  const mechanicsSaved = (await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-core", label: "Core consequences", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Consequences remain visible."],
      }],
    },
  })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`, payload: { versionId: mechanicsSaved.mechanics.id } });
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` });

  const routeId = routes.routes.content.routes[0].id as string;
  const endingId = endings.endings.content.endings.find((item: { routeId: string }) => item.routeId === routeId).id as string;
  const passageIds = Array.from({ length: passageCount }, (_, index) => `passage-${String(index).padStart(3, "0")}`);
  const passages = passageIds.map((id, index) => ({
    id, sequenceId: "sequence-main", title: `Passage ${index}`, kind: index === passageCount - 1 ? "epilogue" : "scene",
    purpose: `Beat ${index}`, summary: passageSummary, wordTarget: 500, routeIds: [routeId], tags: [], characterIds: [],
    relationshipIds: [], locationIds: [], requiredFactIds: [], revealedFactIds: [], setupThreadIds: [], payoffThreadIds: [],
    preservedDifferenceIds: [], choiceIds: index === passageCount - 1 ? [] : [`choice-${index}`], terminal: index === passageCount - 1,
    endingId: index === passageCount - 1 ? endingId : null, draftingNotes: [], unresolvedQuestions: [], planningStatus: "planned", position: index,
  }));
  const choices = passageIds.slice(0, -1).map((id, index) => ({
    id: `choice-${index}`, sourcePassageId: id, label: "Continue", destinationPassageId: passageIds[index + 1],
    narrativeIntent: "", consequencePreview: "", condition: null, unavailableBehavior: "disabled",
    unavailableExplanation: "", effects: [], sourceDecisionIds: [], position: 0,
  }));
  const bundle = {
    schemaVersion: 1,
    structure: {
      schemaVersion: 1, title: "Generation fixture", projectWordTarget: passageCount * 500,
      typicalPathWordTarget: passageCount * 500, startPassageId: passageIds[0],
      acts: [{ id: "act-main", label: "Main", purpose: "", summary: "", wordTarget: passageCount * 500, routeIds: [routeId], sequenceIds: ["sequence-main"], position: 0 }],
      sequences: [{ id: "sequence-main", actId: "act-main", label: "Main", purpose: "", summary: "", wordTarget: passageCount * 500, routeIds: [routeId], passageIds, entryGoals: [], exitGoals: [], requiredDecisionIds: [], endingHookIds: [], position: 0, planningStatus: "planned" }],
      characterAvailability: [],
    },
    passages, choices, threads: [],
  };
  await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan`, payload: bundle });
  const snapshot = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` })).json();
  const approval = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id } });
  expect(approval.statusCode).toBe(201);
  return { projectId, snapshot, bundle };
}

const waitForTerminal = async (app: ReturnType<typeof buildApp>, projectId: string, jobId: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${jobId}` });
    const job = response.json();
    if (["completed", "partially_failed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Generation job did not finish");
};

describe("passage generation kernel API", () => {
  it("previews without provider calls, captures exact inputs, authorizes, partially fails, and retries independently", async () => {
    const failures: string[] = [];
    const provider = new DeterministicPassagePlanningProvider({ failFirstAttemptForUnitIds: failures });
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId, snapshot } = await approvedPassagePlan(app);
    const before = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
    const payload = { scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: provider.id, modelId: "fixture-v1" };
    const preview = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/preview`, payload });
    expect(preview.statusCode).toBe(200);
    expect(provider.calls).toHaveLength(0);
    expect(preview.json()).toMatchObject({ snapshotId: snapshot.id, units: [{ passageIds: expect.any(Array) }, { passageIds: expect.any(Array) }] });
    expect(preview.json().units[0]).toMatchObject({
      contextFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      contextDiagnostics: {
        outputSchema: { id: "cyoa.passage-planning-unit-candidate", version: 1 },
        requestedMaximumOutputTokens: 6500,
        includedRecords: { passages: { ids: expect.any(Array), versionIds: expect.any(Array) } },
      },
    });
    expect(preview.json().upstreamVersions).toEqual(snapshot.upstreamVersions);
    const repeated = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/preview`, payload });
    expect(repeated.json()).toEqual(preview.json());

    const created = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload })).json();
    failures.push(created.units[0].id);
    expect(provider.calls).toHaveLength(0);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, payload: { fingerprint: "wrong" },
    })).statusCode).toBe(400);
    const authorized = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, payload: { fingerprint: created.fingerprint },
    });
    expect(authorized.statusCode).toBe(200);
    const changedPassage = { ...before.passages[0].content, title: "Newer mutable head must stay excluded" };
    expect((await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${changedPassage.id}`,
      payload: changedPassage,
    })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start` })).statusCode).toBe(202);
    const partial = await waitForTerminal(app, projectId, created.jobId);
    expect(partial.status).toBe("partially_failed");
    expect(partial.units.map((unit: { status: string }) => unit.status)).toEqual(["failed", "completed"]);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/units/${created.units[0].id}/retry`,
    })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start` });
    const complete = await waitForTerminal(app, projectId, created.jobId);
    expect(complete.status).toBe("completed");
    expect(complete.units.map((unit: { attemptNumber: number }) => unit.attemptNumber)).toEqual([2, 1]);
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls.every((call) => call.maximumOutputTokens <= 8_000)).toBe(true);
    const sentPassage = (provider.calls[0]!.boundedContext as { selectedPassages: Array<{ content: { title: string } }> }).selectedPassages[0]!.content;
    expect(sentPassage.title).toBe("Passage 0");
    expect(complete.units.every((unit: { candidate: unknown }) => unit.candidate)).toBe(true);

    const after = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
    expect(after.structure).toEqual(before.structure);
    expect(after.passages[0].content.title).toBe("Newer mutable head must stay excluded");
    expect(after.passages.slice(1)).toEqual(before.passages.slice(1));
    expect(after.snapshots).toEqual(before.snapshots);
    await app.close();
  });

  it("rejects an over-limit bounded context locally before any provider call", async () => {
    const provider = new DeterministicPassagePlanningProvider();
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId } = await approvedPassagePlan(app, 25, "x".repeat(20_000));
    const preview = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/passage-generation/plans/preview`,
      payload: { scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: provider.id, modelId: "fixture-v1" },
    });
    expect(preview.statusCode).toBe(400);
    expect(preview.json().error).toContain("limit");
    expect(provider.calls).toHaveLength(0);
    await app.close();
  });

  it("repairs malformed structured output once and retains the validated immutable candidate", async () => {
    const malformed: string[] = [];
    const provider = new DeterministicPassagePlanningProvider({ malformedFirstOutputForUnitIds: malformed });
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId } = await approvedPassagePlan(app, 10);
    const payload = { scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: provider.id, modelId: "fixture-v1" };
    const created = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload })).json();
    malformed.push(created.units[0].id);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, payload: { fingerprint: created.fingerprint } });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start` });
    const completed = await waitForTerminal(app, projectId, created.jobId);
    expect(completed).toMatchObject({
      status: "completed",
      units: [{
        status: "completed",
        candidate: {
          validation: { valid: true },
          repair: { repairsPerformed: 1, maximumRepairs: 1 },
        },
      }],
    });
    expect(provider.calls.map((call) => call.mode)).toEqual(["generate", "repair"]);
    expect(provider.calls[1]!.boundedContext).toEqual({
      schemaId: "cyoa.passage-planning-unit-candidate",
      schemaVersion: 1,
      jobId: created.jobId,
      unitId: created.units[0].id,
      inputFingerprint: created.units[0].inputFingerprint,
    });
    await app.close();
  });

  it("stops after one failed repair and never persists a candidate or mutates the passage plan", async () => {
    const malformed: string[] = [];
    const provider = new DeterministicPassagePlanningProvider({
      malformedFirstOutputForUnitIds: malformed,
      invalidRepairForUnitIds: malformed,
    });
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId } = await approvedPassagePlan(app, 10);
    const before = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
    const payload = { scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: provider.id, modelId: "fixture-v1" };
    const created = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload })).json();
    malformed.push(created.units[0].id);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, payload: { fingerprint: created.fingerprint } });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start` });
    const failed = await waitForTerminal(app, projectId, created.jobId);
    expect(failed).toMatchObject({ status: "failed", units: [{ status: "failed", candidate: null }] });
    expect(failed.units[0].normalizedError.validationIssues).toBeDefined();
    expect(provider.calls).toHaveLength(2);
    const after = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
    expect(after.structure).toEqual(before.structure);
    expect(after.passages).toEqual(before.passages);
    expect(after.snapshots).toEqual(before.snapshots);
    await app.close();
  });

  it("cancels scheduling and rejects cross-project access", async () => {
    const provider = new DeterministicPassagePlanningProvider({ delayMs: 100 });
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId } = await approvedPassagePlan(app);
    const payload = { scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: provider.id, modelId: "fixture-v1" };
    const created = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, payload: { fingerprint: created.fingerprint } });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start` });
    const cancelled = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/cancel` });
    expect(cancelled.json().status).toBe("cancelled");
    expect(cancelled.json().units.every((unit: { status: string }) => unit.status === "cancelled")).toBe(true);
    const other = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Other" } })).json().project.id;
    expect((await app.inject({ method: "GET", url: `/api/long-form/projects/${other}/passage-generation/plans/${created.id}` })).statusCode).toBe(404);
    await app.close();
  });

  it("recovers an interrupted running unit on reopen", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-generation-api-"));
    directories.push(directory);
    const databasePath = join(directory, "story.sqlite");
    const first = buildApp({
      databasePath,
      passagePlanningProvider: new DeterministicPassagePlanningProvider({ delayMs: 250 }),
    });
    const { projectId } = await approvedPassagePlan(first, 10);
    const payload = { scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: "offline-kernel", modelId: "fixture-v1" };
    const created = (await first.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload })).json();
    await first.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, payload: { fingerprint: created.fingerprint } });
    await first.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start` });
    await first.close();

    const reopened = buildApp({ databasePath });
    const job = (await reopened.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}` })).json();
    expect(job).toMatchObject({ status: "failed", units: [{ status: "failed", normalizedError: { code: "process_interrupted", retryable: true } }] });
    await reopened.close();
  });
});
