import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "playwright/test";
import { unzipSync } from "fflate";
import { openDatabase, PortableProjectRepository } from "@story-to-cyoa/persistence";
import { chooseNativePlayerSession, createNativePlayerConfig, createNativePlayerSession, nativeBundleFingerprint } from "@story-to-cyoa/runtime";
import { playerConfigInput, playerFixture } from "../packages/runtime/test/native-player-fixture.js";
import { PublicationExportService } from "../apps/server/src/services/publication-export-service.js";
import type { NativeCompilationService } from "../apps/server/src/services/native-compilation-service.js";

function exportsFixture(hostile = false) {
  const database = openDatabase(); const bundle = playerFixture(4);
  if (hostile) {
    bundle.passages[0]!.proseMarkdown = "</script><script>globalThis.PWNED=true</script>";
    bundle.bundleFingerprint = nativeBundleFingerprint(bundle);
  }
  const playerConfig = createNativePlayerConfig(playerConfigInput(bundle), bundle);
  const compiler = { compile: () => ({ bundle, playerConfig }) } as unknown as NativeCompilationService;
  return { database, bundle, playerConfig, service: new PublicationExportService(new PortableProjectRepository(database), compiler) };
}

test("static subdirectory publication plays, saves, rewinds, and reloads without authoring APIs", async ({ page }) => {
  const fixture = exportsFixture(); const publication = await fixture.service.exportStatic("ignored"); const files = unzipSync(publication.bytes);
  const requests: string[] = []; page.on("request", (request) => requests.push(request.url()));
  const server = createServer((request, response) => {
    const path = request.url?.replace(/^\/nested\//, "") || "index.html"; const bytes = files[path === "" ? "index.html" : path];
    if (!bytes) { response.statusCode = 404; response.end(); return; }
    response.setHeader("content-type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html");
    response.end(Buffer.from(bytes));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); const address = server.address();
  try {
    await page.goto(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/nested/index.html`);
    await expect(page.getByRole("heading", { name: "Passage 0" })).toBeVisible();
    await page.getByRole("button", { name: "Continue 1" }).click();
    await expect(page.getByRole("heading", { name: "Passage 1" })).toBeVisible();
    await page.getByRole("button", { name: "Save game" }).click(); await page.getByLabel("Save name").fill("Checkpoint");
    await page.getByRole("button", { name: "Create save" }).click(); await page.getByRole("button", { name: "Continue 2" }).click();
    await page.getByRole("button", { name: "Rewind" }).click(); await expect(page.getByRole("heading", { name: "Passage 1" })).toBeVisible();
    await page.reload(); await expect(page.getByRole("heading", { name: "Passage 1" })).toBeVisible();
    expect(requests.some((url) => /\/api\/|openrouter|provider/i.test(url))).toBe(false);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); fixture.database.close(); }
});

test("standalone file publication keeps hostile prose inert and remains playable", async ({ page }) => {
  const fixture = exportsFixture(true); const directory = await mkdtemp(join(tmpdir(), "cyoa-standalone-e2e-"));
  try {
    const result = await fixture.service.exportStandalone("ignored"); const file = join(directory, "story.html"); await writeFile(file, result.html, "utf8");
    await page.goto(pathToFileURL(file).href); await expect(page.getByRole("heading", { name: "Passage 0" })).toBeVisible();
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { PWNED?: boolean }).PWNED)).not.toBe(true);
    await page.getByRole("button", { name: "Continue 1" }).click(); await expect(page.getByRole("heading", { name: "Passage 1" })).toBeVisible();
  } finally { fixture.database.close(); await rm(directory, { recursive: true, force: true }); }
});

test("real compiled SugarCube route matches native runtime state", async ({ page }) => {
  const fixture = exportsFixture(); const directory = await mkdtemp(join(tmpdir(), "cyoa-sugarcube-e2e-"));
  try {
    const result = await fixture.service.exportTwee("ignored"); const file = join(directory, "story.html"); await writeFile(file, result.html);
    await page.goto(pathToFileURL(file).href); await page.getByText("Continue 1", { exact: true }).click();
    await page.getByText("Continue 2", { exact: true }).click();
    const sugarState = await page.evaluate(() => (globalThis as typeof globalThis & { SugarCube: { State: { variables: { cyoa: unknown } } } }).SugarCube.State.variables.cyoa);
    let native = createNativePlayerSession(fixture.bundle, fixture.playerConfig);
    native = chooseNativePlayerSession(fixture.bundle, fixture.playerConfig, native, "choice-0").session;
    native = chooseNativePlayerSession(fixture.bundle, fixture.playerConfig, native, "choice-1").session;
    expect(sugarState).toEqual(native.state);
  } finally { fixture.database.close(); await rm(directory, { recursive: true, force: true }); }
});
