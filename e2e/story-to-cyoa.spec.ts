import { expect, test, type APIRequestContext } from "playwright/test";

const source = "Mara returns to the flooded station before dawn, carrying the brass key her father hid years ago. She knows the town will blame her if the archive burns, but the last train still waits beyond the broken platform.";

async function seedLargePassagePlan(request: APIRequestContext, passageCount = 300): Promise<string> {
  const post = async (url: string, data?: unknown) => {
    const response = await request.post(url, { data });
    await expect(response).toBeOK();
    return response.json();
  };
  const put = async (url: string, data: unknown) => {
    const response = await request.put(url, { data });
    await expect(response).toBeOK();
    return response.json();
  };
  const created = await post("/api/long-form/projects", { name: "Browser large passage workspace" });
  const projectId = created.project.id as string;
  await post(`/api/long-form/projects/${projectId}/brief/approve`, { versionId: created.brief.id });
  const bible = await post(`/api/long-form/projects/${projectId}/bible`);
  await post(`/api/long-form/projects/${projectId}/bible/approve`, { versionId: bible.bible.id });
  const routes = await post(`/api/long-form/projects/${projectId}/routes`);
  await post(`/api/long-form/projects/${projectId}/routes/approve`, { versionId: routes.routes.id });
  const endings = await post(`/api/long-form/projects/${projectId}/endings`);
  await post(`/api/long-form/projects/${projectId}/endings/approve`, { versionId: endings.endings.id });
  const mechanics = await post(`/api/long-form/projects/${projectId}/mechanics`);
  const mechanicsSaved = await put(`/api/long-form/projects/${projectId}/mechanics`, {
    ...mechanics.mechanics.content,
    choiceEffectPlans: [{
      id: "effect-core",
      label: "Core choice consequences",
      sourceDecisionIds: ["decision-route-selection"],
      mechanicKeys: mechanics.mechanics.content.visibleStats.map((item: { key: string }) => item.key),
      effectGuidance: ["Every tracked value changes only after a consequential choice."],
    }],
  });
  await post(`/api/long-form/projects/${projectId}/mechanics/approve`, { versionId: mechanicsSaved.mechanics.id });
  await post(`/api/long-form/projects/${projectId}/passage-plan`);

  const routeId = routes.routes.content.routes[0].id as string;
  const endingId = endings.endings.content.endings.find((item: { routeId: string }) => item.routeId === routeId).id as string;
  const passageIds = Array.from({ length: passageCount }, (_, index) => `passage-${String(index).padStart(3, "0")}`);
  const passages = passageIds.map((passageId, index) => ({
    id: passageId,
    sequenceId: "sequence-main",
    title: `Passage ${index}`,
    kind: index === passageCount - 1 ? "epilogue" : "scene",
    purpose: `Plan beat ${index}`,
    summary: "",
    wordTarget: 500,
    routeIds: [routeId],
    tags: [],
    characterIds: [],
    relationshipIds: [],
    locationIds: [],
    requiredFactIds: [],
    revealedFactIds: [],
    setupThreadIds: [],
    payoffThreadIds: [],
    preservedDifferenceIds: [],
    choiceIds: index === passageCount - 1 ? [] : [`choice-${String(index).padStart(3, "0")}`],
    terminal: index === passageCount - 1,
    endingId: index === passageCount - 1 ? endingId : null,
    draftingNotes: [],
    unresolvedQuestions: [],
    planningStatus: "planned",
    position: index,
  }));
  const choices = passageIds.slice(0, -1).map((passageId, index) => ({
    id: `choice-${String(index).padStart(3, "0")}`,
    sourcePassageId: passageId,
    label: "Continue",
    destinationPassageId: passageIds[index + 1],
    narrativeIntent: "",
    consequencePreview: "",
    condition: null,
    unavailableBehavior: "disabled",
    unavailableExplanation: "",
    effects: [],
    sourceDecisionIds: [],
    position: 0,
  }));
  await put(`/api/long-form/projects/${projectId}/passage-plan`, {
    schemaVersion: 1,
    structure: {
      schemaVersion: 1,
      title: "Browser large passage plan",
      projectWordTarget: 150_000,
      typicalPathWordTarget: 150_000,
      startPassageId: passageIds[0],
      acts: [{
        id: "act-main",
        label: "Main act",
        purpose: "",
        summary: "",
        wordTarget: 150_000,
        routeIds: [routeId],
        sequenceIds: ["sequence-main"],
        position: 0,
      }],
      sequences: [{
        id: "sequence-main",
        actId: "act-main",
        label: "Main sequence",
        purpose: "",
        summary: "",
        wordTarget: 150_000,
        routeIds: [routeId],
        passageIds,
        entryGoals: [],
        exitGoals: [],
        requiredDecisionIds: [],
        endingHookIds: [],
        position: 0,
        planningStatus: "planned",
      }],
      characterAvailability: [],
    },
    passages,
    choices,
    threads: [],
  });
  return projectId;
}

async function approveCurrentPassagePlan(request: APIRequestContext, projectId: string) {
  const snapshotResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/snapshots`);
  await expect(snapshotResponse).toBeOK();
  const snapshot = await snapshotResponse.json();
  const approvalResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/approve`, {
    data: { snapshotId: snapshot.id },
  });
  await expect(approvalResponse).toBeOK();
  return snapshot;
}

async function completePassageGeneration(request: APIRequestContext, projectId: string, modelId: string) {
  const createdResponse = await request.post(`/api/long-form/projects/${projectId}/passage-generation/plans`, { data: {
    scope: { kind: "sequence", sequenceId: "sequence-main" }, providerId: "offline-kernel", modelId,
  } });
  await expect(createdResponse).toBeOK();
  const created = await createdResponse.json();
  const authorized = await request.post(`/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, {
    data: { fingerprint: created.fingerprint },
  });
  await expect(authorized).toBeOK();
  const started = await request.post(`/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start`);
  await expect(started).toBeOK();
  let terminal: { status: string; units?: unknown[] } | undefined;
  await expect.poll(async () => {
    terminal = await (await request.get(`/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}`)).json();
    return ["completed", "partially_failed", "failed", "cancelled"].includes(terminal!.status);
  }, { timeout: 20_000 }).toBe(true);
  if (terminal?.status === "failed" || terminal?.status === "partially_failed") {
    const retryableUnits = (terminal.units ?? []) as Array<{ id: string; status: string; normalizedError?: { retryable?: boolean } }>;
    for (const unit of retryableUnits.filter((item) => item.status === "failed" && item.normalizedError?.retryable)) {
      const retried = await request.post(
        `/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/units/${unit.id}/retry`,
      );
      await expect(retried).toBeOK();
    }
    const resumed = await request.post(`/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start`);
    await expect(resumed).toBeOK();
    await expect.poll(async () => {
      terminal = await (await request.get(`/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}`)).json();
      return terminal!.status;
    }, { timeout: 20_000 }).toBe("completed");
  }
  expect(terminal?.status, JSON.stringify(terminal)).toBe("completed");
  return created;
}

test("complete private adaptation offline smoke", async ({ request }) => {
  const health = await request.get("/api/health");
  await expect(health).toBeOK();
  await expect(health.json()).resolves.toEqual({ ok: true, service: "story-to-cyoa" });
  const app = await request.get("/");
  await expect(app).toBeOK();
  await expect(app.text()).resolves.toContain("Story to CYOA");
});

test("observable quick generation stays offline and shows provider activity", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-e2e-fake-key-0123456789");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.getByRole("button", { name: "Add command" }).click();
  await page.getByLabel("Command name").fill("Continuity");
  await page.getByLabel("Instruction").fill("Keep Mara's promise central to each choice.");
  await page.getByRole("button", { name: "Save for this story" }).click();
  await expect(page.getByRole("heading", { name: "Always apply commands" })).toBeVisible();

  await page.locator("textarea.source").fill(source);
  await page.getByRole("button", { name: "Generate CYOA" }).click();

  await expect(page.getByText("The offline provider planned the branch structure.")).toBeVisible();
  await expect(page.getByText("Repairing structured output")).toBeVisible();
  await expect(page.getByText("Generated game")).toBeVisible();
  await expect(page.getByText("48 tokens")).toBeVisible();
});

test("offline non-JSON provider failure exposes a redacted diagnostic", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("OpenRouter API key").fill("sk-or-v1-e2e-fake-key-0123456789");
  await page.getByRole("button", { name: "Save key" }).click();
  await page.locator("textarea.source").fill(source);
  await page.getByLabel("Model").fill("e2e/non-json");
  await page.getByRole("button", { name: "Generate CYOA" }).click();

  await expect(page.getByText("OpenRouter returned a non-JSON response.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View full response" }).click();
  await expect(page.getByText("Bearer [REDACTED]")).toBeVisible();
});

test("long-form workspace persists and approves a project brief", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Long-form workspace" }).click();
  await page.getByLabel("Working title").fill("The Long-form E2E Project");
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(page.getByRole("heading", { name: "Project brief" })).toBeVisible();
  await expect(page.getByLabel("Total words")).toHaveValue("175000");
  await expect(page.locator(".artifact-header").getByText(/Version 1/)).toBeVisible();

  await page.getByPlaceholder("What is this adaptation or original story about?").fill(
    "A student discovers why an apparently easy course has no surviving graduates.",
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved locally.")).toBeVisible();
  await expect(page.locator(".artifact-header").getByText(/Version 2/)).toBeVisible();

  await page.getByRole("button", { name: "Approve brief" }).click();
  await expect(page.getByText("Project brief approved. Story-bible work will be the next stage.")).toBeVisible();

  await page.getByLabel("Model").fill("e2e/chat");
  await page.locator(".assistant-composer textarea").fill("Would six routes give the relationships more room?");
  await page.getByRole("button", { name: "Send to assistant" }).click();
  await expect(page.getByText("Five routes is a practical baseline; six gives secondary relationships more room.")).toBeVisible();
  await expect(page.getByText("110 tokens")).toBeVisible();

  await page.getByLabel("Intent").selectOption("propose");
  await page.locator(".assistant-composer textarea").fill("Change the brief to six major routes.");
  await page.getByRole("button", { name: "Request proposal" }).click();
  await expect(page.getByRole("heading", { name: "Expand the brief to six routes" })).toBeVisible();
  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect(page.locator(".artifact-header").getByText(/Version 3/)).toBeVisible();
  await expect(page.getByLabel("Major routes")).toHaveValue("6");
  await page.getByRole("button", { name: "Approve brief" }).click();

  await page.getByRole("button", { name: "Story bible Not started" }).click();
  await expect(page.getByRole("heading", { name: "Story bible" })).toBeVisible();
  await page.getByRole("button", { name: "Create story bible" }).click();
  await expect(page.locator(".artifact-header").getByText(/Version 1/)).toBeVisible();

  await page.locator(".assistant-composer textarea").fill("What should the bible establish first?");
  await page.getByRole("button", { name: "Send to assistant" }).click();
  await expect(page.getByText("The bible has a solid foundation; the protagonist record should come next.")).toBeVisible();
  await page.getByLabel("Intent").selectOption("propose");
  await page.locator(".assistant-composer textarea").fill("Add Mara as the protagonist.");
  await page.getByRole("button", { name: "Request proposal" }).click();
  await expect(page.getByRole("heading", { name: "Add Mara to the story bible" })).toBeVisible();
  await page.getByRole("button", { name: "Apply selected" }).click();
  await expect(page.locator(".artifact-header").getByText(/Version 2/)).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Mara");
  await page.getByRole("button", { name: "Approve bible" }).click();
  await expect(page.getByText("Story bible approved. Routes are the next planning stage.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Story bible" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Mara");
  await expect(page.getByText("I prepared a protagonist record for bible review.")).toBeVisible();
});

test("long-form passage workspace renders, filters, and jumps within a 300-passage fixture", async ({ page, request }) => {
  test.setTimeout(60_000);
  const projectId = await seedLargePassagePlan(request);
  await page.addInitScript((id) => {
    localStorage.setItem("story-to-cyoa.long-form-project-id", id);
    localStorage.setItem("story-to-cyoa.long-form-stage", "passage-plan");
  }, projectId);
  await page.goto("/#long-form");

  await expect(page.getByRole("heading", { name: "Passage plan" })).toBeVisible();
  await expect(page.getByText("300 of 300 passages shown", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search titles, IDs, summaries, and tags").fill("passage-299");
  await expect(page.getByText("1 of 300 passages shown", { exact: true })).toBeVisible({ timeout: 5_000 });
  await page.getByPlaceholder("Jump to stable ID").fill("passage-299");
  await page.getByRole("button", { name: "Jump" }).click();
  await expect(page.locator(".passage-editor input").first()).toHaveValue("Passage 299");
});

test("manual passage drafts persist, stale selectively, and stay separate in a 300-passage workspace", async ({ page, request }) => {
  test.setTimeout(90_000);
  const projectId = await seedLargePassagePlan(request);
  await approveCurrentPassagePlan(request, projectId);
  const observedRequests: string[] = [];
  page.on("request", (entry) => observedRequests.push(entry.url()));
  await page.addInitScript((id) => {
    localStorage.setItem("story-to-cyoa.long-form-project-id", id);
    localStorage.setItem("story-to-cyoa.long-form-stage", "passage-plan");
  }, projectId);
  await page.goto("/#long-form");

  await expect(page.getByRole("heading", { name: "Passage draft" })).toBeVisible();
  await page.getByLabel("Prose Markdown").fill("Fanawë enters 東京. This private marker stays in draft storage only.");
  await page.getByLabel("Author note").fill("Manual browser fixture");
  await page.getByRole("button", { name: "Save new candidate version" }).click();
  await expect(page.getByText(/Manual draft saved as a new immutable candidate version/)).toBeVisible();
  await expect(page.getByText(/11 \/ 500/)).toBeVisible();
  await expect(page.getByText("Draft history (1)")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Prose Markdown")).toHaveValue("Fanawë enters 東京. This private marker stays in draft storage only.");
  await expect(page.getByText("Draft history (1)")).toBeVisible();
  await expect(page.locator(".draft-status-badges").getByText("candidate", { exact: true })).toBeVisible();

  let passagePlanResponse = await request.get(`/api/long-form/projects/${projectId}/passage-plan`);
  const passagePlanBody = await passagePlanResponse.text();
  expect(passagePlanBody).not.toContain("private marker stays in draft storage");
  const passagePlan = JSON.parse(passagePlanBody);
  expect(passagePlan.passages).toHaveLength(300);
  const summary = await (await request.get(`/api/long-form/projects/${projectId}/drafts/summary`)).json();
  expect(summary).toMatchObject({ passageCount: 300, currentDraftCount: 1, acceptedDraftCount: 0 });
  expect(JSON.stringify(summary)).not.toContain("Fanawë");

  const unrelated = passagePlan.passages.find((item: { entityId: string }) => item.entityId === "passage-001");
  const unrelatedSave = await request.put(
    `/api/long-form/projects/${projectId}/passage-plan/entities/passage/passage-001`,
    { data: { ...unrelated.content, purpose: "An unrelated material change" } },
  );
  await expect(unrelatedSave).toBeOK();
  await page.reload();
  await expect(page.getByText("This draft is stale.")).toHaveCount(0);
  await expect(page.getByLabel("Prose Markdown")).toHaveValue("Fanawë enters 東京. This private marker stays in draft storage only.");

  passagePlanResponse = await request.get(`/api/long-form/projects/${projectId}/passage-plan`);
  const current = await passagePlanResponse.json();
  const selected = current.passages.find((item: { entityId: string }) => item.entityId === "passage-000");
  const selectedSave = await request.put(
    `/api/long-form/projects/${projectId}/passage-plan/entities/passage/passage-000`,
    { data: { ...selected.content, wordTarget: 650 } },
  );
  await expect(selectedSave).toBeOK();
  await page.reload();
  await expect(page.getByText("This draft is stale.")).toBeVisible();
  await expect(page.getByText(/passage-plan-material-change: passage passage-000 \(wordTarget\)/)).toBeVisible();
  await expect(page.getByLabel("Prose Markdown")).toHaveValue("Fanawë enters 東京. This private marker stays in draft storage only.");

  await page.getByPlaceholder("Search titles, IDs, summaries, and tags").fill("passage-299");
  await expect(page.getByText("1 of 300 passages shown", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Jump to stable ID").fill("passage-299");
  await page.getByRole("button", { name: "Jump" }).click();
  await expect(page.locator(".passage-editor input").first()).toHaveValue("Passage 299");
  expect(observedRequests.some((url) => /openrouter|passage-generation\/jobs\/.*\/start/i.test(url))).toBe(false);
});

test("bounded passage generation previews, authorizes, retries, cancels, and reopens offline", async ({ page, request }) => {
  test.setTimeout(180_000);
  const projectId = await seedLargePassagePlan(request);
  const snapshotResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/snapshots`);
  await expect(snapshotResponse).toBeOK();
  const snapshot = await snapshotResponse.json();
  const approvalResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/approve`, {
    data: { snapshotId: snapshot.id },
  });
  await expect(approvalResponse).toBeOK();
  await page.addInitScript((id) => {
    localStorage.setItem("story-to-cyoa.long-form-project-id", id);
    localStorage.setItem("story-to-cyoa.long-form-stage", "passage-plan");
  }, projectId);
  await page.goto("/#long-form");

  await page.getByRole("button", { name: "Preview plan" }).click();
  await expect(page.getByRole("region", { name: "Generation plan inspection" })).toContainText("12 bounded units");
  await expect(page.getByRole("region", { name: "Generation plan inspection" })).toContainText("Cost: unavailable offline");
  await expect(page.getByRole("region", { name: "Generation plan inspection" })).toContainText("cyoa.passage-planning-unit-candidate");
  await page.getByRole("button", { name: "Save exact plan" }).click();
  await page.getByRole("button", { name: "Authorize exact plan" }).click();
  await page.getByRole("button", { name: "Start offline kernel" }).click();
  await expect(page.getByText("Job: partially_failed")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Retry unit" }).click();
  await page.getByRole("button", { name: "Resume offline kernel" }).click();
  await expect(page.getByText("Job: completed")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Validated candidate retained/).first()).toBeVisible();
  await expect(page.getByText(/repairs 1\/1/).first()).toBeVisible();
  await page.getByText("Context diagnostics").first().click();
  await expect(page.getByText(/Schema: cyoa\.passage-planning-unit-candidate\/v1/).first()).toBeVisible();

  await page.getByRole("button", { name: "Create proposal set" }).click();
  await expect(page.getByText("12 coherent groups / 12 validated candidates", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".proposal-review .proposal-group")).toHaveCount(12);
  await page.getByText("Operation details (25)").first().click();
  await expect(page.locator(".proposal-operation").first()).toContainText("planningStatus");
  await page.getByRole("button", { name: "Refresh validation preview" }).click();
  await expect(page.getByRole("region", { name: "Proposal validation preview" })).toContainText("Preview valid", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Proposal validation preview" })).toContainText("planned -> reviewed");
  await page.getByRole("button", { name: "Apply reviewed selection" }).click();
  await expect(page.getByText("Application history (1)")).toBeVisible({ timeout: 30_000 });

  const afterApply = await (await request.get(`/api/long-form/projects/${projectId}/passage-plan`)).json();
  expect(afterApply.passages).toHaveLength(300);
  expect(afterApply.passages.every((item: { content: { planningStatus: string } }) => item.content.planningStatus === "reviewed")).toBe(true);
  expect(afterApply.snapshots.some((item: { id: string }) => item.id === snapshot.id)).toBe(true);
  expect(afterApply.state.approvedSnapshotId).toBe(snapshot.id);

  await page.reload();
  await expect(page.getByText("Job: completed")).toBeVisible();
  await expect(page.getByText("12/12 units complete")).toBeVisible();
  await expect(page.getByText(/Validated candidate retained/).first()).toBeVisible();
  await expect(page.getByText("Application history (1)")).toBeVisible();

  const refreshedSnapshotResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/snapshots`);
  await expect(refreshedSnapshotResponse).toBeOK();
  const refreshedSnapshot = await refreshedSnapshotResponse.json();
  const refreshedApproval = await request.post(`/api/long-form/projects/${projectId}/passage-plan/approve`, {
    data: { snapshotId: refreshedSnapshot.id },
  });
  await expect(refreshedApproval).toBeOK();
  await page.reload();
  await expect(page.getByRole("button", { name: "Preview plan" })).toBeEnabled();

  await page.getByRole("button", { name: "Preview plan" }).click();
  await page.getByRole("button", { name: "Save exact plan" }).click();
  await page.getByRole("button", { name: "Authorize exact plan" }).click();
  await page.getByRole("button", { name: "Start offline kernel" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Job: cancelled")).toBeVisible();
});

test("passage proposal review blocks stale and hard-invalid selections without mutation", async ({ page, request }) => {
  test.setTimeout(120_000);

  const staleProjectId = await seedLargePassagePlan(request, 10);
  const staleSnapshot = await approveCurrentPassagePlan(request, staleProjectId);
  const staleGeneration = await completePassageGeneration(request, staleProjectId, "deterministic-fixture-v1");
  const proposalResponse = await request.post(
    `/api/long-form/projects/${staleProjectId}/passage-generation/jobs/${staleGeneration.jobId}/proposals`,
  );
  await expect(proposalResponse).toBeOK();
  const staleProposal = await proposalResponse.json();
  const previewResponse = await request.post(
    `/api/long-form/projects/${staleProjectId}/passage-generation/proposals/${staleProposal.id}/preview`,
    { data: { groupIds: staleProposal.groups.map((group: { id: string }) => group.id) } },
  );
  await expect(previewResponse).toBeOK();
  const current = await (await request.get(`/api/long-form/projects/${staleProjectId}/passage-plan`)).json();
  const manuallyEdited = { ...current.passages[0].content, title: "Manual head wins" };
  const manualSave = await request.put(
    `/api/long-form/projects/${staleProjectId}/passage-plan/entities/passage/${manuallyEdited.id}`,
    { data: manuallyEdited },
  );
  await expect(manualSave).toBeOK();

  await page.addInitScript((id) => {
    localStorage.setItem("story-to-cyoa.long-form-project-id", id);
    localStorage.setItem("story-to-cyoa.long-form-stage", "passage-plan");
  }, staleProjectId);
  await page.goto("/#long-form");
  await expect(page.getByRole("heading", { name: "Passage proposal review" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh validation preview" }).click();
  const stalePreview = page.getByRole("region", { name: "Proposal validation preview" });
  await expect(stalePreview).toContainText("Application blocked");
  await expect(stalePreview).toContainText(/base|stale|version/i);
  await expect(page.getByRole("button", { name: "Apply reviewed selection" })).toBeDisabled();
  const afterStaleReview = await (await request.get(`/api/long-form/projects/${staleProjectId}/passage-plan`)).json();
  expect(afterStaleReview.passages[0].content.title).toBe("Manual head wins");
  expect(afterStaleReview.passages[0].content.planningStatus).toBe("planned");
  expect(afterStaleReview.snapshots.some((item: { id: string }) => item.id === staleSnapshot.id)).toBe(true);

  const hardProjectId = await seedLargePassagePlan(request, 10);
  await approveCurrentPassagePlan(request, hardProjectId);
  const hardBefore = await (await request.get(`/api/long-form/projects/${hardProjectId}/passage-plan`)).json();
  await completePassageGeneration(request, hardProjectId, "deterministic-fixture-uncontrolled-cycle-v1");
  await page.reload();
  await page.getByLabel("Switch project").selectOption(hardProjectId);
  await expect(page.getByText("Job: completed")).toBeVisible();
  await page.getByRole("button", { name: "Create proposal set" }).click();
  await page.getByRole("checkbox", { name: "Select Generation unit 1" }).check();
  await page.getByRole("button", { name: "Refresh validation preview" }).click();
  const hardPreview = page.getByRole("region", { name: "Proposal validation preview" });
  await expect(hardPreview).toContainText("Application blocked");
  await expect(hardPreview).toContainText(/cycle|ending|reachable|choice/i);
  await expect(page.getByRole("button", { name: "Apply reviewed selection" })).toBeDisabled();
  const hardAfter = await (await request.get(`/api/long-form/projects/${hardProjectId}/passage-plan`)).json();
  expect(hardAfter.structure).toEqual(hardBefore.structure);
  expect(hardAfter.passages).toEqual(hardBefore.passages);
  expect(hardAfter.choices).toEqual(hardBefore.choices);
});

test("failed passage candidate validation remains inspectable without mutating the project", async ({ page, request }) => {
  test.setTimeout(90_000);
  const projectId = await seedLargePassagePlan(request);
  const snapshotResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/snapshots`);
  await expect(snapshotResponse).toBeOK();
  const snapshot = await snapshotResponse.json();
  const approveResponse = await request.post(`/api/long-form/projects/${projectId}/passage-plan/approve`, { data: { snapshotId: snapshot.id } });
  await expect(approveResponse).toBeOK();
  const before = await (await request.get(`/api/long-form/projects/${projectId}/passage-plan`)).json();
  const createdResponse = await request.post(`/api/long-form/projects/${projectId}/passage-generation/plans`, { data: {
    scope: { kind: "sequence", sequenceId: "sequence-main" },
    providerId: "offline-kernel",
    modelId: "deterministic-fixture-invalid-v1",
  } });
  await expect(createdResponse).toBeOK();
  const created = await createdResponse.json();
  const authorizeResponse = await request.post(`/api/long-form/projects/${projectId}/passage-generation/plans/${created.id}/authorize`, { data: { fingerprint: created.fingerprint } });
  await expect(authorizeResponse).toBeOK();
  const startResponse = await request.post(`/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}/start`);
  await expect(startResponse).toBeOK();
  await expect.poll(async () => (await (await request.get(`/api/long-form/projects/${projectId}/passage-generation/jobs/${created.jobId}`)).json()).status).toBe("failed");

  await page.addInitScript((id) => {
    localStorage.setItem("story-to-cyoa.long-form-project-id", id);
    localStorage.setItem("story-to-cyoa.long-form-stage", "passage-plan");
  }, projectId);
  await page.goto("/#long-form");
  await expect(page.getByText("Job: failed")).toBeVisible();
  await expect(page.getByText("Candidate response is not valid JSON").first()).toBeVisible();
  await expect(page.getByText(/Validated candidate retained/)).toHaveCount(0);
  const after = await (await request.get(`/api/long-form/projects/${projectId}/passage-plan`)).json();
  expect(after.structure).toEqual(before.structure);
  expect(after.passages).toEqual(before.passages);
  expect(after.snapshots).toEqual(before.snapshots);
});
