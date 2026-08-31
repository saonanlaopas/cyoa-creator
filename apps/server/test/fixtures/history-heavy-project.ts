import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobRepository, NarrativeReviewRepository, openDatabase } from "@story-to-cyoa/persistence";
import { buildApp } from "../../src/app.js";

type App = ReturnType<typeof buildApp>;

export interface HistoryHeavyProjectFixture {
  app: App;
  projectId: string;
  directory: string;
  apps: App[];
  proseMarker: string;
  ids: {
    simulationInputId: string;
    simulationRunId: string;
    playtestCampaignId: string;
    narrativePlanId: string;
    repairPlanId: string;
    repairProposalId: string;
    repairApplicationId: string;
    nativeBuildId: string;
  };
}

/**
 * One deliberately small, deterministic project whose histories coexist.
 * It exercises persisted authoring, F5-F8 metadata, restore, and usage without
 * executing an AI provider or relying on a network service.
 */
export async function createHistoryHeavyProjectFixture(): Promise<HistoryHeavyProjectFixture> {
  const directory = mkdtempSync(join(tmpdir(), "cyoa-history-heavy-"));
  const sourcePath = join(directory, "source.sqlite");
  const source = buildApp({ databasePath: sourcePath });
  const apps = [source];
  const created = await json(source, {
    method: "POST", url: "/api/long-form/projects", payload: { name: "Deterministic history-heavy fixture" },
  });
  const projectId = created.project.id as string;
  await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id },
  });
  for (const artifactId of ["bible", "routes", "endings"] as const) {
    const generated = await json(source, { method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}` });
    await json(source, {
      method: "POST", url: `/api/long-form/projects/${projectId}/${artifactId}/approve`,
      payload: { versionId: generated[artifactId].id },
    });
  }
  const mechanics = await json(source, { method: "POST", url: `/api/long-form/projects/${projectId}/mechanics` });
  const savedMechanics = await json(source, {
    method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`, payload: {
      ...mechanics.mechanics.content,
      choiceEffectPlans: [{
        id: "effect-history-heavy", label: "History fixture effect",
        sourceDecisionIds: ["decision-route-selection"],
        mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
        effectGuidance: ["Keep the deterministic history fixture executable."],
      }],
    },
  });
  await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
    payload: { versionId: savedMechanics.mechanics.id },
  });
  const plan = await json(source, { method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan` });
  const snapshot = await json(source, { method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/snapshots` });
  await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/passage-plan/approve`, payload: { snapshotId: snapshot.id },
  });

  const proseMarker = "HISTORY_HEAVY_DETAIL_ONLY_PROSE";
  const selections: Array<{ passageId: string; candidateDraftVersionId: string }> = [];
  for (const passage of plan.passages as Array<{ entityId: string }>) {
    const saved = await json(source, {
      method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${passage.entityId}`,
      payload: { proseMarkdown: `${proseMarker} ${passage.entityId} ${"bounded prose ".repeat(20)}`, authorNote: "fixture-only" },
    });
    selections.push({ passageId: passage.entityId, candidateDraftVersionId: saved.draft.id });
  }
  const acceptancePreview = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/preview`, payload: { selections },
  });
  const acceptance = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/drafts/acceptance/apply`,
    payload: { selections, previewFingerprint: acceptancePreview.fingerprint },
  });
  const startPassageId = plan.structure.content.startPassageId as string;
  let lifecycleId = acceptance.application.resultingAcceptedVersions[startPassageId] as string;
  for (const status of ["reviewed", "locked"] as const) {
    const transitioned = await json(source, {
      method: "POST", url: `/api/long-form/projects/${projectId}/drafts/passages/${startPassageId}/transition`,
      payload: { versionId: lifecycleId, status },
    });
    lifecycleId = transitioned.draft.id;
  }
  await json(source, {
    method: "PUT", url: `/api/long-form/projects/${projectId}/drafts/passages/${startPassageId}`,
    payload: { proseMarkdown: `${proseMarker} unaccepted replacement`, authorNote: "history branch" },
  });

  const simulationInput = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/simulation/inputs`,
  });
  const simulationRun = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/simulation/runs`,
    payload: { inputArtifactVersionId: simulationInput.id, choiceIds: ["fixture-missing-choice"] },
  });
  const campaign = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/simulation/playtests/campaigns`,
    payload: { inputArtifactVersionId: simulationInput.id, seed: "history-heavy-v1", policy: { sampleCount: 3, maxStepsPerSample: 30 } },
  });

  const narrative = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/narrative-review/plans`, payload: {
      simulationInputVersionId: simulationInput.id,
      scopePassageIds: [startPassageId],
      campaignVersionIds: [campaign.id],
    },
  });
  const database = openDatabase(sourcePath);
  try {
    const reviews = new NarrativeReviewRepository(database);
    const planned = reviews.get<Record<string, any> & { schemaVersion: 1; projectId: string; plan: { id: string; fingerprint: string; definitionFingerprint: string } }>(projectId, narrative.plan.id)!;
    const now = "2026-08-31T00:00:00.000Z";
    const authorized = structuredClone(planned.content);
    authorized.plan.status = "authorized";
    authorized.plan.authorizedFingerprint = authorized.plan.fingerprint;
    authorized.job.status = "running";
    authorized.job.startedAt = now;
    authorized.job.finishedAt = null;
    reviews.update(authorized);
    const running = structuredClone(authorized);
    running.job.units = running.job.units.map((unit: Record<string, unknown>, index: number) => ({
      ...unit,
      status: "running",
      attempts: [{
        id: `history-attempt-${index}`, number: 1, status: "running", startedAt: now, finishedAt: null,
        error: null, repair: { maximum: 1, performed: 0, malformedBytes: null, malformedSha256: null },
        usage: null, providerMetadata: [],
      }],
      findings: [],
    }));
    reviews.update(running);
    const completed = structuredClone(running);
    completed.job.status = "completed";
    completed.job.finishedAt = now;
    completed.job.units = completed.job.units.map((unit: Record<string, any>) => ({
      ...unit,
      status: "completed",
      attempts: unit.attempts.map((attempt: Record<string, unknown>) => ({
        ...attempt,
        status: "completed",
        finishedAt: now,
        error: null,
        repair: { maximum: 1, performed: 1, malformedBytes: 16, malformedSha256: "a".repeat(64) },
        usage: { inputTokens: 40, outputTokens: 20, cost: 0 },
        providerMetadata: [],
      })),
    }));
    reviews.update(completed);
    const jobs = new JobRepository(database);
    const generic = jobs.create(projectId, "history-maintenance");
    jobs.checkpoint(generic.id, { bounded: true }, "completed");
    jobs.recordUsage(generic.id, { promptTokens: 7, completionTokens: 3, cost: 0 });
  } finally {
    database.close();
  }

  const nativeBuild = await json(source, {
    method: "POST", url: `/api/long-form/projects/${projectId}/publication/compile`, payload: {},
  });
  const repairRoot = `/api/long-form/projects/${projectId}/repair`;
  const findingList = await json(source, {
    method: "GET", url: `${repairRoot}/findings?sourceKind=foundation-5a-runtime`,
  });
  const finding = await json(source, {
    method: "POST", url: `${repairRoot}/findings/resolve`, payload: findingList.items[0].locator,
  });
  const intent = { schemaVersion: 1, category: "passage-plan", note: "Deterministic history fixture repair." };
  const targets = await json(source, {
    method: "POST", url: `${repairRoot}/targets`, payload: { findings: [finding], intent },
  });
  const target = targets.targets.find((item: { targetKey: string }) => item.targetKey.startsWith("passage:"));
  if (!target) throw new Error("History-heavy fixture could not resolve a passage repair target");
  const repairPlan = await json(source, {
    method: "POST", url: `${repairRoot}/plans`,
    payload: { findings: [finding], intent, targets: [target.target] },
  });
  const proposal = await json(source, {
    method: "POST", url: `${repairRoot}/proposals/manual`, payload: { repairPlanId: repairPlan.id },
  });
  const groupIds = proposal.groups.map((group: { id: string }) => group.id);
  const applicationPreview = await json(source, {
    method: "POST", url: `${repairRoot}/proposals/${proposal.id}/application-preview`,
    payload: { selectedGroupIds: groupIds },
  });
  const application = await json(source, {
    method: "POST", url: `${repairRoot}/proposals/${proposal.id}/apply`,
    payload: { selectedGroupIds: groupIds, previewFingerprint: applicationPreview.previewFingerprint },
  });

  const backup = await response(source, {
    method: "POST", url: `/api/projects/${projectId}/recovery/backups`,
  });
  const targetPath = join(directory, "restored.sqlite");
  const restored = buildApp({ databasePath: targetPath });
  apps.push(restored);
  const upload = multipart(new Uint8Array(backup.rawPayload), "history-heavy-restore");
  await json(restored, { method: "POST", url: "/api/recovery/backups/restore", ...upload });
  await response(restored, { method: "POST", url: `/api/projects/${projectId}/recovery/backups` });

  return {
    app: restored,
    projectId,
    directory,
    apps,
    proseMarker,
    ids: {
      simulationInputId: simulationInput.id,
      simulationRunId: simulationRun.id,
      playtestCampaignId: campaign.id,
      narrativePlanId: narrative.plan.id,
      repairPlanId: repairPlan.id,
      repairProposalId: proposal.id,
      repairApplicationId: application.id,
      nativeBuildId: nativeBuild.build.id,
    },
  };
}

async function response(app: App, options: Parameters<App["inject"]>[0]) {
  const result = await app.inject(options);
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(`History-heavy fixture request failed (${result.statusCode}): ${result.body}`);
  }
  return result;
}

async function json(app: App, options: Parameters<App["inject"]>[0]): Promise<any> {
  return (await response(app, options)).json();
}

function multipart(bytes: Uint8Array, boundary: string) {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="project.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
