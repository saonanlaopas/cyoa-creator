import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@story-to-cyoa/persistence";
import type { PassageDraftingProviderRequest } from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";
import { DeterministicPassagePlanningProvider } from "../src/services/passage-planning-provider.js";
import { DeterministicPassageDraftingProvider } from "../src/services/passage-drafting-provider.js";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

class BlockingPassageDraftingProvider {
  public readonly id = "blocking-offline-drafting";
  public readonly capabilities = { structuredOutput: true };
  public readonly calls: PassageDraftingProviderRequest[] = [];
  private readonly delegate: DeterministicPassageDraftingProvider;
  private readonly releases = new Map<number, () => void>();
  private readonly startedWaiters = new Map<number, () => void>();

  public constructor(options: { malformedFirstSuccessfulRequest?: boolean } = {}) {
    this.delegate = new DeterministicPassageDraftingProvider(options);
  }

  public async generate(request: PassageDraftingProviderRequest) {
    const index = this.calls.push(request) - 1;
    const gate = new Promise<void>((resolve) => this.releases.set(index, resolve));
    this.startedWaiters.get(index)?.();
    await gate;
    return this.delegate.generate(request);
  }

  public waitForCall(index: number): Promise<void> {
    if (this.calls.length > index) return Promise.resolve();
    return new Promise((resolve) => this.startedWaiters.set(index, resolve));
  }

  public releaseCall(index: number): void {
    const release = this.releases.get(index);
    if (!release) throw new Error(`Blocking provider call ${index} has not started`);
    release();
  }
}

async function createApprovedFixture(app: ReturnType<typeof buildApp>) {
  const created = (await app.inject({
    method: "POST", url: "/api/long-form/projects", payload: { name: "Draft architecture" },
  })).json();
  const projectId = created.project.id as string;
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id },
  });
  let bibleArtifact: { id: string; content: Record<string, unknown> } | undefined;
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const response = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}`,
    })).json();
    if (artifactId === "bible") bibleArtifact = response.bible;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`,
      payload: { versionId: response[artifactId].id },
    });
  }
  const mechanics = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics`,
  })).json();
  const mechanicsSaved = (await app.inject({
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-draft", label: "Draft fixture", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Keep consequences visible."],
      }],
    },
  })).json();
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: mechanicsSaved.mechanics.id },
  });
  const plan = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan`,
  })).json();
  const snapshot = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
  })).json();
  const approved = await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`,
    payload: { snapshotId: snapshot.id },
  });
  expect(approved.statusCode).toBe(201);
  return { projectId, plan, snapshot, bible: bibleArtifact! };
}

async function waitForGeneration(app: ReturnType<typeof buildApp>, projectId: string, jobId: string) {
  for (let index = 0; index < 100; index++) {
    const job = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${jobId}`,
    })).json();
    if (["completed", "partially_failed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Offline planning job did not finish");
}

async function waitForDrafting(app: ReturnType<typeof buildApp>, projectId: string, jobId: string) {
  for (let index = 0; index < 100; index++) {
    const job = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafting/jobs/${jobId}`,
    })).json();
    if (["completed", "partially_failed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Offline drafting job did not finish");
}

async function lockAcceptedProse(
  app: ReturnType<typeof buildApp>, projectId: string, passageId: string, proseMarkdown: string,
) {
  const manual = (await app.inject({
    method: "PUT",
    url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
    payload: { proseMarkdown, authorNote: "Race-regression lock" },
  })).json().draft;
  let versionId = manual.id as string;
  for (const status of ["accepted", "reviewed", "locked"] as const) {
    const transitioned = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/transition`,
      payload: { versionId, status },
    })).json();
    versionId = transitioned.draft.id;
  }
  return { versionId, proseMarkdown };
}

function expectNoCompletedRacePersistence(databasePath: string, jobId: string): void {
  const database = openDatabase(databasePath);
  expect((database.prepare("SELECT COUNT(*) AS count FROM drafting_unit_outputs WHERE job_id = ?")
    .get(jobId) as { count: number }).count).toBe(0);
  expect((database.prepare("SELECT COUNT(*) AS count FROM passage_draft_generation_provenance WHERE job_id = ?")
    .get(jobId) as { count: number }).count).toBe(0);
  expect((database.prepare("SELECT COUNT(*) AS count FROM passage_draft_versions WHERE source_kind = 'generated'")
    .get() as { count: number }).count).toBe(0);
  expect((database.prepare("SELECT status FROM drafting_job_units WHERE job_id = ?")
    .all(jobId) as Array<{ status: string }>).every((item) => item.status !== "completed")).toBe(true);
  expect((database.prepare("SELECT status FROM drafting_unit_attempts WHERE job_id = ?")
    .all(jobId) as Array<{ status: string }>)).toEqual([expect.objectContaining({ status: "failed" })]);
  database.close();
}

describe("Foundation 4B-1 draft architecture API", () => {
  it("saves Unicode manual candidates with exact provenance, immutable history, and restore", async () => {
    const app = buildApp();
    const { projectId, plan } = await createApprovedFixture(app);
    const passage = plan.passages[0];
    const prose = "Fanawë Eterúna walks into 東京. The river remembers.";
    const first = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}`,
      payload: { proseMarkdown: prose, authorNote: "Manual only" },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().draft).toMatchObject({
      version: 1, proseMarkdown: prose, wordCount: 8, lifecycleStatus: "candidate",
      basedOnPassagePlanVersionId: passage.id, sourceKind: "manual",
    });
    expect(Object.keys(first.json().draft.upstreamVersions).sort()).toEqual([
      "bible", "brief", "endings", "mechanics", "routes",
    ]);

    const second = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}`,
      payload: { proseMarkdown: "A second immutable version.", authorNote: "" },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().state.history.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    const restored = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}/restore`,
      payload: { versionId: first.json().draft.id },
    });
    expect(restored.statusCode).toBe(201);
    expect(restored.json().draft).toMatchObject({
      version: 3, proseMarkdown: prose, sourceKind: "restore", restoredFromVersionId: first.json().draft.id,
    });
    expect(restored.json().state.history).toHaveLength(3);
    await app.close();
  });

  it("applies centralized material, cosmetic, unrelated, and upstream staleness rules", async () => {
    const app = buildApp();
    const { projectId, plan, bible: approvedBible } = await createApprovedFixture(app);
    const selected = plan.passages[0];
    const unrelated = plan.passages[1];
    const saved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
      payload: { proseMarkdown: "Current prose stays stored.", authorNote: "" },
    })).json();

    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${unrelated.entityId}`,
      payload: { ...unrelated.content, purpose: `${unrelated.content.purpose} changed` },
    });
    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${selected.entityId}`,
      payload: { ...selected.content, title: "Cosmetic title" },
    });
    let state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current).toMatchObject({ id: saved.draft.id, stale: false, proseMarkdown: "Current prose stays stored." });

    const cosmeticHead = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan`,
    })).json().passages.find((item: { entityId: string }) => item.entityId === selected.entityId);
    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${selected.entityId}`,
      payload: { ...cosmeticHead.content, wordTarget: cosmeticHead.content.wordTarget + 100 },
    });
    state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current.stale).toBe(true);
    expect(state.head.current.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["wordTarget"] }),
    ]));
    expect(state.head.current.proseMarkdown).toBe("Current prose stays stored.");

    const restored = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}/restore`,
      payload: { versionId: saved.draft.id },
    })).json();
    expect(restored.draft.stale).toBe(true);
    expect(restored.draft.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["wordTarget"] }),
    ]));
    const refreshed = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
      payload: { proseMarkdown: restored.draft.proseMarkdown, authorNote: "Fresh against the current passage plan" },
    })).json();
    expect(refreshed.draft.stale).toBe(false);
    const bible = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...approvedBible.content, overview: `${String(approvedBible.content.overview ?? "")} revised` },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });
    state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current.stale).toBe(false);

    const globalBible = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: {
        ...bible.bible.content,
        proseGuidance: {
          ...bible.bible.content.proseGuidance,
          style: [...bible.bible.content.proseGuidance.style, "Use clipped scene endings."],
        },
      },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: globalBible.bible.id },
    });
    state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        reasonCode: "approved-upstream-version-change",
        sourceEntityId: "bible",
        fromVersionId: approvedBible.id,
        toVersionId: globalBible.bible.id,
      }),
    ]));
    await app.close();
  });

  it("uses the same staleness observer when a Foundation 4A proposal applies a material change", async () => {
    const materialUnits: string[] = [];
    const provider = new DeterministicPassagePlanningProvider({ materialPurposeChangeForUnitIds: materialUnits });
    const app = buildApp({ passagePlanningProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const sequenceId = plan.structure.content.sequences[0].id as string;
    const selected = plan.passages.find((item: { content: { sequenceId: string } }) => item.content.sequenceId === sequenceId);
    if (!selected) throw new Error("Expected a passage in the selected sequence");
    const saved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
      payload: { proseMarkdown: "Proposal changes must not erase this prose.", authorNote: "" },
    })).json();
    const generation = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans`, payload: {
        scope: { kind: "sequence", sequenceId },
        providerId: provider.id, modelId: "deterministic-fixture-material-purpose-v1",
      },
    })).json();
    materialUnits.push(...generation.units.map((unit: { id: string }) => unit.id));
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/plans/${generation.id}/authorize`,
      payload: { fingerprint: generation.fingerprint },
    });
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${generation.jobId}/start`,
    });
    expect((await waitForGeneration(app, projectId, generation.jobId)).status).toBe("completed");
    const proposal = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/jobs/${generation.jobId}/proposals`,
    })).json();
    expect(proposal.groups.flatMap((group: { operations: Array<{ entityId: string; fieldDiffs: Array<{ field: string }> }> }) => group.operations)
      .find((operation: { entityId: string }) => operation.entityId === selected.entityId)?.fieldDiffs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "purpose" })]));
    const groupIds = proposal.groups.map((group: { id: string }) => group.id);
    const preview = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/proposals/${proposal.id}/preview`,
      payload: { groupIds },
    })).json();
    expect(preview.valid).toBe(true);
    const applied = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/passage-generation/proposals/${proposal.id}/apply`,
      payload: { groupIds, previewFingerprint: preview.previewFingerprint },
    });
    expect(applied.statusCode).toBe(201);
    const state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${selected.entityId}`,
    })).json();
    expect(state.head.current).toMatchObject({ id: saved.draft.id, stale: true, proseMarkdown: saved.draft.proseMarkdown });
    expect(state.head.current.staleReasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "passage-plan-material-change", changedFields: ["purpose"] }),
    ]));
    await app.close();
  }, 20_000);

  it("previews real immutable contexts and persists bounded generated candidates only after authorized start", async () => {
    const provider = new DeterministicPassageDraftingProvider();
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan, snapshot } = await createApprovedFixture(app);
    const passageIds = plan.passages.map((item: { entityId: string }) => item.entityId);
    const request = {
      scope: { kind: "passages", passageIds }, providerId: provider.id, modelId: "deterministic-prose-v1",
      policy: { maxPassagesPerUnit: 1000, maxAttemptsPerUnit: 1000, maxOutputTokensPerUnit: 999_999 },
    };
    const preview = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/preview`, payload: request,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      snapshotId: snapshot.id,
      policy: { maxPassagesPerUnit: 8, maxAttemptsPerUnit: 3, maxOutputTokensPerUnit: 12_000 },
    });
    expect(preview.json().units.length).toBeGreaterThan(0);
    expect(preview.json().units.every((unit: { contextDiagnostics: { status: string }; context: unknown; contextFingerprint: string }) =>
      unit.contextDiagnostics.status === "built" && Boolean(unit.context) && unit.contextFingerprint.length === 64)).toBe(true);
    expect(provider.calls).toHaveLength(0);
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`, payload: request,
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    })).statusCode).toBe(200);
    expect(provider.calls).toHaveLength(0);
    const started = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    expect(started.statusCode).toBe(200);
    const finished = await waitForDrafting(app, projectId, created.jobId);
    expect(finished.status).toBe("completed");
    expect(provider.calls.filter((call) => call.mode === "generate")).toHaveLength(created.units.length);
    expect(provider.calls[0]).toMatchObject({
      boundedContext: created.units[0].context,
      maximumOutputTokens: created.units[0].estimatedOutputTokens,
      contextFingerprint: created.units[0].contextFingerprint,
    });
    expect(provider.calls[0].signal).toBeInstanceOf(AbortSignal);
    expect(finished.units.every((unit: { generatedCandidates: unknown[] }) => unit.generatedCandidates.length > 0)).toBe(true);
    expect(finished.units[0].usage).toMatchObject({ inputTokens: expect.any(Number), outputTokens: expect.any(Number), cost: 0 });
    const summary = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/summary`,
    })).json();
    expect(summary.currentDraftCount).toBe(passageIds.length);
    expect(summary.acceptedDraftCount).toBe(0);
    const generated = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageIds[0]}`,
    })).json().head.current;
    expect(generated).toMatchObject({
      sourceKind: "generated",
      lifecycleStatus: "candidate",
      generationPlanId: created.id,
      generationJobId: created.jobId,
    });
    expect(generated.generationProvenance).toMatchObject({
      providerId: provider.id,
      contextFingerprint: created.units[0].contextFingerprint,
      outputSchemaId: "cyoa.passage-drafting-unit-output",
      outputSchemaVersion: 1,
    });
    await app.close();
  });

  it("recovers an interrupted generation job after reopening without inferring candidate success", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-drafting-api-recovery-"));
    directories.push(directory);
    const databasePath = join(directory, "story.sqlite");
    const app = buildApp({ databasePath, passageDraftingProvider: new DeterministicPassageDraftingProvider({ delayMs: 500 }) });
    const { projectId, plan } = await createApprovedFixture(app);
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [plan.passages[0].entityId] } },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await app.close();

    const reopened = buildApp({ databasePath });
    const recovered = (await reopened.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}`,
    })).json();
    expect(recovered.status).toBe("failed");
    expect(recovered.units[0]).toMatchObject({ status: "failed", attemptNumber: 1 });
    expect((await reopened.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/summary`,
    })).json().currentDraftCount).toBe(0);
    await reopened.close();
  });

  it("performs at most one structural repair and records the exact successful attempt provenance", async () => {
    const provider = new DeterministicPassageDraftingProvider({ malformedFirstSuccessfulRequest: true });
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const passageId = plan.passages[0].entityId as string;
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [passageId] }, providerId: provider.id, modelId: "deterministic-prose-v1" },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    const finished = await waitForDrafting(app, projectId, created.jobId);
    expect(finished.status).toBe("completed");
    expect(provider.calls.map((call) => call.mode)).toEqual(["generate", "repair"]);
    const draft = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
    })).json().head.current;
    expect(draft.generationProvenance.repair).toMatchObject({ maximumRepairs: 1, repairsPerformed: 1 });
    expect(draft.generationProvenance.attemptId).toBeTruthy();
    await app.close();
  });

  it("blocks a stale authorized plan before provider activity", async () => {
    const provider = new DeterministicPassageDraftingProvider();
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const passage = plan.passages[0];
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [passage.entityId] }, providerId: provider.id },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${passage.entityId}`,
      payload: { ...passage.content, purpose: `${passage.content.purpose} materially changed` },
    });
    const start = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start`,
    });
    expect(start.statusCode).toBe(409);
    expect(start.json()).toMatchObject({ code: "stale_drafting_plan", retryable: false });
    expect(start.json().error).toContain("approved passage-plan snapshot");
    expect(provider.calls).toHaveLength(0);
    await app.close();
  });

  it.each(["choice", "thread", "structure", "snapshot"] as const)(
    "blocks an authorized plan after %s state changes with zero provider calls",
    async (mutation) => {
      const provider = new DeterministicPassageDraftingProvider();
      const app = buildApp({ passageDraftingProvider: provider });
      const { projectId, plan } = await createApprovedFixture(app);
      let approvedPlan = plan;
      if (mutation === "thread" && approvedPlan.threads.length === 0) {
        const passageId = approvedPlan.passages[0].entityId as string;
        const saved = await app.inject({
          method: "PUT",
          url: `/api/long-form/projects/${projectId}/passage-plan/entities/thread/thread-review-fixture`,
          payload: {
            id: "thread-review-fixture",
            label: "Review fixture",
            description: "A thread captured by the approved graph.",
            setupPassageIds: [passageId],
            payoffPassageIds: [],
            routeIds: [],
            required: false,
            status: "planned",
            waiverRationale: "",
          },
        });
        expect(saved.statusCode).toBe(201);
        const snapshot = (await app.inject({
          method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
        })).json();
        const approved = await app.inject({
          method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`,
          payload: { snapshotId: snapshot.id },
        });
        expect(approved.statusCode).toBe(201);
        approvedPlan = (await app.inject({
          method: "GET", url: `/api/long-form/projects/${projectId}/passage-plan`,
        })).json();
      }
      const created = (await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
        payload: {
          scope: { kind: "passages", passageIds: [approvedPlan.passages[0].entityId] },
          providerId: provider.id,
        },
      })).json();
      await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
        payload: { fingerprint: created.fingerprint },
      });

      if (mutation === "choice") {
        const choice = plan.choices[0];
        if (!choice) throw new Error("Expected a choice fixture");
        const changed = await app.inject({
          method: "PUT",
          url: `/api/long-form/projects/${projectId}/passage-plan/entities/choice/${choice.entityId}`,
          payload: { ...choice.content, label: `${choice.content.label} changed` },
        });
        expect(changed.statusCode).toBe(201);
      } else if (mutation === "thread") {
        const thread = approvedPlan.threads[0];
        if (!thread) throw new Error("Expected a thread fixture");
        const changed = await app.inject({
          method: "PUT",
          url: `/api/long-form/projects/${projectId}/passage-plan/entities/thread/${thread.entityId}`,
          payload: { ...thread.content, description: `${thread.content.description} changed` },
        });
        expect(changed.statusCode).toBe(201);
      } else if (mutation === "structure") {
        const changed = await app.inject({
          method: "PUT",
          url: `/api/long-form/projects/${projectId}/passage-plan/structure`,
          payload: { ...plan.structure.content, title: `${plan.structure.content.title} changed` },
        });
        expect(changed.statusCode).toBe(201);
      } else {
        const replacement = (await app.inject({
          method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
        })).json();
        const approved = await app.inject({
          method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`,
          payload: { snapshotId: replacement.id },
        });
        expect(approved.statusCode).toBe(201);
      }

      const start = await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start`,
      });
      expect(start.statusCode).toBe(409);
      expect(start.json()).toMatchObject({ code: "stale_drafting_plan", retryable: false });
      expect(provider.calls).toHaveLength(0);
      const job = (await app.inject({
        method: "GET", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}`,
      })).json();
      expect(job.status).toBe("authorized");
      expect(job.units[0].status).toBe("pending");
      await app.close();
    },
  );

  it.each(["passage", "choice"] as const)(
    "rejects an obsolete candidate when a %s changes during a blocked provider request",
    async (mutation) => {
      const directory = mkdtempSync(join(tmpdir(), `cyoa-drafting-${mutation}-race-`));
      directories.push(directory);
      const databasePath = join(directory, "story.sqlite");
      const provider = new BlockingPassageDraftingProvider();
      const app = buildApp({ databasePath, passageDraftingProvider: provider });
      const { projectId, plan } = await createApprovedFixture(app);
      const target = plan.passages[0];
      const protectedPassage = plan.passages[1];
      if (!target || !protectedPassage) throw new Error("Expected two passage fixtures");
      const locked = await lockAcceptedProse(
        app, projectId, protectedPassage.entityId, "Locked prose must survive the generation race.",
      );
      const created = (await app.inject({
        method: "POST",
        url: `/api/long-form/projects/${projectId}/drafting/plans`,
        payload: {
          scope: { kind: "passages", passageIds: [target.entityId] },
          providerId: provider.id,
          modelId: "blocking-race-v1",
        },
      })).json();
      await app.inject({
        method: "POST",
        url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
        payload: { fingerprint: created.fingerprint },
      });
      const started = await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start`,
      });
      expect(started.statusCode).toBe(200);
      await provider.waitForCall(0);

      if (mutation === "passage") {
        const changed = await app.inject({
          method: "PUT",
          url: `/api/long-form/projects/${projectId}/passage-plan/entities/passage/${target.entityId}`,
          payload: { ...target.content, purpose: `${target.content.purpose} changed in flight` },
        });
        expect(changed.statusCode).toBe(201);
      } else {
        const choice = plan.choices[0];
        if (!choice) throw new Error("Expected a choice fixture");
        const changed = await app.inject({
          method: "PUT",
          url: `/api/long-form/projects/${projectId}/passage-plan/entities/choice/${choice.entityId}`,
          payload: { ...choice.content, label: `${choice.content.label} changed in flight` },
        });
        expect(changed.statusCode).toBe(201);
      }
      provider.releaseCall(0);

      const finished = await waitForDrafting(app, projectId, created.jobId);
      expect(finished.status).toBe("failed");
      expect(finished.units[0]).toMatchObject({
        status: "failed",
        normalizedError: { code: "stale_drafting_plan", retryable: false },
        generatedCandidates: [],
      });
      expect(provider.calls.map((call) => call.mode)).toEqual(["generate"]);
      const targetDraft = (await app.inject({
        method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${target.entityId}`,
      })).json();
      expect(targetDraft.head).toBeNull();
      const protectedState = (await app.inject({
        method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${protectedPassage.entityId}`,
      })).json();
      expect(protectedState.head).toMatchObject({
        acceptedLocked: true,
        accepted: { id: locked.versionId, proseMarkdown: locked.proseMarkdown, lifecycleStatus: "locked" },
      });
      await app.close();
      expectNoCompletedRacePersistence(databasePath, created.jobId);
    },
  );

  it("rejects repaired output when passage-plan structure changes during the repair request", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-drafting-repair-race-"));
    directories.push(directory);
    const databasePath = join(directory, "story.sqlite");
    const provider = new BlockingPassageDraftingProvider({ malformedFirstSuccessfulRequest: true });
    const app = buildApp({ databasePath, passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const target = plan.passages[0];
    const protectedPassage = plan.passages[1];
    if (!target || !protectedPassage) throw new Error("Expected two passage fixtures");
    const locked = await lockAcceptedProse(
      app, projectId, protectedPassage.entityId, "Locked prose must survive the repair race.",
    );
    const created = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: {
        scope: { kind: "passages", passageIds: [target.entityId] },
        providerId: provider.id,
        modelId: "blocking-repair-race-v1",
      },
    })).json();
    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start`,
    });
    await provider.waitForCall(0);
    provider.releaseCall(0);
    await provider.waitForCall(1);
    expect(provider.calls.map((call) => call.mode)).toEqual(["generate", "repair"]);

    const changed = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/passage-plan/structure`,
      payload: { ...plan.structure.content, title: `${plan.structure.content.title} changed during repair` },
    });
    expect(changed.statusCode).toBe(201);
    provider.releaseCall(1);

    const finished = await waitForDrafting(app, projectId, created.jobId);
    expect(finished.status).toBe("failed");
    expect(finished.units[0]).toMatchObject({
      status: "failed",
      normalizedError: { code: "stale_drafting_plan", retryable: false },
      generatedCandidates: [],
    });
    const protectedState = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${protectedPassage.entityId}`,
    })).json();
    expect(protectedState.head).toMatchObject({
      acceptedLocked: true,
      accepted: { id: locked.versionId, proseMarkdown: locked.proseMarkdown, lifecycleStatus: "locked" },
    });
    await app.close();
    expectNoCompletedRacePersistence(databasePath, created.jobId);
  });

  it("keeps locked accepted prose fixed when generation creates a newer current candidate", async () => {
    const app = buildApp();
    const { projectId, plan } = await createApprovedFixture(app);
    const passageId = plan.passages[0].entityId as string;
    const manual = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
      payload: { proseMarkdown: "This accepted text must remain fixed.", authorNote: "" },
    })).json().draft;
    let versionId = manual.id as string;
    for (const status of ["accepted", "reviewed", "locked"] as const) {
      const transitioned = (await app.inject({
        method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}/transition`,
        payload: { versionId, status },
      })).json();
      versionId = transitioned.draft.id;
    }
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [passageId] } },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    expect((await waitForDrafting(app, projectId, created.jobId)).status).toBe("completed");
    const state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
    })).json();
    expect(state.head.current).toMatchObject({ sourceKind: "generated", lifecycleStatus: "candidate" });
    expect(state.head.accepted).toMatchObject({ id: versionId, proseMarkdown: "This accepted text must remain fixed.", lifecycleStatus: "locked" });
    expect(state.head.acceptedLocked).toBe(true);
    await app.close();
  });

  it("aborts in-flight generation on cancellation and prevents a late candidate commit", async () => {
    const provider = new DeterministicPassageDraftingProvider({ delayMs: 500 });
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const passageId = plan.passages[0].entityId as string;
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [passageId] }, providerId: provider.id },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelled = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/cancel`,
    })).json();
    expect(cancelled.status).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
    })).json();
    expect(state.head).toBeNull();
    expect(provider.calls[0]?.signal.aborted).toBe(true);
    await app.close();
  });

  it("retries only a failed unit and links its candidate to the retry attempt without repeating completed siblings", async () => {
    const failUnits: string[] = [];
    const provider = new DeterministicPassageDraftingProvider({ failFirstAttemptForUnitIds: failUnits });
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const passageIds = plan.passages.slice(0, 9).map((item: { entityId: string }) => item.entityId);
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds }, providerId: provider.id },
    })).json();
    expect(created.units.length).toBeGreaterThan(1);
    failUnits.push(created.units[0].id);
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    const first = await waitForDrafting(app, projectId, created.jobId);
    expect(first.status).toBe("partially_failed");
    const failed = first.units[0];
    const completedSibling = first.units[1];
    expect(failed.status).toBe("failed");
    expect(completedSibling.status).toBe("completed");
    const siblingCalls = provider.calls.filter((call) => call.mode === "generate" && call.unitId === completedSibling.id).length;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/units/${failed.id}/retry`,
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    const retried = await waitForDrafting(app, projectId, created.jobId);
    expect(retried.status).toBe("completed");
    expect(retried.units[0].attemptNumber).toBe(2);
    expect(provider.calls.filter((call) => call.mode === "generate" && call.unitId === completedSibling.id)).toHaveLength(siblingCalls);
    const retriedPassage = retried.units[0].generatedCandidates[0].passageId;
    const draft = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${retriedPassage}`,
    })).json().head.current;
    expect(draft.generationProvenance.attemptId).not.toBe(retried.units[0].retryOfAttemptId);
    expect(draft.generationProvenance.attemptId).toBeTruthy();
    await app.close();
  });

  it.each([
    ["deterministic-prose-invalid-v1", 2, "drafting_output_validation_failed"],
    ["deterministic-prose-oversized-v1", 1, "drafting_output_validation_failed"],
  ])("fails bounded model fixture %s without unbounded or quality repair", async (modelId, expectedCalls, code) => {
    const provider = new DeterministicPassageDraftingProvider();
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const passageId = plan.passages[0].entityId as string;
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [passageId] }, providerId: provider.id, modelId },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    const failed = await waitForDrafting(app, projectId, created.jobId);
    expect(failed.status).toBe("failed");
    expect(provider.calls).toHaveLength(expectedCalls);
    expect(failed.units[0].normalizedError).toMatchObject({ code });
    expect((await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/drafts/passages/${passageId}`,
    })).json().head).toBeNull();
    await app.close();
  });

  it("redacts provider secrets from persisted drafting errors and API responses", async () => {
    const secret = "sk-or-v1-never-persist-this";
    const provider = {
      id: "secret-failure-drafting",
      capabilities: { structuredOutput: true },
      calls: 0,
      async generate() {
        this.calls += 1;
        throw Object.assign(new Error(`Provider rejected ${secret}`), { code: "provider_rejected", retryable: false });
      },
    };
    const app = buildApp({ passageDraftingProvider: provider });
    const { projectId, plan } = await createApprovedFixture(app);
    const created = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans`,
      payload: { scope: { kind: "passages", passageIds: [plan.passages[0].entityId] }, providerId: provider.id },
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/drafting/plans/${created.id}/authorize`,
      payload: { fingerprint: created.fingerprint },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/drafting/jobs/${created.jobId}/start` });
    const failed = await waitForDrafting(app, projectId, created.jobId);
    expect(failed.status).toBe("failed");
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(JSON.stringify(failed)).toContain("[REDACTED]");
    await app.close();
  });
});
