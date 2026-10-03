import { expect } from "vitest";
import type { buildApp } from "../src/app.js";

export async function adoptPassageAdaptation(app: ReturnType<typeof buildApp>, projectId: string) {
  const source = `/api/long-form/projects/${projectId}/source-analysis`;
  const imported = await app.inject({ method: "POST", url: `/api/projects/${projectId}/source/text`, payload: { text: "Chapter 1\n\nRen dies during the harbor collapse." } });
  expect(imported.statusCode, imported.body).toBeLessThan(300);
  await app.inject({ method: "POST", url: `${source}/scope`, payload: { entireWork: true } });
  const plan = (await app.inject({ method: "POST", url: `${source}/preview`, payload: {} })).json();
  const started = await app.inject({ method: "POST", url: `${source}/plans/${plan.id}/start`, payload: { fingerprint: plan.fingerprint } });
  expect(started.statusCode, started.body).toBe(201);
  await expect.poll(async () => (await app.inject({ url: `${source}/jobs/${started.json().id}` })).json().status).toBe("completed");
  const dossier = (await app.inject({ url: `${source}/dossier` })).json();
  expect((await app.inject({ method: "POST", url: `${source}/approve`, payload: { versionId: dossier.id } })).statusCode).toBe(200);
  const adopted = await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/adaptation-intent/create`, payload: {} });
  expect(adopted.statusCode, adopted.body).toBe(200);
  return adopted.json();
}
