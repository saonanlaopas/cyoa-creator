import { describe, expect, it } from "vitest";
import { redactSecret, redactValue } from "../src/index.js";

describe("redaction", () => {
  it("removes keys from strings and structured diagnostic values", () => {
    const key = "sk-or-v1-super-secret-key-0123456789";
    expect(redactSecret(`Authorization: Bearer ${key}`)).not.toContain(key);
    expect(redactSecret(`OPENROUTER_API_KEY=${key}`)).not.toContain(key);
    expect(redactValue({ apiKey: key, nested: { note: key } })).toEqual({
      apiKey: "[REDACTED]", nested: { note: "[REDACTED]" },
    });
  });
});
