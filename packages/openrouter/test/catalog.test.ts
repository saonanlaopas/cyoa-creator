import { describe, expect, it } from "vitest";
import { estimateCost, parseModelCatalog, supportsStrictJsonSchema } from "../src/index.js";

describe("model catalog and cost estimates", () => {
  it("keeps model capability and per-token prices", () => {
    const [model] = parseModelCatalog({ data: [{
      id: "acme/model", name: "Acme", context_length: 128000,
      pricing: { prompt: "0.000002", completion: "0.000004" },
      supported_parameters: ["response_format", "temperature"],
    }] });
    expect(model).toMatchObject({ id: "acme/model", contextLength: 128000 });
    expect(supportsStrictJsonSchema(model)).toBe(true);
    expect(estimateCost(model, { inputTokens: 1000, outputTokens: 500 })).toEqual({
      currency: "USD", input: 0.002, output: 0.002, total: 0.004,
    });
  });
});
