import { randomUUID, createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DemoHost } from "./host.js";

export async function applyDemoWorld(host: DemoHost, projectId: string, world: unknown) {
  const review = await host.call("review_world", { projectId, world });
  return host.call("apply_world", { projectId, world, fingerprint: review.fingerprint, approved: true, operationId: randomUUID() });
}
export async function exportDemo(host: DemoHost, projectId: string, directory: string, mode: string) {
  const ready = await host.call("publication_readiness", { projectId });
  if (!ready.ready) throw new Error(`Demo not publication-ready: ${JSON.stringify(ready)}`);
  const build = await host.call("compile_game", { projectId, operationId: randomUUID(), approved: true, headFingerprint: ready.headFingerprint, fingerprint: ready.fingerprint });
  const artifacts: Array<{ file: string; sha256: string; bytes: number }> = [];
  for (const format of ["standalone", "static"] as const) {
    const exported = await host.call("export_game", { projectId, buildVersionId: build.buildVersionId, format });
    const bytes = Buffer.from(await (await host.response(exported.downloadPath)).arrayBuffer()), file = `${mode}.${format === "standalone" ? "html" : "zip"}`;
    await writeFile(join(directory, file), bytes); artifacts.push({ file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  }
  const backup = await host.response(`/api/projects/${projectId}/recovery/backups`, { method: "POST" });
  if (backup.headers.get("x-cyoa-backup-verification") !== "verified") throw new Error("Demo backup was not verified");
  const bytes = Buffer.from(await backup.arrayBuffer()), file = `${mode}.cyoa-backup.zip`; await writeFile(join(directory, file), bytes);
  artifacts.push({ file, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  return { mode, build, artifacts };
}
