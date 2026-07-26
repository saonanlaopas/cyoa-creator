import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("reports the local service version", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, service: "story-to-cyoa" });

    await app.close();
  });
});
