import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config.js";
import vitestConfig from "../../../vitest.config.ts";

describe("readRuntimeConfig", () => {
  it("rejects a non-loopback HOST", () => {
    expect(() => readRuntimeConfig({ HOST: "0.0.0.0" })).toThrow(
      "HOST must be a loopback address",
    );
  });

  it("caps Vitest workers at four for the full test suite", () => {
    expect(vitestConfig.test?.maxWorkers).toBe(4);
  });
});
