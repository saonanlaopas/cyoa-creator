import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "../src/config.js";

describe("readRuntimeConfig", () => {
  it("rejects a non-loopback HOST", () => {
    expect(() => readRuntimeConfig({ HOST: "0.0.0.0" })).toThrow(
      "HOST must be a loopback address",
    );
  });
});
