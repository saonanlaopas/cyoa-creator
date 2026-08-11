import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DeterministicNarrativeReviewProvider } from "../src/services/narrative-review-provider.js";
import { buildApp } from "../src/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })); });

async function approvedProject(provider = new DeterministicNarrativeReviewProvider(), databasePath?: string) {
  const app = buildApp({ narrativeReviewProvider: provider, databasePath }); apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Narrative review" } })).json();
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
      choiceEffectPlans: [{
        id: "effect-review", label: "Review effects", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Exercise deterministic state."],
      }],
    },
  })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`, payload: { versionId: savedMechanics.mechanics.id } });
  const plan = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  const snapshot = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` })).json();
  expect((await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id } })).statusCode).toBe(201);
  const input = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs` })).json();
  return { app, projectId, plan, snapshot, input, provider };
}

const reviewRoot = (projectId: string) => `/api/long-form/projects/${projectId}/narrative-review`;
async function waitForReview(app: ReturnType<typeof buildApp>, projectId: string, planId: string) {
  for (let count = 0; count < 100; count += 1) {
    const response = await app.inject({ method: "GET", url: `${reviewRoot(projectId)}/plans/${planId}` });
    const review = response.json(); if (review.job.status !== "running") return review;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Narrative review did not settle");
}

describe("Foundation 5C narrative review API", () => {
  it("previews and saves without provider calls, requires exact authorization, then persists immutable findings", async () => {
    const fixture = await approvedProject(); const scope = fixture.plan.passages.slice(0, 8).map((item: { entityId: string }) => item.entityId);
    const campaign = (await fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`,
      payload: { inputArtifactVersionId: fixture.input.id, seed: "review-evidence", policy: { sampleCount: 3, maxStepsPerSample: 50 } },
    })).json();
    const request = { simulationInputVersionId: fixture.input.id, scopePassageIds: scope, campaignVersionIds: [campaign.id], policy: { maxPassagesPerUnit: 999, maxOutputTokensPerUnit: 99_999 } };
    const before = (await fixture.app.inject({ method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan` })).body;
    const preview = await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/preview`, payload: request });
    expect(preview.statusCode, preview.body).toBe(200); expect(preview.json().plan.units.length).toBeGreaterThan(0);
    expect(preview.json().plan.policy).toMatchObject({ maxPassagesPerUnit: 8, maxOutputTokensPerUnit: 8_000 }); expect(fixture.provider.calls).toHaveLength(0);
    const created = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans`, payload: request })).json();
    expect(fixture.provider.calls).toHaveLength(0);
    expect((await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/start` })).statusCode).toBe(409);
    const authorized = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/authorize`, payload: { fingerprint: created.plan.fingerprint } })).json();
    expect(authorized.job.status).toBe("authorized"); expect(fixture.provider.calls).toHaveLength(0);
    expect((await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/start` })).statusCode).toBe(200);
    const completed = await waitForReview(fixture.app, fixture.projectId, created.plan.id);
    expect(completed.job.status).toBe("completed");
    expect(completed.job.units.every((unit: { status: string }) => unit.status === "completed")).toBe(true);
    expect(completed.job.units.flatMap((unit: { findings: unknown[] }) => unit.findings).length).toBeGreaterThanOrEqual(0);
    expect((await fixture.app.inject({ method: "GET", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/history` })).json().items.length).toBeGreaterThan(3);
    expect((await fixture.app.inject({ method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan` })).body).toBe(before);
  });

  it("performs at most one structural repair and preserves failed attempt history across retry", async () => {
    const provider = new DeterministicNarrativeReviewProvider({ malformedFirst: true, failFirst: true });
    const fixture = await approvedProject(provider); const passageId = fixture.plan.passages[0].entityId;
    const created = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans`, payload: {
      simulationInputVersionId: fixture.input.id, scopePassageIds: [passageId],
    } })).json();
    await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/authorize`, payload: { fingerprint: created.plan.fingerprint } });
    await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/start` });
    const failed = await waitForReview(fixture.app, fixture.projectId, created.plan.id);
    expect(failed.job.status).toBe("failed"); expect(failed.job.units[0].attempts).toHaveLength(1);
    await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/units/${failed.job.units[0].id}/retry` });
    await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/start` });
    const completed = await waitForReview(fixture.app, fixture.projectId, created.plan.id);
    expect(completed.job.status).toBe("completed"); expect(completed.job.units[0].attempts).toHaveLength(2);
    expect(completed.job.units[0].attempts[1].repair.performed).toBe(1);
    expect(provider.calls.filter((call) => call.mode === "repair")).toHaveLength(1);
  });

  it("blocks stale authorized plans with zero calls and rejects an in-flight stale result without findings", async () => {
    const provider = new DeterministicNarrativeReviewProvider({ delayMs: 75 }); const fixture = await approvedProject(provider);
    const passageRecord = fixture.plan.passages[0]; const passage = passageRecord.content;
    const create = async () => {
      const review = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans`, payload: { simulationInputVersionId: fixture.input.id, scopePassageIds: [passage.id] } })).json();
      await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${review.plan.id}/authorize`, payload: { fingerprint: review.plan.fingerprint } }); return review;
    };
    const staleBefore = await create();
    await fixture.app.inject({ method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/entities/passage/${passage.id}`, payload: { ...passage, summary: `${passage.summary} changed` } });
    const blocked = await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${staleBefore.plan.id}/start` });
    expect(blocked.statusCode).toBe(409); expect(blocked.json().code).toBe("stale_review_plan"); expect(provider.calls).toHaveLength(0);

    const restored = (await fixture.app.inject({ method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/snapshots/${fixture.snapshot.id}/restore` })).json();
    const nextSnapshot = (await fixture.app.inject({ method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/snapshots` })).json();
    await fixture.app.inject({ method: "POST", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/approve`, payload: { snapshotId: nextSnapshot.id } });
    const nextInput = (await fixture.app.inject({ method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/inputs` })).json();
    const currentPlan = (await fixture.app.inject({ method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan` })).json();
    const currentPassage = currentPlan.passages.find((item: { entityId: string }) => item.entityId === passage.id).content;
    const racing = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans`, payload: { simulationInputVersionId: nextInput.id, scopePassageIds: [passage.id] } })).json();
    await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${racing.plan.id}/authorize`, payload: { fingerprint: racing.plan.fingerprint } });
    await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${racing.plan.id}/start` });
    while (provider.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));
    await fixture.app.inject({ method: "PUT", url: `/api/long-form/projects/${fixture.projectId}/passage-plan/entities/passage/${passage.id}`, payload: { ...currentPassage, summary: `${currentPassage.summary} race` } });
    const raced = await waitForReview(fixture.app, fixture.projectId, racing.plan.id);
    expect(raced.job.status).toBe("failed"); expect(raced.job.units[0].findings).toEqual([]);
    expect(raced.job.units[0].attempts[0].error.code).toBe("stale_review_plan");
  });

  it("cancels delayed provider work without late findings and recovers interrupted running units as retryable", async () => {
    const provider = new DeterministicNarrativeReviewProvider({ delayMs: 150 }); const fixture = await approvedProject(provider);
    const passageId = fixture.plan.passages[0].entityId;
    const createAndStart = async (app = fixture.app, projectId = fixture.projectId, inputId = fixture.input.id) => {
      const created = (await app.inject({ method: "POST", url: `${reviewRoot(projectId)}/plans`, payload: { simulationInputVersionId: inputId, scopePassageIds: [passageId] } })).json();
      await app.inject({ method: "POST", url: `${reviewRoot(projectId)}/plans/${created.plan.id}/authorize`, payload: { fingerprint: created.plan.fingerprint } });
      await app.inject({ method: "POST", url: `${reviewRoot(projectId)}/plans/${created.plan.id}/start` }); return created;
    };
    const cancelled = await createAndStart(); while (provider.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));
    const cancelResponse = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${cancelled.plan.id}/cancel` })).json();
    expect(cancelResponse.job.status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 175));
    const after = (await fixture.app.inject({ method: "GET", url: `${reviewRoot(fixture.projectId)}/plans/${cancelled.plan.id}` })).json();
    expect(after.job.units[0].findings).toEqual([]); expect(after.job.units[0].status).toBe("cancelled");

    const directory = mkdtempSync(join(process.cwd(), ".tmp-review-recovery-")); directories.push(directory); const databasePath = join(directory, "story.sqlite");
      const interruptedProvider = new DeterministicNarrativeReviewProvider({ delayMs: 10_000 });
      const persisted = await approvedProject(interruptedProvider, databasePath); const persistedPassageId = persisted.plan.passages[0].entityId;
      const started = (await persisted.app.inject({ method: "POST", url: `${reviewRoot(persisted.projectId)}/plans`, payload: { simulationInputVersionId: persisted.input.id, scopePassageIds: [persistedPassageId] } })).json();
      await persisted.app.inject({ method: "POST", url: `${reviewRoot(persisted.projectId)}/plans/${started.plan.id}/authorize`, payload: { fingerprint: started.plan.fingerprint } });
      await persisted.app.inject({ method: "POST", url: `${reviewRoot(persisted.projectId)}/plans/${started.plan.id}/start` });
      while (interruptedProvider.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 2));
      await persisted.app.close(); apps.splice(apps.indexOf(persisted.app), 1);
      const reopenedProvider = new DeterministicNarrativeReviewProvider(); const reopened = buildApp({ databasePath, narrativeReviewProvider: reopenedProvider }); apps.push(reopened);
      const recovered = (await reopened.inject({ method: "GET", url: `${reviewRoot(persisted.projectId)}/plans/${started.plan.id}` })).json();
      expect(recovered.job.status).toBe("failed"); expect(recovered.job.units[0].status).toBe("failed");
      expect(recovered.job.units[0].attempts[0].error).toMatchObject({ code: "review_interrupted", retryable: true });
      expect(reopenedProvider.calls).toHaveLength(0);
  }, 15_000);

  it("rejects invented evidence and oversized offline output without partial findings", async () => {
    for (const provider of [
      new DeterministicNarrativeReviewProvider({ invalidEvidence: true }),
      new DeterministicNarrativeReviewProvider({ oversized: true }),
    ]) {
      const fixture = await approvedProject(provider); const passageId = fixture.plan.passages[0].entityId;
      const created = (await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans`, payload: { simulationInputVersionId: fixture.input.id, scopePassageIds: [passageId] } })).json();
      await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/authorize`, payload: { fingerprint: created.plan.fingerprint } });
      await fixture.app.inject({ method: "POST", url: `${reviewRoot(fixture.projectId)}/plans/${created.plan.id}/start` });
      const failed = await waitForReview(fixture.app, fixture.projectId, created.plan.id);
      expect(failed.job.status).toBe("failed"); expect(failed.job.units[0].findings).toEqual([]);
      expect(failed.job.units[0].attempts[0].status).toBe("failed");
    }
  });
});
