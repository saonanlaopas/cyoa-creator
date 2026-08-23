import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { resolvePortableUploadLimit } from "../src/routes/publication-exports.js";
import { PORTABLE_PROJECT_LIMITS } from "../src/services/publication-export-service.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe("publication export HTTP boundary", () => {
  it("wires the exact production portable ceiling and never permits configuration above it", () => {
    expect(resolvePortableUploadLimit()).toBe(PORTABLE_PROJECT_LIMITS.archiveBytes);
    expect(resolvePortableUploadLimit(PORTABLE_PROJECT_LIMITS.archiveBytes + 1)).toBe(PORTABLE_PROJECT_LIMITS.archiveBytes);
  });

  it("enforces the same streaming portable ceiling for preview and import independently of source limits", async () => {
    const app = buildApp({ maxImportBytes: 64, maxPortableProjectBytes: 1_024 }); apps.push(app);
    for (const url of ["/api/portable-projects/preview", "/api/portable-projects/import"]) {
      for (const size of [1_023, 1_024]) {
        const acceptedTransport = multipart(Buffer.alloc(size, 0x61), `portable-within-${size}-${url.endsWith("import") ? "i" : "p"}`);
        const reachedParser = await app.inject({ method: "POST", url, headers: acceptedTransport.headers, payload: acceptedTransport.payload });
        expect(reachedParser.statusCode).toBe(400);
        expect(reachedParser.json().error).not.toContain("upload_too_large");
      }
      const above = multipart(Buffer.alloc(1_025, 0x61), `portable-above-${url.endsWith("import") ? "i" : "p"}`);
      const rejected = await app.inject({ method: "POST", url, headers: above.headers, payload: above.payload });
      expect(rejected.statusCode).toBe(413);
      expect(rejected.json().error).toContain("upload_too_large");
    }
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toHaveLength(0);

    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Source limit" } })).json();
    const source = multipart(Buffer.alloc(65, 0x61), "source-over", "story.txt", "text/plain");
    const sourceResponse = await app.inject({ method: "POST", url: `/api/projects/${project.id}/source`, headers: source.headers, payload: source.payload });
    expect(sourceResponse.statusCode).not.toBe(201);
  });

  it("does not apply the former 25 MiB source default to portable uploads", async () => {
    const app = buildApp({ maxImportBytes: 64 }); apps.push(app);
    const upload = multipart(Buffer.alloc(26 * 1024 * 1024, 0x61), "portable-over-old-default");
    const response = await app.inject({ method: "POST", url: "/api/portable-projects/preview", headers: upload.headers, payload: upload.payload });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).not.toContain("upload_too_large");
  }, 30_000);

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

function multipart(bytes: Buffer, boundary: string, filename = "project.zip", contentType = "application/zip") {
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
      bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
