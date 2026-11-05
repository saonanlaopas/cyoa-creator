import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertFormatOnlyRepair, formatRepairBaseline, FormatOnlyRepairError, OpenRouterClient, EnvironmentCredentialStore } from "../src/index.js";
describe("format-only repair content boundary", () => {
  const original = { prose: "I will not promise.\n\n‘Stay,’ she said.  ", choices: [{ label: "Refuse", cost: 2 }], flag: false };
  const raw = JSON.stringify(original);
  it.each([raw.slice(0,-1), "```json\n" + raw + "\n```", raw.slice(0,-1) + ",}"])("recovers only a complete unambiguous value with wrapper damage", damaged => {
    expect(formatRepairBaseline(damaged)).toEqual(original);
    expect(() => assertFormatOnlyRepair(damaged, raw)).not.toThrow();
  });
  it.each(["{bad", '{"prose":"truncated', '{"prose":"one","prose":"two"}', '{"prose":"done",', '[1,', '{"prose":', '{"a":01}', '{"a":1e}', '{"a":"\\uZZZZ"}'])("rejects uncertain or duplicate original: %s", damaged => {
    expect(() => formatRepairBaseline(damaged)).toThrow(FormatOnlyRepairError);
  });
  it.each([
    { ...original, prose: original.prose.replace("not ", "") },
    { ...original, prose: original.prose.trim() },
    { ...original, prose: original.prose.replace("\n\n", "\n") },
    { ...original, choices: [{ label: "Accept", cost: 2 }] },
    { ...original, flag: true },
    { ...original, extra: "inferred" },
  ])("rejects a schema-valid substantive change atomically", changed => {
    expect(() => assertFormatOnlyRepair(raw.slice(0,-1), JSON.stringify(changed))).toThrow(/changed substantive content/);
  });
  it("allows key order and equivalent JSON escape spelling but retains decoded strings exactly", () => {
    expect(() => assertFormatOnlyRepair('{"b":2,"a":"\\u0061"', '{"a":"a","b":2}')).not.toThrow();
  });
  it.each([false, true])("blocks adversarial valid repair in %s streaming mode before returning success", async streaming => {
    let count = 0;
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "test" } }), fetch: async () => {
      const content = ++count === 1 ? '{"prose":"No promise."' : '{"prose":"A promise."}';
      if (streaming) return new Response('data: '+JSON.stringify({ choices: [{ delta: { content } }] })+'\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    } });
    const request = { model: "neutral", messages: [{ role: "user" as const, content: "draft" }] }, schema = z.object({ prose: z.string() });
    await expect(streaming ? client.generateStructuredStream(request, schema) : client.generateStructured(request, schema)).rejects.toMatchObject({ code: "format_repair_content_changed", retryable: false });
    expect(count).toBe(2);
  });
  it("makes no repair call when a reliable baseline is missing", async () => {
    let calls = 0;
    const client = new OpenRouterClient({ credentialStore: new EnvironmentCredentialStore({ environment: { OPENROUTER_API_KEY: "test" } }), fetch: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: '{"prose":"cut' } }] })); } });
    await expect(client.generateStructured({ model: "neutral", messages: [] }, z.object({ prose: z.string() }))).rejects.toMatchObject({ code: "format_repair_original_unverifiable" });
    expect(calls).toBe(1);
  });
});
