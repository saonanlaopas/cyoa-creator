// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceEvidenceRecovery } from "../src/features/workspace/SourceEvidenceRecovery.js";

const evidence = { sourceVersionId: "source-immutable", sourceFingerprint: "a".repeat(64), availability: "redacted" };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("A7 exact evidence recovery", () => {
  it("never labels a failed availability check as verified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}, 503));
    render(<SourceEvidenceRecovery projectId="project" onReattached={() => undefined} />);
    expect(await screen.findByRole("heading", { name: "Source evidence check failed" })).toBeTruthy();
    expect(screen.queryByText(/Source evidence verified/)).toBeNull();
  });

  it("keeps mismatches unavailable, then refreshes and focuses only after exact verification", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ evidence: [evidence], hasMore: false, omittedHistoryCount: 2 }))
      .mockResolvedValueOnce(response({ error: "The file does not match. Nothing was changed." }, 400))
      .mockResolvedValueOnce(response({ projectId: "project" }))
      .mockResolvedValueOnce(response({ evidence: [], hasMore: false, omittedHistoryCount: 2 }));
    const changed = vi.fn(), user = userEvent.setup();
    render(<SourceEvidenceRecovery projectId="project" onReattached={changed} />);
    const file = new File(["original material"], "source.txt", { type: "text/plain" });
    await user.upload(await screen.findByLabelText("Exact source file"), file);
    expect(await screen.findByText(/The file does not match/)).toBeTruthy();
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Source evidence unavailable" })).toBeTruthy();
    await user.upload(screen.getByLabelText("Exact source file"), file);
    const heading = await screen.findByRole("heading", { name: "Source evidence verified" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(changed).toHaveBeenCalledOnce();
    expect(screen.getByText(/Canonical provenance excerpts are not recovered conversation evidence/)).toBeTruthy();
    expect(fetch.mock.calls[1]![1]?.body).toBeInstanceOf(FormData);
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });

  it("paginates metadata without loading source or conversation bodies", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ evidence: [evidence], hasMore: true }))
      .mockResolvedValueOnce(response({ evidence: [{ ...evidence, sourceVersionId: "source-next" }], hasMore: false }));
    const user = userEvent.setup(); render(<SourceEvidenceRecovery projectId="project" onReattached={() => undefined} />);
    await user.click(await screen.findByRole("button", { name: "Next sources" }));
    await screen.findByText(/Reattach source source-next/);
    expect(String(fetch.mock.calls[1]![0])).toContain("source-availability?offset=20");
    expect(fetch.mock.calls.every(([, init]) => !init)).toBe(true);
  });
});
