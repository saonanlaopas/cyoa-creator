import { describe, expect, it } from "vitest";
import { PowerShellDpapiAdapter } from "../src/powershell-dpapi-adapter.js";

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
});
