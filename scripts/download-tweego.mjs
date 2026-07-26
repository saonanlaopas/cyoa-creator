import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const manifest = JSON.parse(await readFile(resolve(scriptDirectory, "tweego-manifest.json"), "utf8"));
const toolsDirectory = resolve(repositoryRoot, "tools");
const targetDirectory = resolve(toolsDirectory, "tweego");
const stagingDirectory = resolve(toolsDirectory, `.tweego-${process.pid}.tmp`);
const archivePath = resolve(toolsDirectory, `.tweego-${process.pid}.zip`);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The pinned Tweego downloader currently supports Windows x64 only");
}
if (existsSync(targetDirectory)) throw new Error(`Tweego already exists at ${targetDirectory}`);

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise(output)
      : reject(new Error(`${command} exited with ${code}: ${errors.trim()}`)));
  });
}

await mkdir(toolsDirectory, { recursive: true });
try {
  const response = await fetch(manifest.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Tweego download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== manifest.sha256) {
    throw new Error(`Tweego checksum mismatch: expected ${manifest.sha256}, received ${digest}`);
  }
  await writeFile(archivePath, archive);
  const listing = await run("tar", ["-tf", archivePath]);
  const unsafeEntry = listing.split(/\r?\n/).filter(Boolean).find((entry) =>
    entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry) ||
    entry.split(/[\\/]/).includes(".."));
  if (unsafeEntry) throw new Error(`Tweego archive contains an unsafe path: ${unsafeEntry}`);
  await mkdir(stagingDirectory);
  await run("tar", ["-xf", archivePath, "-C", stagingDirectory]);
  await rename(stagingDirectory, targetDirectory);
  console.log(`Tweego ${manifest.version} installed at ${targetDirectory}`);
} finally {
  await rm(archivePath, { force: true });
  await rm(stagingDirectory, { recursive: true, force: true });
}
