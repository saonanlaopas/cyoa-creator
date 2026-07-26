import { describe, expect, it } from "vitest";
import { parseOpenRouterStream } from "../src/index.js";

const sseResponse = (values: Array<unknown | "[DONE]">) => new Response(
  values.map((value) => `data: ${value === "[DONE]" ? value : JSON.stringify(value)}\n\n`).join(""),
  { headers: { "content-type": "text/event-stream" } },
);

describe("parseOpenRouterStream", () => {
  it("collects content and emits reasoning text", async () => {
    const response = sseResponse([
      { choices: [{ delta: { reasoning: "Considering routes. " } }] },
      { choices: [{ delta: { content: '{"title":' } }] },
      { choices: [{ delta: { content: '"ok"}' }, finish_reason: "stop" }], usage: { total_tokens: 12 } },
      "[DONE]",
    ]);
    const reasoning: string[] = [];
    const result = await parseOpenRouterStream(response, {
      onReasoning: (event) => reasoning.push(event.text ?? ""),
    });
    expect(result.content).toBe('{"title":"ok"}');
    expect(reasoning.join("")).toBe("Considering routes. ");
    expect(result.usage).toMatchObject({ totalTokens: 12 });
  });

  it("labels summaries and encrypted reasoning", async () => {
    const events: Array<{ kind: string; text?: string }> = [];
    await parseOpenRouterStream(sseResponse([
      { choices: [{ delta: { reasoning_details: [
        { type: "reasoning.summary", summary: "Outlined branches." },
        { type: "reasoning.encrypted", data: "opaque" },
      ] } }] },
      "[DONE]",
    ]), { onReasoning: (event) => events.push(event) });
    expect(events).toEqual([
      { kind: "summary", text: "Outlined branches." },
      { kind: "encrypted" },
    ]);
  });

  it("labels unsupported reasoning details as unavailable without exposing their payload", async () => {
    const events: Array<{ kind: string; text?: string }> = [];
    await parseOpenRouterStream(sseResponse([
      { choices: [{ delta: { reasoning_details: [{ type: "reasoning.private", text: "do not expose" }] } }] },
      "[DONE]",
    ]), { onReasoning: (event) => events.push(event) });
    expect(events).toEqual([{ kind: "unavailable" }]);
  });

  it("throws STREAM_INTERRUPTED when the stream has no terminal event", async () => {
    await expect(parseOpenRouterStream(sseResponse([
      { choices: [{ delta: { content: '{"title":' } }] },
    ]), {})).rejects.toMatchObject({ code: "STREAM_INTERRUPTED" });
  });

  it("throws CANCELLED when the caller cancels while reading", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(controllerForStream) {
        controllerForStream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"{\\"title\\":"}}]}\n\n'));
      },
    });
    const completion = parseOpenRouterStream(new Response(stream), {}, controller.signal);
    controller.abort();
    await expect(completion).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("throws the typed in-band provider error", async () => {
    const response = sseResponse([{ error: {
      code: 429,
      message: "Rate limit",
      metadata: { error_type: "rate_limit_exceeded" },
    } }]);
    await expect(parseOpenRouterStream(response, {})).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("redacts secrets from in-band provider evidence", async () => {
    const secret = "sk-or-v1-test-secret-key-0123456789";
    const error = await parseOpenRouterStream(sseResponse([{ error: {
      code: 500,
      message: `Provider failed with ${secret}`,
      metadata: { error_type: "provider_unavailable" },
    } }]), {}).catch((reason: unknown) => reason);
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
