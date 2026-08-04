import { expect, test, type APIRequestContext } from "playwright/test";

const source = "Mara returns to the flooded station before dawn, carrying the brass key her father hid years ago. She knows the town will blame her if the archive burns, but the last train still waits beyond the broken platform.";

async function seedLargePassagePlan(request: APIRequestContext): Promise<string> {
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
  const passageIds = Array.from({ length: 300 }, (_, index) => `passage-${String(index).padStart(3, "0")}`);
  const passages = passageIds.map((passageId, index) => ({
    id: passageId,
    sequenceId: "sequence-main",
    title: `Passage ${index}`,
    kind: index === 299 ? "epilogue" : "scene",
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
    choiceIds: index === 299 ? [] : [`choice-${String(index).padStart(3, "0")}`],
    terminal: index === 299,
    endingId: index === 299 ? endingId : null,
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

test("bounded passage generation previews, authorizes, retries, cancels, and reopens offline", async ({ page, request }) => {
  test.setTimeout(90_000);
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
  await page.getByRole("button", { name: "Save exact plan" }).click();
  await page.getByRole("button", { name: "Authorize exact plan" }).click();
  await page.getByRole("button", { name: "Start offline kernel" }).click();
  await expect(page.getByText("Job: partially_failed")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Retry unit" }).click();
  await page.getByRole("button", { name: "Resume offline kernel" }).click();
  await expect(page.getByText("Job: completed")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(page.getByText("Job: completed")).toBeVisible();
  await expect(page.getByText("12/12 units complete")).toBeVisible();

  await page.getByRole("button", { name: "Preview plan" }).click();
  await page.getByRole("button", { name: "Save exact plan" }).click();
  await page.getByRole("button", { name: "Authorize exact plan" }).click();
  await page.getByRole("button", { name: "Start offline kernel" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Job: cancelled")).toBeVisible();
});
