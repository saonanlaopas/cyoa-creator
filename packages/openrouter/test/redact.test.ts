import { describe, expect, it } from "vitest";
import { boundedDiagnosticBody, redactSecret, redactValue } from "../src/index.js";

describe("redaction", () => {
  it("removes keys from strings and structured diagnostic values", () => {
    const key = "sk-or-v1-super-secret-key-0123456789";
    expect(redactSecret(`Authorization: Bearer ${key}`)).not.toContain(key);
    expect(redactSecret(`OPENROUTER_API_KEY=${key}`)).not.toContain(key);
    expect(redactValue({ apiKey: key, nested: { note: key } })).toEqual({
      apiKey: "[REDACTED]", nested: { note: "[REDACTED]" },
    });
  });

  it("redacts and bounds preserved response evidence", () => {
    const key = "sk-or-v1-super-secret-key-0123456789";
    const body = boundedDiagnosticBody(`before ${key} after`, 12);
    expect(body).toMatchObject({ originalBytes: expect.any(Number), truncated: true });
    expect(body.text).not.toContain(key);
  });

  it("redacts sensitive fields in JSON response evidence", () => {
    const body = boundedDiagnosticBody(JSON.stringify({ apiKey: "non-pattern-secret" }));
    expect(body.text).not.toContain("non-pattern-secret");
  });
});
