import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultCredentialStore,
  createPowerShellRunner,
  PowerShellDpapiAdapter,
  type PowerShellChildProcess,
} from "../src/index.js";

describe("PowerShellDpapiAdapter", () => {
  it("passes plaintext through stdin rather than command arguments", async () => {
    const key = "sk-or-v1-never-put-this-in-a-command-0123456789";
    const invocations: Array<{ args: string[]; stdin: string }> = [];
    const adapter = new PowerShellDpapiAdapter({
      encryptedPath: "C:\\temp\\openrouter.dpapi",
      runner: async (args, stdin) => {
        invocations.push({ args, stdin });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await adapter.set("story-to-cyoa/openrouter", key);

    expect(invocations).toHaveLength(1);
    expect(invocations[0].args.join(" ")).not.toContain(key);
    expect(invocations[0].stdin).toBe(key);
    expect(invocations[0].args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    expect(invocations[0].args[3]).toContain("[System.Security.Cryptography.ProtectedData]::Protect");
    expect(invocations[0].args[3]).toContain("[System.Security.Cryptography.DataProtectionScope]::CurrentUser");
    expect(invocations[0].args[3]).toContain("Add-Type -AssemblyName System.Security");
  });

  it("returns captured stdout for reads and leaves stdin empty", async () => {
    const invocations: Array<{ args: string[]; stdin: string }> = [];
    const adapter = new PowerShellDpapiAdapter({
      encryptedPath: "C:\\temp\\openrouter.dpapi",
      runner: async (args, stdin) => {
        invocations.push({ args, stdin });
        return { exitCode: 0, stdout: "stored-key", stderr: "" };
      },
    });

    await expect(adapter.get("story-to-cyoa/openrouter")).resolves.toBe("stored-key");
    expect(invocations[0].stdin).toBe("");
  });

  it("invokes the fixed delete script without plaintext stdin", async () => {
    const invocations: Array<{ args: string[]; stdin: string }> = [];
    const adapter = new PowerShellDpapiAdapter({
      encryptedPath: "C:\\temp\\credentials\\openrouter.dpapi",
      runner: async (args, stdin) => {
        invocations.push({ args, stdin });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await adapter.delete("story-to-cyoa/openrouter");

    expect(invocations).toHaveLength(1);
    expect(invocations[0].stdin).toBe("");
    expect(invocations[0].args[3]).toContain("[IO.File]::Delete($credentialPath)");
    expect(invocations[0].args[3]).toContain("C:\\temp\\credentials\\openrouter.dpapi");
  });

  it("rejects a credential path outside its configured credential directory", () => {
    expect(() => new PowerShellDpapiAdapter({
      credentialDirectory: "C:\\temp\\credentials",
      encryptedPath: "C:\\temp\\other\\openrouter.dpapi",
      runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    })).toThrow("Credential path must remain within the credential directory");
  });

  it("rejects services other than the OpenRouter credential", async () => {
    const adapter = new PowerShellDpapiAdapter({
      encryptedPath: "C:\\temp\\openrouter.dpapi",
      runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });

    await expect(adapter.delete("other-service")).rejects.toThrow("Unsupported credential service");
  });

  it("does not expose PowerShell output when an operation fails", async () => {
    const adapter = new PowerShellDpapiAdapter({
      encryptedPath: "C:\\temp\\openrouter.dpapi",
      runner: async () => ({ exitCode: 1, stdout: "secret-output", stderr: "secret-error" }),
    });

    await expect(adapter.set("story-to-cyoa/openrouter", "key")).rejects.toThrow("Windows credential operation failed");
  });

  it("settles stdin write failures without exposing plaintext input", async () => {
    const sentinel = "stdin-write-sentinel-must-not-leak";
    const child = fakeChildProcess();
    const runner = createPowerShellRunner(() => child);
    const result = runner(["-NoProfile"], sentinel);

    child.stdin.emit("error", new Error(`EPIPE ${sentinel}`));

    await expect(result).rejects.toThrow("PowerShell process failed");
    await expect(result).rejects.not.toThrow(sentinel);
    expect(child.stdin.end).toHaveBeenCalledWith(sentinel);
  });

  it("selects the injected Windows secure store instead of the environment fallback", async () => {
    const calls: string[] = [];
    const store = createDefaultCredentialStore({
      platform: "win32",
      localAppData: "C:\\temp\\local-app-data",
      environment: { OPENROUTER_API_KEY: "environment-key" },
      windowsAdapter: {
        get: async () => "secure-key",
        set: async (_service, value) => { calls.push(value); },
        delete: async () => undefined,
      },
    });

    await expect(store.getOpenRouterKey()).resolves.toBe("secure-key");
    await store.setOpenRouterKey("saved-key");
    expect(calls).toEqual(["saved-key"]);
  });

  it("uses the environment fallback when Windows secure storage is unavailable", async () => {
    const store = createDefaultCredentialStore({
      platform: "win32",
      localAppData: "",
      environment: { OPENROUTER_API_KEY: "environment-key" },
    });

    await expect(store.getOpenRouterKey()).resolves.toBe("environment-key");
  });
});

function fakeChildProcess(): PowerShellChildProcess {
  const child = new EventEmitter() as PowerShellChildProcess;
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  return child;
}
