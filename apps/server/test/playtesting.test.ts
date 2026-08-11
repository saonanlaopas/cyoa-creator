import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@story-to-cyoa/persistence";
import {
  DEFAULT_DETERMINISTIC_PATH_POLICY,
  compileRuntime,
  createPlaytestPolicy,
  runPlaytestCampaign,
  stableFingerprint,
  type RuntimeCompileSource,
} from "@story-to-cyoa/runtime";
import { buildApp } from "../src/app.js";
import {
  buildPlaytestAnalysisSource,
  deriveAcceptedDraftCleanliness,
} from "../src/services/playtest-service.js";
import type { ResolvedSimulationInput } from "../src/services/simulation-service.js";

const apps: ReturnType<typeof buildApp>[] = [];
async function closeApps() { for (const app of apps.splice(0)) await app.close(); }
afterEach(closeApps);

async function approvedProject(databasePath?: string, name = "Seeded playtesting") {
  const app = buildApp({ databasePath });
  apps.push(app);
  const created = (await app.inject({
    method: "POST", url: "/api/long-form/projects", payload: { name },
  })).json();
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
        id: "effect-playtesting", label: "Playtesting effects", sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Exercise deterministic state."],
      }],
    },
  })).json();
  await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: savedMechanics.mechanics.id },
  });
  const plan = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` })).json();
  const snapshot = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots`,
  })).json();
  expect((await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id },
  })).statusCode).toBe(201);
  const input = (await app.inject({
    method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs`,
  })).json();
  return { app, projectId, plan, snapshot, input };
}

function sampleIdentity(sample: Record<string, unknown>) {
  const { id: _id, fingerprint: _fingerprint, ...identity } = sample;
  const fingerprint = stableFingerprint(identity);
  return { ...identity, id: `pts_${fingerprint}`, fingerprint };
}

function immutableDraftFixture() {
  const passageIds = ["passage-a", "passage-b", "passage-c", "passage-d", "passage-e", "passage-f", "passage-g"];
  const passageVersions = Object.fromEntries(passageIds.map((id) => [id, `pv-${id}`]));
  const acceptedDraftVersions = Object.fromEntries(passageIds.filter((id) => id !== "passage-e")
    .map((id) => [id, `draft-${id}`]));
  const upstreamVersions = { brief: "brief-v1", bible: "bible-v1", routes: "routes-v1", endings: "endings-v1", mechanics: "mechanics-v1" };
  const neighborVersions: Record<string, Record<string, string>> = {
    "passage-a": {},
    "passage-b": { "passage-a": "draft-passage-a" },
    "passage-c": { "passage-b": "draft-passage-b" },
    "passage-d": {},
    "passage-f": { "passage-g": "draft-passage-g" },
    "passage-g": { "passage-c": "draft-passage-c", "passage-f": "draft-passage-f" },
  };
  const wordCounts: Record<string, number> = {
    "passage-a": 100, "passage-b": 200, "passage-c": 300, "passage-d": 400,
    "passage-f": 600, "passage-g": 700,
  };
  const drafts = Object.keys(acceptedDraftVersions).map((passageId) => ({
    id: acceptedDraftVersions[passageId]!, passageId,
    basedOnPassagePlanVersionId: passageVersions[passageId]!, upstreamVersions: { ...upstreamVersions },
    neighboringDraftVersions: neighborVersions[passageId] ?? {}, wordCount: wordCounts[passageId]!,
  }));
  const passages = passageIds.map((id, index) => ({
    id, title: id, sequenceId: "sequence-drafts", routeIds: [] as string[], wordTarget: (index + 1) * 100,
    choiceIds: index < 4 ? [`choice-${index}`] : [], requiredFactIds: [] as string[], revealedFactIds: [] as string[],
    setupThreadIds: [] as string[], payoffThreadIds: [] as string[], relationshipIds: [] as string[],
  }));
  const resolved = {
    input: {
      passageVersions: Object.entries(passageVersions).map(([entityId, versionId]) => ({ entityId, versionId })),
      acceptedDraftVersions: Object.entries(acceptedDraftVersions).map(([entityId, versionId]) => ({ entityId, versionId })),
      upstreamVersions,
    },
    structure: { sequences: [{ id: "sequence-drafts", actId: "act-drafts" }] },
    acceptedDrafts: drafts,
    passages,
    threads: [],
    routes: { routes: [], decisionPoints: [] },
    endings: { endings: [] },
    mechanics: { visibleStats: [], relationships: [], flags: [], resources: [] },
  } as unknown as ResolvedSimulationInput;
  return { resolved, drafts, passageVersions, acceptedDraftVersions, upstreamVersions };
}

describe("Foundation 5B playtest API", () => {
  it("derives accepted-prose cleanliness transitively from immutable provenance and handles dependency cycles", () => {
    const fixture = immutableDraftFixture();
    const clean = deriveAcceptedDraftCleanliness({
      passageVersions: fixture.passageVersions,
      acceptedDraftVersions: fixture.acceptedDraftVersions,
      upstreamVersions: fixture.upstreamVersions,
      drafts: fixture.drafts,
    });
    expect(clean).toMatchObject({
      "passage-a": true, "passage-b": true, "passage-c": true, "passage-d": true,
      "passage-f": true, "passage-g": true,
    });

    const invalidDrafts = fixture.drafts.map((draft) => draft.passageId === "passage-a"
      ? { ...draft, basedOnPassagePlanVersionId: "pv-obsolete-a" } : draft);
    const invalidResolved = { ...fixture.resolved, acceptedDrafts: invalidDrafts } as ResolvedSimulationInput;
    const analysis = buildPlaytestAnalysisSource(invalidResolved);
    expect(analysis.passages["passage-a"]?.wordBasis).toBe("historical-stale-accepted");
    expect(analysis.passages["passage-b"]?.wordBasis).toBe("historical-stale-accepted");
    expect(analysis.passages["passage-c"]?.wordBasis).toBe("historical-stale-accepted");
    expect(analysis.passages["passage-d"]?.wordBasis).toBe("accepted-prose");
    expect(analysis.passages["passage-e"]?.wordBasis).toBe("planned-target");
    expect(analysis.passages["passage-f"]?.wordBasis).toBe("historical-stale-accepted");
    expect(analysis.passages["passage-g"]?.wordBasis).toBe("historical-stale-accepted");

    const runtimeSource: RuntimeCompileSource = {
      snapshotId: "snapshot-draft-closure", structureVersionId: "structure-draft-closure", startPassageId: "passage-a",
      passageVersions: ["passage-a", "passage-b", "passage-c", "passage-d", "passage-e"].map((id, index) => ({
        versionId: fixture.passageVersions[id]!, id, choiceIds: index < 4 ? [`choice-${index}`] : [],
        terminal: index === 4, endingId: index === 4 ? "ending-drafts" : null,
        routeIds: index === 4 ? ["route-drafts"] : [], requiredFactIds: [], revealedFactIds: [],
      })),
      choiceVersions: Array.from({ length: 4 }, (_, index) => ({
        versionId: `cv-${index}`, id: `choice-${index}`,
        sourcePassageId: `passage-${String.fromCharCode(97 + index)}`,
        destinationPassageId: `passage-${String.fromCharCode(98 + index)}`,
        condition: null, unavailableBehavior: "disabled" as const, unavailableExplanation: "",
        effects: [], sourceDecisionIds: [], position: 0,
      })),
      threadVersionIds: [], routeIds: ["route-drafts"], routeDecisionIds: [],
      endings: [{ id: "ending-drafts", routeId: "route-drafts" }],
      mechanics: { visibleStats: [], relationships: [], flags: [], resources: [], gates: [] },
    };
    const runtime = compileRuntime(runtimeSource);
    const policy = createPlaytestPolicy({ sampleCount: 1, maxStepsPerSample: 10 }, DEFAULT_DETERMINISTIC_PATH_POLICY);
    const campaignInput = {
      identity: {
        projectId: "project-draft-closure", simulationInputArtifactVersionId: "input-draft-closure",
        simulationInputFingerprint: "draft-closure-input", compiledRuntimeFingerprint: runtime.fingerprint,
        snapshotId: runtimeSource.snapshotId, seed: "draft-closure",
      },
      runtime, source: analysis, policy,
    };
    const first = runPlaytestCampaign(campaignInput);
    const second = runPlaytestCampaign(campaignInput);
    expect(second).toEqual(first);
    expect(first.samples[0]?.words).toEqual({
      total: 1_500, basis: "historical-stale-accepted", acceptedWords: 400,
      plannedWords: 500, historicalStaleAcceptedWords: 600,
    });

    const invalidCycle = fixture.drafts.map((draft) => draft.passageId === "passage-f"
      ? { ...draft, basedOnPassagePlanVersionId: "pv-obsolete-f" } : draft);
    const cycleCleanliness = deriveAcceptedDraftCleanliness({
      passageVersions: fixture.passageVersions,
      acceptedDraftVersions: fixture.acceptedDraftVersions,
      upstreamVersions: fixture.upstreamVersions,
      drafts: invalidCycle,
    });
    expect(cycleCleanliness["passage-f"]).toBe(false);
    expect(cycleCleanliness["passage-g"]).toBe(false);
  });

  it("previews backend bounds, persists deterministic campaigns, exposes compact metadata, and replays a sample", async () => {
    const fixture = await approvedProject();
    const canonicalBefore = (await fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan`,
    })).json();
    const policy = await fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/policy`, payload: {
        inputArtifactVersionId: fixture.input.id,
        policy: { sampleCount: 12, maxStepsPerSample: 40, linearStretchThreshold: 3, denseChoiceThreshold: 4 },
      },
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json()).toMatchObject({
      inputArtifactVersionId: fixture.input.id,
      inputFingerprint: fixture.input.content.fingerprint,
      policy: {
        version: "foundation-5b-v1", prngVersion: "xorshift32-fnv1a-v1",
        strategyVersion: "coverage-aware-v1", sampleCount: 12, maxStepsPerSample: 40,
      },
    });

    const created = await fixture.app.inject({
      method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`, payload: {
        inputArtifactVersionId: fixture.input.id,
        seed: "server-fixed-seed",
        policy: { sampleCount: 12, maxStepsPerSample: 40, linearStretchThreshold: 3, denseChoiceThreshold: 4 },
      },
    });
    expect(created.statusCode).toBe(201);
    const campaignVersion = created.json();
    expect(campaignVersion.content).toMatchObject({
      schemaVersion: 2,
      projectId: fixture.projectId,
      simulationInputArtifactVersionId: fixture.input.id,
      simulationInputFingerprint: fixture.input.content.fingerprint,
      compiledRuntimeFingerprint: fixture.input.content.runtimeFingerprint,
      snapshotId: fixture.snapshot.id,
      seed: "server-fixed-seed",
      requestedSampleCount: 12,
      actualSampleCount: 12,
      status: "completed",
      findingRetention: {
        totalFindingCount: expect.any(Number), retainedFindingCount: expect.any(Number),
        omittedFindingCount: 0, truncated: false, aggregateReportFindingBasis: "all-generated-findings",
      },
    });
    expect(campaignVersion.content.samples).toHaveLength(12);
    expect(campaignVersion.content.retainedTraces.length).toBeLessThanOrEqual(12);
    expect(campaignVersion.content.samples.every((sample: { choiceIds: string[]; traceFingerprint: string }) => (
      Array.isArray(sample.choiceIds) && /^[0-9a-f]{32}$/.test(sample.traceFingerprint)
    ))).toBe(true);

    const list = (await fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`,
    })).json();
    expect(list.items).toEqual([expect.objectContaining({
      versionId: campaignVersion.id,
      fingerprint: campaignVersion.content.fingerprint,
      seed: "server-fixed-seed",
      sampleCount: 12,
      findingRetentionStatus: "known",
      retainedFindingCount: campaignVersion.content.findingRetention.retainedFindingCount,
      totalFindingCount: campaignVersion.content.findingRetention.totalFindingCount,
      omittedFindingCount: 0,
      findingsTruncated: false,
      reportFingerprint: campaignVersion.content.report.fingerprint,
    })]);
    expect(campaignVersion.content.findingRetention.totalFindingCount)
      .toBe(campaignVersion.content.findingRetention.retainedFindingCount);
    expect(JSON.stringify(list)).not.toContain("selectedChoiceIds");
    expect(JSON.stringify(list)).not.toContain("proseMarkdown");

    const sample = campaignVersion.content.samples.find((item: { id: string }) => (
      item.id === campaignVersion.content.report.representatives.medianCompletedSampleId
    )) ?? campaignVersion.content.samples[0];
    const replay = await fixture.app.inject({
      method: "POST",
      url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns/${campaignVersion.id}/samples/${sample.id}/replay`,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      verified: true,
      sample: { id: sample.id, traceFingerprint: sample.traceFingerprint },
      trace: { fingerprint: sample.traceFingerprint },
    });

    const canonicalAfter = (await fixture.app.inject({
      method: "GET", url: `/api/long-form/projects/${fixture.projectId}/passage-plan`,
    })).json();
    expect(canonicalAfter).toEqual(canonicalBefore);
  });

  it("reopens immutable historical evidence and replay after restart and newer authoring changes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-playtesting-reopen-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const fixture = await approvedProject(databasePath);
      const created = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`, payload: {
          inputArtifactVersionId: fixture.input.id,
          seed: "historical-seed",
          policy: { sampleCount: 8, maxStepsPerSample: 40 },
        },
      })).json();
      const originalFingerprint = created.content.fingerprint as string;
      const originalReportFingerprint = created.content.report.fingerprint as string;
      const sample = created.content.samples[0];
      const currentPassage = fixture.plan.passages[0];
      expect((await fixture.app.inject({
        method: "PUT",
        url: `/api/long-form/projects/${fixture.projectId}/passage-plan/entities/passage/${currentPassage.entityId}`,
        payload: { ...currentPassage.content, title: "Newer canonical title" },
      })).statusCode).toBe(201);
      const deterministicRerun = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`, payload: {
          inputArtifactVersionId: fixture.input.id,
          seed: "historical-seed",
          policy: { sampleCount: 8, maxStepsPerSample: 40 },
        },
      })).json();
      expect(deterministicRerun.content).toEqual(created.content);
      const legacy = (await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`, payload: {
          inputArtifactVersionId: fixture.input.id,
          seed: "historical-v1-seed",
          policy: { sampleCount: 4, maxStepsPerSample: 40 },
        },
      })).json();
      apps.splice(apps.indexOf(fixture.app), 1);
      await fixture.app.close();

      const database = openDatabase(databasePath);
      const legacyRow = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?")
        .get(legacy.id) as { content_json: string };
      const legacyContent = JSON.parse(legacyRow.content_json) as Record<string, unknown> & {
        report: Record<string, unknown>;
      };
      legacyContent.schemaVersion = 1;
      delete legacyContent.findingRetention;
      (legacyContent.policy as Record<string, unknown>).maxFindings = 1;
      legacyContent.findings = (legacyContent.findings as unknown[]).slice(0, 1);
      delete legacyContent.report.sharedDecisionIds;
      const { fingerprint: _reportFingerprint, ...legacyReportIdentity } = legacyContent.report;
      legacyContent.report.fingerprint = stableFingerprint(legacyReportIdentity);
      legacyContent.id = `ptc_${stableFingerprint({
        projectId: legacyContent.projectId,
        simulationInputArtifactVersionId: legacyContent.simulationInputArtifactVersionId,
        simulationInputFingerprint: legacyContent.simulationInputFingerprint,
        compiledRuntimeFingerprint: legacyContent.compiledRuntimeFingerprint,
        snapshotId: legacyContent.snapshotId,
        seed: legacyContent.seed,
        policy: legacyContent.policy,
      })}`;
      const { fingerprint: _campaignFingerprint, ...legacyCampaignIdentity } = legacyContent;
      legacyContent.fingerprint = stableFingerprint(legacyCampaignIdentity);
      database.prepare("UPDATE artifact_versions SET schema_version = 1, content_json = ? WHERE id = ?")
        .run(JSON.stringify(legacyContent), legacy.id);
      database.close();

      const reopened = buildApp({ databasePath });
      apps.push(reopened);
      const historical = await reopened.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns/${created.id}`,
      });
      expect(historical.statusCode).toBe(200);
      expect(historical.json().content).toMatchObject({
        fingerprint: originalFingerprint,
        report: { fingerprint: originalReportFingerprint },
      });
      const legacyHistorical = await reopened.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns/${legacy.id}`,
      });
      expect(legacyHistorical.statusCode).toBe(200);
      expect(legacyHistorical.json().content).toMatchObject({
        schemaVersion: 1,
        fingerprint: legacyContent.fingerprint,
        report: { fingerprint: legacyContent.report.fingerprint },
      });
      const legacySummary = (await reopened.inject({
        method: "GET", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`,
      })).json().items.find((item: { versionId: string }) => item.versionId === legacy.id);
      expect(legacySummary).toMatchObject({
        findingRetentionStatus: "legacy-unknown",
        retainedFindingCount: legacyContent.findings instanceof Array ? legacyContent.findings.length : 0,
        totalFindingCount: null,
        omittedFindingCount: null,
        findingsTruncated: null,
      });
      const replay = await reopened.inject({
        method: "POST",
        url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns/${created.id}/samples/${sample.id}/replay`,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ verified: true, trace: { fingerprint: sample.traceFingerprint } });
      const legacySample = (legacyContent.samples as Array<{ id: string; traceFingerprint: string }>)[0]!;
      const legacyReplay = await reopened.inject({
        method: "POST",
        url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns/${legacy.id}/samples/${legacySample.id}/replay`,
      });
      expect(legacyReplay.statusCode).toBe(200);
      expect(legacyReplay.json()).toMatchObject({
        verified: true,
        trace: { fingerprint: legacySample.traceFingerprint },
      });
    } finally {
      await closeApps();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects cross-project access, raised bounds, and tampered sample paths without partial campaign evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-playtesting-integrity-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const first = await approvedProject(databasePath, "First playtest project");
      const secondCreated = (await first.app.inject({
        method: "POST", url: "/api/long-form/projects", payload: { name: "Second playtest project" },
      })).json();
      const oversized = await first.app.inject({
        method: "POST", url: `/api/long-form/projects/${first.projectId}/simulation/playtests/campaigns`, payload: {
          inputArtifactVersionId: first.input.id,
          seed: "oversized",
          policy: { sampleCount: 500, maxStepsPerSample: 500 },
        },
      });
      expect(oversized.statusCode).toBe(400);
      expect((await first.app.inject({
        method: "GET", url: `/api/long-form/projects/${first.projectId}/simulation/playtests/campaigns`,
      })).json().items).toEqual([]);

      const created = (await first.app.inject({
        method: "POST", url: `/api/long-form/projects/${first.projectId}/simulation/playtests/campaigns`, payload: {
          inputArtifactVersionId: first.input.id, seed: "tamper-seed", policy: { sampleCount: 4, maxStepsPerSample: 40 },
        },
      })).json();
      expect((await first.app.inject({
        method: "GET",
        url: `/api/long-form/projects/${secondCreated.project.id}/simulation/playtests/campaigns/${created.id}`,
      })).statusCode).toBe(404);

      const database = openDatabase(databasePath);
      const row = database.prepare("SELECT content_json FROM artifact_versions WHERE id = ?").get(created.id) as { content_json: string };
      const content = JSON.parse(row.content_json) as Record<string, unknown> & {
        samples: Array<Record<string, unknown>>;
        fingerprint: string;
      };
      content.samples[0] = sampleIdentity({ ...content.samples[0]!, choiceIds: ["choice-tampered"] });
      const { fingerprint: _fingerprint, ...campaignIdentity } = content;
      content.fingerprint = stableFingerprint(campaignIdentity);
      database.prepare("UPDATE artifact_versions SET content_json = ? WHERE id = ?").run(JSON.stringify(content), created.id);
      database.close();

      const sampleId = content.samples[0]!.id as string;
      const rejected = await first.app.inject({
        method: "POST",
        url: `/api/long-form/projects/${first.projectId}/simulation/playtests/campaigns/${created.id}/samples/${sampleId}/replay`,
      });
      expect(rejected.statusCode).toBe(409);
      expect(rejected.json().code).toBe("playtest_evidence_integrity_failure");
    } finally {
      await closeApps();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("cascades project-owned campaign evidence without a schema migration", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-playtesting-cascade-"));
    const databasePath = join(directory, "story.sqlite");
    try {
      const fixture = await approvedProject(databasePath);
      await fixture.app.inject({
        method: "POST", url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns`, payload: {
          inputArtifactVersionId: fixture.input.id, seed: "cascade", policy: { sampleCount: 3, maxStepsPerSample: 40 },
        },
      });
      const database = openDatabase(databasePath);
      expect((database.prepare("SELECT COUNT(*) count FROM artifact_versions WHERE project_id = ? AND artifact_id = 'playtest-campaigns'")
        .get(fixture.projectId) as { count: number }).count).toBe(1);
      database.prepare("DELETE FROM projects WHERE id = ?").run(fixture.projectId);
      expect((database.prepare("SELECT COUNT(*) count FROM artifact_versions WHERE project_id = ?")
        .get(fixture.projectId) as { count: number }).count).toBe(0);
      database.close();
    } finally {
      await closeApps();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
