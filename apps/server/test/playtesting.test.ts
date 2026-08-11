import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@story-to-cyoa/persistence";
import { stableFingerprint } from "@story-to-cyoa/runtime";
import { buildApp } from "../src/app.js";

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

describe("Foundation 5B playtest API", () => {
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
      schemaVersion: 1,
      projectId: fixture.projectId,
      simulationInputArtifactVersionId: fixture.input.id,
      simulationInputFingerprint: fixture.input.content.fingerprint,
      compiledRuntimeFingerprint: fixture.input.content.runtimeFingerprint,
      snapshotId: fixture.snapshot.id,
      seed: "server-fixed-seed",
      requestedSampleCount: 12,
      actualSampleCount: 12,
      status: "completed",
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
      reportFingerprint: campaignVersion.content.report.fingerprint,
    })]);
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
      apps.splice(apps.indexOf(fixture.app), 1);
      await fixture.app.close();

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
      const replay = await reopened.inject({
        method: "POST",
        url: `/api/long-form/projects/${fixture.projectId}/simulation/playtests/campaigns/${created.id}/samples/${sample.id}/replay`,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ verified: true, trace: { fingerprint: sample.traceFingerprint } });
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
