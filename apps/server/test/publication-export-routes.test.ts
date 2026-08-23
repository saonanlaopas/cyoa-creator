import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("publication export HTTP boundary", () => {
  it("downloads a portable archive, previews it without writes, and rejects collision import", async () => {
    const app = buildApp(); apps.push(app);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Portable", mode: "long-form" } });
    const projectId = created.json().id as string;
    const exported = await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/publication/exports/portable` });
    expect(exported.statusCode).toBe(200); expect(exported.headers["content-type"]).toContain("application/zip");
    expect(exported.headers["content-disposition"]).toContain("cyoa-portable-project.zip");
    expect(exported.headers["x-cyoa-artifact-fingerprint"]).toMatch(/^[0-9a-f]{32}$/);
    expect(exported.headers["x-content-type-options"]).toBe("nosniff");
    const boundary = "foundation-7c-boundary";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="project.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      exported.rawPayload, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const preview = await app.inject({ method: "POST", url: "/api/portable-projects/preview", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(preview.statusCode).toBe(200); expect(preview.json()).toMatchObject({ projectName: "Portable", conflict: true });
    const projects = await app.inject({ method: "GET", url: "/api/projects" }); expect(projects.json()).toHaveLength(1);
    const imported = await app.inject({ method: "POST", url: "/api/portable-projects/import", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload });
    expect(imported.statusCode).toBe(409); expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toHaveLength(1);
  });
});
