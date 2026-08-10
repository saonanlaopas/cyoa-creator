import { afterEach, describe, expect, it } from "vitest";
import type { PassageDraftingProvider, PassageDraftingProviderRequest } from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";
import { DeterministicPassageDraftingProvider } from "../src/services/passage-drafting-provider.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });

class CountingProvider implements PassageDraftingProvider {
  readonly id = "counting-offline";
  readonly capabilities = { structuredOutput: true };
  readonly calls: PassageDraftingProviderRequest[] = [];
  private readonly delegate = new DeterministicPassageDraftingProvider();
  async generate(request: PassageDraftingProviderRequest) {
    this.calls.push(request);
    return this.delegate.generate(request);
  }
}

async function setup(provider?: PassageDraftingProvider) {
  const app = buildApp({ passageDraftingProvider: provider });
  apps.push(app);
  const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Review" } })).json();
  const projectId = created.project.id as string;
  await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}` })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`,
      payload: { versionId: generated[artifactId].id },
    });
  }
  const mechanics = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/mechanics` })).json();
  const savedMechanics = (await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-review", label: "Review fixture", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Keep consequences visible."],
      }],
    },
  })).json();
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: savedMechanics.mechanics.id },
  });
  const plan = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  const snapshot = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` })).json();
  const approved = await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id },
  });
  expect(approved.statusCode).toBe(201);
  return { app, projectId, passageId: plan.passages[0].entityId as string };
}

async function saveCandidate(app: ReturnType<typeof buildApp>, projectId: string, passageId: string, proseMarkdown: string) {
  const response = await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
    payload: { proseMarkdown, authorNote: "Review note" },
  });
  expect(response.statusCode).toBe(201);
  return response.json().draft as { id: string };
}

async function preview(app: ReturnType<typeof buildApp>, projectId: string, passageId: string, candidateId: string) {
  const response = await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/preview`,
    payload: { selections: [{ passageId, candidateDraftVersionId: candidateId }] },
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

describe("passage draft review API", () => {
  it("reviews, compares, accepts, advances, locks, unlocks, and replaces prose without provider calls", async () => {
    const provider = new CountingProvider();
    const { app, projectId, passageId } = await setup(provider);
    const first = await saveCandidate(app, projectId, passageId, "<script>window.hacked=true</script>\n\nReadable first prose.");
    const firstPreview = await preview(app, projectId, passageId, first.id);
    expect(firstPreview).toMatchObject({ valid: true, issues: [], downstreamStaleness: [] });
    expect(provider.calls).toHaveLength(0);
    const acceptedResponse = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
      payload: { selections: firstPreview.selections, previewFingerprint: firstPreview.fingerprint },
    });
    expect(acceptedResponse.statusCode).toBe(201);
    expect(provider.calls).toHaveLength(0);
    let state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}` })).json();
    expect(state.head.accepted).toMatchObject({ lifecycleStatus: "accepted", proseMarkdown: expect.stringContaining("<script>") });
    expect(state.history).toHaveLength(2);
    expect(state.acceptanceHistory[0].selectedCandidates[0].candidateDraftVersionId).toBe(first.id);

    const comparison = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/compare`,
      query: { afterVersionId: first.id },
    })).json();
    expect(comparison).toMatchObject({ before: null, after: { id: first.id }, paragraphs: expect.arrayContaining([
      expect.objectContaining({ kind: "added", text: expect.stringContaining("<script>") }),
    ]) });
    expect(provider.calls).toHaveLength(0);

    const replacement = await saveCandidate(app, projectId, passageId, "Separate replacement candidate.");
    let acceptedId = state.head.accepted.id as string;
    const reviewed = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/transition`,
      payload: { versionId: acceptedId, status: "reviewed" },
    });
    expect(reviewed.statusCode).toBe(201);
    acceptedId = reviewed.json().draft.id;
    const locked = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/transition`,
      payload: { versionId: acceptedId, status: "locked" },
    });
    expect(locked.statusCode).toBe(201);
    const lockedId = locked.json().draft.id as string;
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}` })).json();
    expect(state.head).toMatchObject({
      current: { id: replacement.id, lifecycleStatus: "candidate" },
      accepted: { id: lockedId, lifecycleStatus: "locked" },
      acceptedLocked: true,
    });
    const blocked = await preview(app, projectId, passageId, replacement.id);
    expect(blocked).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ code: "locked_accepted_replacement" })]) });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}` })).json();
    expect(state.head.accepted.id).toBe(lockedId);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/unlock` });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}` })).json();
    expect(state.head).toMatchObject({ accepted: { id: lockedId }, acceptedLocked: false });
    const replacementPreview = await preview(app, projectId, passageId, replacement.id);
    const replacementApply = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
      payload: { selections: replacementPreview.selections, previewFingerprint: replacementPreview.fingerprint },
    });
    expect(replacementApply.statusCode).toBe(201);
    expect(provider.calls).toHaveLength(0);
  }, 15_000);

  it("rejects a changed preview with a structured stale-preview response", async () => {
    const { app, projectId, passageId } = await setup();
    const first = await saveCandidate(app, projectId, passageId, "Previewed candidate.");
    const stalePreview = await preview(app, projectId, passageId, first.id);
    await saveCandidate(app, projectId, passageId, "Competing current candidate.");
    const response = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
      payload: { selections: stalePreview.selections, previewFingerprint: stalePreview.fingerprint },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "stale_acceptance_preview",
      currentPreview: { valid: true, selections: [{ candidateDraftVersionId: first.id }] },
    });
  });

  it("accepts a generated candidate only after explicit generation and explicit human acceptance", async () => {
    const provider = new CountingProvider();
    const { app, projectId, passageId } = await setup(provider);
    const request = { scope: { kind: "passages", passageIds: [passageId] }, providerId: provider.id, modelId: "deterministic-prose-v1" };
    const plan = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`, payload: request })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${plan.id}/authorize`, payload: { fingerprint: plan.fingerprint } });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${plan.jobId}/start` });
    let job: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 100; attempt += 1) {
      job = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafting/jobs/${plan.jobId}` })).json();
      if (["completed", "partially_failed", "failed"].includes(String(job.status))) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(job.status).toBe("completed");
    expect(provider.calls).toHaveLength(1);
    const before = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}` })).json();
    expect(before.head).toMatchObject({ current: { sourceKind: "generated", lifecycleStatus: "candidate" }, accepted: null });
    const generatedId = before.head.current.id as string;
    const exactPreview = await preview(app, projectId, passageId, generatedId);
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
      payload: { selections: exactPreview.selections, previewFingerprint: exactPreview.fingerprint },
    });
    expect(provider.calls).toHaveLength(1);
    const after = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}` })).json();
    expect(after.head.accepted).toMatchObject({ sourceKind: "lifecycle", generationProvenance: { providerId: provider.id } });
    expect(after.history.find((version: { id: string }) => version.id === generatedId)).toMatchObject({ lifecycleStatus: "candidate" });
  });

  it("returns a compact 300-passage review queue without prose bodies", async () => {
    const { app, projectId } = await setup();
    const planState = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
    const existing = planState.passages.map((item: { content: Record<string, unknown> }) => item.content);
    const template = existing[0];
    const passages = Array.from({ length: 300 }, (_, index) => ({
      ...template, id: `passage-${String(index + 1).padStart(3, "0")}`, title: `Queue passage ${index + 1}`,
      position: index, terminal: true, choiceIds: [],
    }));
    const save = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan`,
      payload: { schemaVersion: 1, structure: { ...planState.structure.content, startPassageId: passages[0].id,
        sequences: planState.structure.content.sequences.map((sequence: Record<string, unknown>, index: number) => ({
          ...sequence, passageIds: index === 0 ? passages.map((passage) => passage.id) : [],
        })) }, passages, choices: [], threads: planState.threads.map((item: { content: unknown }) => item.content) },
    });
    expect(save.statusCode).toBe(201);
    const queue = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/drafts/review-queue` })).json();
    expect(queue.items).toHaveLength(300);
    expect(queue.items[0]).toMatchObject({ passageId: "passage-001", title: "Queue passage 1", currentStatus: "no-draft" });
    expect(JSON.stringify(queue.items)).not.toContain("proseMarkdown");
  });
});
