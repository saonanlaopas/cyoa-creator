import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { authorDemo } from "./author.js";
import { demoHost } from "./host.js";
import { applyDemoWorld, exportDemo } from "./artifacts.js";

const output = resolve(process.argv[2] ?? "exports/w6-demo");
await mkdir(output, { recursive: true });
if ((await readdir(output)).length) throw new Error("Choose an empty output directory; existing evidence is preserved.");
const directory = await mkdtemp(join(tmpdir(), "cyoa-w6-demo-")), projectId = randomUUID();
const host = await demoHost(directory, projectId, "creator.sqlite", fileURLToPath(new URL("../../", import.meta.url)));
try {
  await host.call("create_project", { projectId, operationId: randomUUID(), approved: true, name: "The Last Harbor Signal · W6" });
  const demo = await authorDemo(host.call, projectId, directory), modes = [];
  for (const [mode, world] of [["chapter-led", demo.world], ["chapter-free", demo.freeWorld]] as const) {
    await applyDemoWorld(host, projectId, world); modes.push(await exportDemo(host, projectId, output, mode));
    await writeFile(join(output, `${mode}-world.json`), JSON.stringify(world, null, 2) + "\n");
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify({ projectId, modes, assets: demo.assetEvidence, authoring: "Explicit shared MCP review/apply/approval; verified backup through Creator HTTP", providerCalls: 0, operationNames: host.calls }, null, 2) + "\n");
  console.log(`Created both standalone/static games and verified source backups in ${output}`);
} finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
