import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("source import routes", () => {
  it("imports inert pasted text then requires explicit scope", async () => {
    const app = buildApp();
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Import" } })).json();
    const imported = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/source/text`,
      payload: { text: "Chapter 1\n\nSafe prose.", filename: "story.txt" },
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ scopeRequired: true, chapters: [{ title: "Chapter 1" }] });
    const chapterId = imported.json().chapters[0].id;
    expect((await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/source/scope`,
      payload: { chapterIds: [chapterId] },
    })).statusCode).toBe(201);
    await app.close();
  });

  it("imports a multipart HTML file without active content", async () => {
    const app = buildApp();
    const project = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "HTML" } })).json();
    const boundary = "test-boundary";
    const html = `<div id="workskin"><h2>Chapter 1</h2><p>Text</p><script>evil()</script></div>`;
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="work.html"\r\nContent-Type: text/html\r\n\r\n`,
      html,
      `\r\n--${boundary}--\r\n`,
    ].join("");
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/source`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });
});
