import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DeterministicRepairProposalProvider } from "../src/services/repair-proposal-provider.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

async function fixture(provider = new DeterministicRepairProposalProvider()) {
  const app = buildApp({ repairProposalProvider: provider }); apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Repair proposals" } })).json();
  const projectId = created.project.id as string;
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}` })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`, payload: { versionId: generated[artifactId].id } });
  }
  const mechanics = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics` })).json();
  const savedMechanics = (await app.inject({ method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
    ...mechanics.mechanics.content,
    choiceEffectPlans: [{ id: "effect-repair", label: "Repair effects", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key), effectGuidance: ["Exercise deterministic state."] }],
  } })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`, payload: { versionId: savedMechanics.mechanics.id } });
  const passagePlan = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  const snapshot = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id } });
  const input = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs` })).json();
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/simulation/runs`, payload: { inputArtifactVersionId: input.id, choiceIds: ["invented-choice"] } });
  return { app, provider, projectId, passagePlan };
}

async function savePlan(value: Awaited<ReturnType<typeof fixture>>, category: "passage-plan" | "prose") {
  const root = `/api/long-form/projects/${value.projectId}/repair`;
  const listed = (await value.app.inject({ method: "GET", url: `${root}/findings?sourceKind=foundation-5a-runtime` })).json();
  const finding = (await value.app.inject({ method: "POST", url: `${root}/findings/resolve`, payload: listed.items[0].locator })).json();
  const intent = { schemaVersion: 1, category, note: "Repair only the exact runtime evidence." };
  const options = (await value.app.inject({ method: "POST", url: `${root}/targets`, payload: { findings: [finding], intent } })).json();
  const targetPrefix = category === "prose" ? "prose:" : "passage:";
  const target = options.targets.find((item: { targetKey: string }) => item.targetKey.startsWith(targetPrefix));
  expect(target).toBeDefined();
  const saved = await value.app.inject({ method: "POST", url: `${root}/plans`, payload: { findings: [finding], intent, targets: [target.target] } });
  expect(saved.statusCode, saved.body).toBe(201); return saved.json();
}

async function waitForJob(app: ReturnType<typeof buildApp>, projectId: string, generationId: string) {
  for (let count = 0; count < 200; count += 1) {
    const current = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/repair/proposal-generations/${generationId}` })).json();
    if (current.job.status !== "running") return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Proposal generation did not finish");
}

describe("Foundation 6B repair proposals", () => {
  it("previews and persists a provider-free immutable proposal without canonical mutation", async () => {
    const value = await fixture(); const plan = await savePlan(value, "passage-plan");
    const root = `/api/long-form/projects/${value.projectId}/repair`;
    const beforePlan = (await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).body;
    const preview = await value.app.inject({ method: "POST", url: `${root}/proposals/generation-preview`, payload: { repairPlanId: plan.id } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ mode: "manual-deterministic", providerCalls: 0, canonicalMutations: 0 });
    expect(value.provider.calls).toHaveLength(0);
    const candidate = await value.app.inject({ method: "POST", url: `${root}/proposals/manual-preview`, payload: { repairPlanId: plan.id } });
    expect(candidate.statusCode, candidate.body).toBe(200);
    expect(candidate.json()).toMatchObject({ validation: { status: "valid", errors: [] }, provenance: { mode: "manual-deterministic", providerId: null } });
    const saved = await value.app.inject({ method: "POST", url: `${root}/proposals/manual`, payload: { repairPlanId: plan.id } });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().definitionFingerprint).toBe(candidate.json().definitionFingerprint);
    expect((await value.app.inject({ method: "GET", url: `/api/long-form/projects/${value.projectId}/passage-plan` })).body).toBe(beforePlan);
    expect(value.provider.calls).toHaveLength(0);
    const reopened = (await value.app.inject({ method: "GET", url: `${root}/proposals/${saved.json().id}` })).json();
    expect(reopened.operations).toEqual(saved.json().operations);
    expect(reopened.currentState.status).toBe("current");
  }, 15_000);

  it("requires exact authorization, calls the provider only on Start, and persists the valid proposal", async () => {
    const value = await fixture(); const plan = await savePlan(value, "prose");
    const root = `/api/long-form/projects/${value.projectId}/repair`;
    const preview = (await value.app.inject({ method: "POST", url: `${root}/proposals/generation-preview`, payload: { repairPlanId: plan.id } })).json();
    const created = await value.app.inject({ method: "POST", url: `${root}/proposal-generations`, payload: { repairPlanId: plan.id } });
    expect(created.statusCode, created.body).toBe(201); const generation = created.json();
    expect(generation.generation.fingerprint).toBe(preview.generationFingerprint); expect(value.provider.calls).toHaveLength(0);
    const wrong = await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/authorize`, payload: { fingerprint: "0".repeat(64) } });
    expect(wrong.statusCode).toBe(400); expect(value.provider.calls).toHaveLength(0);
    const authorized = await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/authorize`, payload: { fingerprint: generation.generation.fingerprint } });
    expect(authorized.statusCode, authorized.body).toBe(200); expect(value.provider.calls).toHaveLength(0);
    const started = await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    expect(started.statusCode, started.body).toBe(202);
    const completed = await waitForJob(value.app, value.projectId, generation.generation.id);
    expect(completed.job.status).toBe("completed"); expect(completed.job.proposalId).toMatch(/^rpp_/); expect(value.provider.calls).toHaveLength(1);
    const proposal = (await value.app.inject({ method: "GET", url: `${root}/proposals/${completed.job.proposalId}` })).json();
    expect(proposal).toMatchObject({ provenance: { mode: "ai-assisted", providerId: "offline-repair-proposal" }, validation: { status: "valid" } });
    expect(proposal.operations[0]).toMatchObject({ kind: "create-passage-draft-candidate", requiresUnlock: false });
  }, 15_000);

  it("retains one structural repair and explicit failed-unit retry history", async () => {
    const provider = new DeterministicRepairProposalProvider({ failFirst: true, malformedFirst: true });
    const value = await fixture(provider); const plan = await savePlan(value, "prose"); const root = `/api/long-form/projects/${value.projectId}/repair`;
    const generation = (await value.app.inject({ method: "POST", url: `${root}/proposal-generations`, payload: { repairPlanId: plan.id } })).json();
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/authorize`, payload: { fingerprint: generation.generation.fingerprint } });
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    const failed = await waitForJob(value.app, value.projectId, generation.generation.id);
    expect(failed.job.status).toBe("failed"); expect(failed.job.units[0].attempts).toHaveLength(1);
    const retried = await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/units/${failed.job.units[0].id}/retry` });
    expect(retried.statusCode, retried.body).toBe(200);
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    const completed = await waitForJob(value.app, value.projectId, generation.generation.id);
    expect(completed.job.status).toBe("completed"); expect(completed.job.units[0].attempts).toHaveLength(2);
    expect(completed.job.units[0].attempts[1].repair).toMatchObject({ maximum: 1, performed: 1 });
    expect(provider.calls.map((call) => call.mode)).toEqual(["generate", "generate", "repair"]);
  }, 15_000);

  it("blocks stale authorized work before Start and preserves cancellation", async () => {
    const provider = new DeterministicRepairProposalProvider({ delayMs: 250 });
    const value = await fixture(provider); const plan = await savePlan(value, "prose"); const root = `/api/long-form/projects/${value.projectId}/repair`;
    const first = (await value.app.inject({ method: "POST", url: `${root}/proposal-generations`, payload: { repairPlanId: plan.id } })).json();
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${first.generation.id}/authorize`, payload: { fingerprint: first.generation.fingerprint } });
    const passage = value.passagePlan.passages.find((item: { entityId: string }) => item.entityId === value.passagePlan.structure.content.startPassageId);
    await value.app.inject({ method: "PUT", url: `/api/long-form/projects/${value.projectId}/passage-plan/entities/passage/${passage.entityId}`, payload: { ...passage.content, title: `${passage.content.title} changed` } });
    const staleStart = await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${first.generation.id}/start` });
    expect(staleStart.statusCode).toBe(409); expect(provider.calls).toHaveLength(0);

    const fresh = await fixture(provider); const freshPlan = await savePlan(fresh, "prose"); const freshRoot = `/api/long-form/projects/${fresh.projectId}/repair`;
    const second = (await fresh.app.inject({ method: "POST", url: `${freshRoot}/proposal-generations`, payload: { repairPlanId: freshPlan.id } })).json();
    await fresh.app.inject({ method: "POST", url: `${freshRoot}/proposal-generations/${second.generation.id}/authorize`, payload: { fingerprint: second.generation.fingerprint } });
    await fresh.app.inject({ method: "POST", url: `${freshRoot}/proposal-generations/${second.generation.id}/start` });
    const cancelled = await fresh.app.inject({ method: "POST", url: `${freshRoot}/proposal-generations/${second.generation.id}/cancel` });
    expect(cancelled.statusCode, cancelled.body).toBe(200); expect(cancelled.json().job.status).toBe("cancelled");
    expect(cancelled.json().job.units.every((unit: { status: string }) => unit.status === "cancelled")).toBe(true);
  }, 15_000);

  it("uses the same small output ceiling for generation and structural repair", async () => {
    const provider = new DeterministicRepairProposalProvider({ malformedFirst: true });
    const value = await fixture(provider); const plan = await savePlan(value, "prose"); const root = `/api/long-form/projects/${value.projectId}/repair`;
    const generation = (await value.app.inject({ method: "POST", url: `${root}/proposal-generations`, payload: { repairPlanId: plan.id, policy: { maxOutputTokensPerUnit: 100 } } })).json();
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/authorize`, payload: { fingerprint: generation.generation.fingerprint } });
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    const failed = await waitForJob(value.app, value.projectId, generation.generation.id);
    expect(failed.job.status).toBe("failed"); expect(failed.job.units[0].attempts[0].repair.performed).toBe(1);
    expect(failed.job.units[0].attempts[0].error.validationIssues.join(" ")).toContain("effective output ceiling");
    expect(provider.calls.map((call) => [call.mode, call.maximumOutputTokens])).toEqual([["generate", 100], ["repair", 100]]);
  }, 15_000);

  it("fails the active attempt for a semantically invalid candidate before allowing an explicit retry", async () => {
    const provider = new DeterministicRepairProposalProvider({ invalidSemanticFirst: true });
    const value = await fixture(provider); const plan = await savePlan(value, "prose"); const root = `/api/long-form/projects/${value.projectId}/repair`;
    const generation = (await value.app.inject({ method: "POST", url: `${root}/proposal-generations`, payload: { repairPlanId: plan.id } })).json();
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/authorize`, payload: { fingerprint: generation.generation.fingerprint } });
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    const failed = await waitForJob(value.app, value.projectId, generation.generation.id);
    expect(failed.job.status).toBe("failed");
    expect(failed.job.units[0]).toMatchObject({ status: "failed", candidates: [] });
    expect(failed.job.units[0].attempts[0]).toMatchObject({ status: "failed", repair: { performed: 0 } });
    expect(failed.job.units[0].attempts[0].error.validationIssues.join(" ")).toContain("target/base mismatch");

    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/units/${failed.job.units[0].id}/retry` });
    await value.app.inject({ method: "POST", url: `${root}/proposal-generations/${generation.generation.id}/start` });
    const completed = await waitForJob(value.app, value.projectId, generation.generation.id);
    expect(completed.job.status).toBe("completed");
    expect(completed.job.units[0].attempts.map((attempt: { status: string }) => attempt.status)).toEqual(["failed", "completed"]);
  }, 15_000);
});
