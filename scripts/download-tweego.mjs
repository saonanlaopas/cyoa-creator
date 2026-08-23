import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const manifest = JSON.parse(await readFile(resolve(scriptDirectory, "tweego-manifest.json"), "utf8"));
const platformKey = `${process.platform}-${process.arch}`;
const release = manifest.platforms[platformKey];
const toolsDirectory = resolve(repositoryRoot, "tools");
const targetDirectory = resolve(toolsDirectory, "tweego");
const stagingDirectory = resolve(toolsDirectory, `.tweego-${process.pid}.tmp`);
const archivePath = resolve(toolsDirectory, `.tweego-${process.pid}.zip`);

if (!release) throw new Error(`The pinned Tweego downloader does not support ${platformKey}`);
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
  const response = await fetch(release.url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Tweego download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== release.sha256) {
    throw new Error(`Tweego checksum mismatch: expected ${release.sha256}, received ${digest}`);
  }
  await writeFile(archivePath, archive);
  const listing = process.platform === "win32"
    ? await run("tar", ["-tf", archivePath])
    : await run("unzip", ["-Z1", archivePath]);
  const unsafeEntry = listing.split(/\r?\n/).filter(Boolean).find((entry) =>
    entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:/.test(entry) ||
    entry.split(/[\\/]/).includes(".."));
  if (unsafeEntry) throw new Error(`Tweego archive contains an unsafe path: ${unsafeEntry}`);
  await mkdir(stagingDirectory);
  if (process.platform === "win32") await run("tar", ["-xf", archivePath, "-C", stagingDirectory]);
  else await run("unzip", ["-q", archivePath, "-d", stagingDirectory]);
  await rename(stagingDirectory, targetDirectory);
  if (process.platform !== "win32") await run("chmod", ["755", resolve(targetDirectory, "tweego")]);
  console.log(`Tweego ${manifest.version} installed at ${targetDirectory}`);
} finally {
  await rm(archivePath, { force: true });
  await rm(stagingDirectory, { recursive: true, force: true });
}
