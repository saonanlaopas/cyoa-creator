import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WindowsDpapiAdapter } from "./windows-credential-store.js";

const OPENROUTER_SERVICE = "story-to-cyoa/openrouter";

export type PowerShellRunner = (
  args: string[],
  stdin: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface PowerShellChildProcess {
  stdin: {
    end(input: string): unknown;
    once(event: "error", listener: (error: Error) => void): unknown;
  };
  stdout: {
    setEncoding(encoding: string): unknown;
    on(event: "data", listener: (chunk: string) => void): unknown;
  };
  stderr: {
    setEncoding(encoding: string): unknown;
    on(event: "data", listener: (chunk: string) => void): unknown;
  };
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (exitCode: number | null) => void): unknown;
}

export type PowerShellSpawner = (
  command: string,
  args: string[],
  options: { stdio: ["pipe", "pipe", "pipe"]; windowsHide: boolean },
) => PowerShellChildProcess;

export interface PowerShellDpapiAdapterOptions {
  localAppData?: string;
  /** Test-only override for the credential file; its parent is the credential directory. */
  encryptedPath?: string;
  credentialDirectory?: string;
  runner?: PowerShellRunner;
}

/**
 * Stores the OpenRouter key as a DPAPI blob for the current Windows user.
 * Plaintext is passed only through the child process's standard input.
 */
export class PowerShellDpapiAdapter implements WindowsDpapiAdapter {
  private readonly encryptedPath: string;
  private readonly credentialDirectory: string;
  private readonly runner: PowerShellRunner;

  public constructor(options: PowerShellDpapiAdapterOptions = {}) {
    const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
    if (!options.encryptedPath && !options.credentialDirectory && !localAppData) {
      throw new Error("LOCALAPPDATA is required for the Windows credential store");
    }
    const defaultDirectory = join(localAppData ?? ".", "StoryToCYOA", "credentials");
    const configuredPath = options.encryptedPath ?? join(options.credentialDirectory ?? defaultDirectory, "openrouter.dpapi");
    this.credentialDirectory = resolve(options.credentialDirectory ?? (options.encryptedPath ? dirname(configuredPath) : defaultDirectory));
    this.encryptedPath = resolve(configuredPath);
    if (!isPathWithinDirectory(this.encryptedPath, this.credentialDirectory)) {
      throw new Error("Credential path must remain within the credential directory");
    }
    this.runner = options.runner ?? runPowerShell;
  }

  public async get(service: string): Promise<string | null> {
    this.assertService(service);
    const result = await this.run(getScript(this.encryptedPath), "");
    return result.stdout || null;
  }

  public async set(service: string, value: string): Promise<void> {
    this.assertService(service);
    await this.run(setScript(this.encryptedPath), value);
  }

  public async delete(service: string): Promise<void> {
    this.assertService(service);
    if (!isPathWithinDirectory(this.encryptedPath, this.credentialDirectory)) {
      throw new Error("Credential path must remain within the credential directory");
    }
    await this.run(deleteScript(this.encryptedPath), "");
  }

  private assertService(service: string): void {
    if (service !== OPENROUTER_SERVICE) throw new Error("Unsupported credential service");
  }

  private async run(script: string, stdin: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const result = await this.runner(["-NoProfile", "-NonInteractive", "-Command", script], stdin);
      if (result.exitCode !== 0) throw new Error("PowerShell failed");
      return result;
    } catch {
      // Do not propagate stderr or child-process messages: either may contain input.
      throw new Error("Windows credential operation failed");
    }
  }
}

function isPathWithinDirectory(filePath: string, directory: string): boolean {
  const relativePath = relative(directory, filePath);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function setScript(path: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    `$credentialPath = ${quotePowerShell(path)}`,
    "$inputText = [Console]::In.ReadToEnd()",
    "$directory = [IO.Path]::GetDirectoryName($credentialPath)",
    "[IO.Directory]::CreateDirectory($directory) | Out-Null",
    "$ciphertext = [System.Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($inputText), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[IO.File]::WriteAllText($credentialPath, [Convert]::ToBase64String($ciphertext), [Text.Encoding]::UTF8)",
  ].join("; ");
}

function getScript(path: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Security",
    `$credentialPath = ${quotePowerShell(path)}`,
    "if (-not [IO.File]::Exists($credentialPath)) { exit 0 }",
    "$encoded = [IO.File]::ReadAllText($credentialPath).Trim()",
    "if ([string]::IsNullOrEmpty($encoded)) { exit 0 }",
    "$plaintext = [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($encoded), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plaintext))",
  ].join("; ");
}

function deleteScript(path: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$credentialPath = ${quotePowerShell(path)}`,
    "if ([IO.File]::Exists($credentialPath)) { [IO.File]::Delete($credentialPath) }",
  ].join("; ");
}

/** Creates the default runner with an injectable process boundary for lifecycle tests. */
export function createPowerShellRunner(
  spawnProcess: PowerShellSpawner = (command, args, options) => spawn(command, args, options),
): PowerShellRunner {
  return (args, stdin) => new Promise((resolveRun, rejectRun) => {
    let settled = false;
    const rejectProcess = () => {
      if (settled) return;
      settled = true;
      rejectRun(new Error("PowerShell process failed"));
    };
    let child: PowerShellChildProcess;
    try {
      child = spawnProcess("powershell.exe", args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch {
      rejectProcess();
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", rejectProcess);
    child.stdin.once("error", rejectProcess);
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      resolveRun({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    try {
      child.stdin.end(stdin);
    } catch {
      rejectProcess();
    }
  });
}

const runPowerShell = createPowerShellRunner();
