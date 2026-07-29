import { expect, test } from "playwright/test";

const source = "Mara returns to the flooded station before dawn, carrying the brass key her father hid years ago. She knows the town will blame her if the archive burns, but the last train still waits beyond the broken platform.";

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
  await expect(page.getByText("Project brief · version 1")).toBeVisible();

  await page.getByPlaceholder("What is this adaptation or original story about?").fill(
    "A student discovers why an apparently easy course has no surviving graduates.",
  );
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved locally.")).toBeVisible();
  await expect(page.getByText("Project brief · version 2")).toBeVisible();

  await page.getByRole("button", { name: "Approve brief" }).click();
  await expect(page.getByText("Project brief approved. Story-bible work will be the next stage.")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Project brief" })).toBeVisible();
  await expect(page.getByPlaceholder("What is this adaptation or original story about?")).toHaveValue(
    "A student discovers why an apparently easy course has no surviving graduates.",
  );
});
