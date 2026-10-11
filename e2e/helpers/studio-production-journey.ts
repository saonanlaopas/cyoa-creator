import { expect, type APIRequestContext, type Page, type TestInfo } from "playwright/test";
import { readFile } from "node:fs/promises";

/** Browser review/play/recovery over deterministic API-authored fixtures; no live provider transport. */
export async function completeStudioProductionJourney(page: Page, request: APIRequestContext, projectId: string, info: TestInfo) {
  const root = `/api/long-form/projects/${projectId}`;
  const post = async (url: string, data = {}) => {
    const response = await request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const get = async (url: string) => { const response = await request.get(url); expect(response.ok(), await response.text()).toBe(true); return response.json(); };
  const premise = page.getByPlaceholder("What is this adaptation or original story about?"), originalPremise = await premise.inputValue();
  await premise.fill(`${originalPremise} [unsaved studio layer probe]`);
  for (const layer of ["Director", "Advanced", "Review"]) {
    await page.getByLabel(layer, { exact: true }).check();
    await expect(page.getByLabel("Switch project")).toHaveValue(projectId);
    await expect(premise).toHaveValue(`${originalPremise} [unsaved studio layer probe]`);
  }
  expect((await get(root)).brief.content.premise).toBe(originalPremise);
  await premise.fill(originalPremise);
  await page.getByRole("button", { name: "Approve brief", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve brief", exact: true })).toBeDisabled();
  for (const artifactId of ["creative-direction", "bible", "routes", "endings", "mechanics"]) {
    const state = await get(root), key = artifactId === "creative-direction" ? "creativeDirection" : artifactId;
    const version = state[key] ?? (await post(`${root}/${artifactId}`))[key];
    if (artifactId === "mechanics") {
      const routes = (await get(root)).routes.content;
      const saved = await request.put(`${root}/mechanics`, { data: { ...version.content, choiceEffectPlans: [...version.content.choiceEffectPlans, {
        id: "a7-effect", label: "Reviewed choice effects", sourceDecisionIds: [routes.decisionPoints[0].id],
        mechanicKeys: [...version.content.visibleStats, ...version.content.flags, ...version.content.relationships, ...version.content.resources].map((item: { key: string }) => item.key), effectGuidance: ["Reflect the player's decision."],
      }] } }); expect(saved.ok(), await saved.text()).toBe(true); version.id = (await saved.json()).mechanics.id;
      // Bootstrap captures mechanics as an upstream route/ending dependency. Re-review those exact drafts after the edit.
      for (const dependent of ["routes", "endings"]) await post(`${root}/${dependent}/approve`, { versionId: (await get(root))[dependent].id });
    }
    await post(`${root}/${artifactId}/approve`, { versionId: version.id });
  }
  let plan = await post(`${root}/passage-plan`);
  const approveSnapshot = async () => { const snapshot = await post(`${root}/passage-plan/snapshots`); await post(`${root}/passage-plan/approve`, { snapshotId: snapshot.id }); };
  await approveSnapshot();
  const acceptProse = async (revision: number) => {
    const selections = [];
    for (const passage of plan.passages) {
      const response = await request.put(`${root}/drafts/passages/${passage.entityId}`, { data: {
        proseMarkdown: `Reviewed studio prose ${revision}. ${"The author considers the consequences of this decision. ".repeat(30)}`, authorNote: "Offline A7 acceptance fixture",
      } }); expect(response.ok(), await response.text()).toBe(true);
      selections.push({ passageId: passage.entityId, candidateDraftVersionId: (await response.json()).draft.id });
    }
    const preview = await post(`${root}/drafts/acceptance/preview`, { selections });
    return post(`${root}/drafts/acceptance/apply`, { selections, previewFingerprint: preview.fingerprint });
  };
  await acceptProse(1);
  const input = await post(`${root}/simulation/inputs`);
  await post(`${root}/simulation/runs`, { inputArtifactVersionId: input.id, choiceIds: ["a7-explicit-invalid-path"] });
  const campaign = await post(`${root}/simulation/playtests/campaigns`, { inputArtifactVersionId: input.id, seed: "a7-studio-journey", policy: { sampleCount: 3, maxStepsPerSample: 30 } });
  const narrative = await post(`${root}/narrative-review/plans`, { simulationInputVersionId: input.id, scopePassageIds: [plan.structure.content.startPassageId], campaignVersionIds: [campaign.id], providerId: "offline-narrative-review" });
  await post(`${root}/narrative-review/plans/${narrative.plan.id}/authorize`, { fingerprint: narrative.plan.fingerprint });
  await post(`${root}/narrative-review/plans/${narrative.plan.id}/start`);
  await expect.poll(async () => (await get(`${root}/narrative-review/plans/${narrative.plan.id}`)).job.status).toBe("completed");
  const repair = `${root}/repair`, findingList = await get(`${repair}/findings?sourceKind=foundation-5a-runtime`);
  const finding = await post(`${repair}/findings/resolve`, findingList.items[0].locator);
  const intent = { schemaVersion: 1, category: "passage-plan", note: "Review the unreachable choice in this deterministic fixture." };
  const targets = await post(`${repair}/targets`, { findings: [finding], intent });
  const target = targets.targets.find((item: { targetKey: string }) => item.targetKey.startsWith("passage:")); expect(target).toBeTruthy();
  const repairPlan = await post(`${repair}/plans`, { findings: [finding], intent, targets: [target.target] });
  const proposal = await post(`${repair}/proposals/manual`, { repairPlanId: repairPlan.id });
  const selectedGroupIds = proposal.groups.map((group: { id: string }) => group.id);
  const preview = await post(`${repair}/proposals/${proposal.id}/application-preview`, { selectedGroupIds });
  await post(`${repair}/proposals/${proposal.id}/apply`, { selectedGroupIds, previewFingerprint: preview.previewFingerprint });
  plan = await get(`${root}/passage-plan`); await approveSnapshot();
  const acceptance = await acceptProse(2), first = plan.structure.content.startPassageId;
  let versionId = acceptance.application.resultingAcceptedVersions[first];
  for (const status of ["reviewed", "locked"]) versionId = (await post(`${root}/drafts/passages/${first}/transition`, { versionId, status })).draft.id;

  await page.reload(); await page.getByLabel("Review", { exact: true }).check();
  await page.getByRole("button", { name: /^Playtest & analysis/ }).click();
  await expect(page.getByRole("heading", { name: "Deterministic simulation", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Publication/ }).click();
  const readiness = await get(`${root}/publication/readiness`); expect(readiness.ready, JSON.stringify(readiness.blockers)).toBe(true);
  await expect(page.getByRole("button", { name: "Compile native bundle" })).toBeEnabled();
  await page.getByRole("button", { name: "Compile native bundle" }).click();
  await page.getByRole("button", { name: "Play current build" }).click();
  await expect(page.getByRole("region", { name: "Game controls", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("a7-playable-studio.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Game controls" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("a7-playable-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  const standalone = await request.get(`${root}/publication/exports/standalone`); expect(standalone.ok(), await standalone.text()).toBe(true);
  await page.getByRole("button", { name: /^Project health/ }).click();
  await expect(page.getByRole("heading", { name: "Recorded AI usage", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /^Backup & recovery/ }).click();
  await page.getByRole("button", { name: "Create, verify & download backup" }).click();
  const backupPath = await (await download).path(); expect(backupPath).toBeTruthy();
  await expect(page.getByText("The latest verified backup matches the current semantic project and application/schema identity.", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Review permanent deletion" }).click();
  const dialog = page.getByRole("dialog"); await dialog.getByLabel("Permanent deletion confirmation").fill(projectId);
  await dialog.getByRole("button", { name: "Permanently delete project", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Restore a verified project backup" })).toBeVisible();
  const restore = page.getByRole("region", { name: "Restore project backup", exact: true });
  await restore.getByLabel("Project backup file").setInputFiles({ name: "a7-journey.cyoa-backup.zip", mimeType: "application/zip", buffer: await readFile(backupPath!) });
  await restore.getByRole("button", { name: "Verify & preview" }).click();
  await restore.getByLabel("I reviewed the identity, scope, exclusions, and collision state.").check();
  const restored = page.waitForResponse((response) => response.url().endsWith("/api/recovery/backups/restore")
    && response.request().method() === "POST", { timeout: 30_000 });
  await restore.getByRole("button", { name: "Restore as project" }).click();
  const restoreResponse = await restored;
  expect(restoreResponse.ok(), await restoreResponse.text()).toBe(true);
  expect((await restoreResponse.json()).projectId).toBe(projectId);
  await expect(page.getByLabel("Switch project")).toHaveValue(projectId);
  expect((await get(root)).project.mode).toBe("long-form");
}
