// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DraftReviewQueue } from "../src/features/workspace/DraftReviewQueue.js";

const summary = {
  passageCount: 300, plannedPassageCount: 300, currentDraftCount: 2, currentCandidateCount: 2,
  acceptedDraftCount: 1, reviewedDraftCount: 0, lockedDraftCount: 0,
  staleCurrentCandidateCount: 0, staleAcceptedDraftCount: 0,
  currentCandidateWords: 1000, candidateWords: 1000, acceptedWords: 500, reviewedWords: 0,
  lockedWords: 0, staleAcceptedWords: 0, plannedWords: 150_000, remainingWords: 149_500,
  acceptanceCompletionPercentage: 0.33,
};
const items = Array.from({ length: 300 }, (_, index) => ({
  passageId: `passage-${String(index + 1).padStart(3, "0")}`,
  stableId: `passage-${String(index + 1).padStart(3, "0")}`,
  title: `Review passage ${index + 1}`,
  sequenceId: `sequence-${Math.floor(index / 10) + 1}`, actId: `act-${Math.floor(index / 100) + 1}`,
  routeIds: index % 2 ? ["route-b"] : ["route-a"], wordTarget: 500,
  currentVersionId: index < 2 ? `candidate-${index + 1}` : null,
  currentLifecycleStatus: index < 2 ? "candidate" : null,
  currentStatus: index < 2 ? "candidate" : "no-draft",
  currentSourceKind: index === 0 ? "generated" : index === 1 ? "manual" : null,
  currentWordCount: index < 2 ? 500 : 0,
  acceptedVersionId: index === 2 ? "accepted-3" : null,
  acceptedLifecycleStatus: index === 2 ? "accepted" : null,
  acceptedWordCount: index === 2 ? 500 : 0,
  acceptedStale: false, acceptedLocked: false, needsReview: index < 2,
}));
const preview = {
  projectId: "project-1",
  selections: [
    { passageId: "passage-001", candidateDraftVersionId: "candidate-1" },
    { passageId: "passage-002", candidateDraftVersionId: "candidate-2" },
  ],
  items: [], issues: [], downstreamStaleness: [], acceptedWordDelta: 1000,
  acceptedPassageDelta: 2, valid: true, fingerprint: "batch-fingerprint",
};
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("DraftReviewQueue", () => {
  it("keeps a 300-passage queue metadata-only, filterable, and stable-ID navigable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ items, summary }));
    const onSelectPassage = vi.fn();
    const user = userEvent.setup();
    render(<DraftReviewQueue projectId="project-1" selectedPassageId="passage-001" refreshKey={0}
      onSelectPassage={onSelectPassage} onChanged={vi.fn()} setMessage={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "Passage draft review queue" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(300);
    expect(list.textContent).not.toContain("proseMarkdown");
    expect(screen.getByLabelText("Draft corpus reporting").textContent).toContain("500 / 150");
    await user.type(screen.getByLabelText("Find passage"), "passage-300");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Review passage 300" }));
    expect(onSelectPassage).toHaveBeenCalledWith("passage-300");
  }, 10_000);

  it("previews and applies an exact two-candidate batch without loading prose or calling generation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const compactItems = items.slice(0, 3);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input); requests.push({ url, init });
      if (url.endsWith("/acceptance/preview")) return response(preview);
      if (url.endsWith("/acceptance/apply")) return response({ application: { id: "batch-1" }, preview, summary }, 201);
      return response({ items: compactItems, summary });
    });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<DraftReviewQueue projectId="project-1" selectedPassageId="passage-001" refreshKey={0}
      onSelectPassage={vi.fn()} onChanged={onChanged} setMessage={vi.fn()} />);
    await screen.findByRole("list", { name: "Passage draft review queue" });
    await user.click(screen.getByLabelText("Select Review passage 1 candidate"));
    await user.click(screen.getByLabelText("Select Review passage 2 candidate"));
    await user.click(screen.getByRole("button", { name: "Preview batch acceptance" }));
    await waitFor(() => expect(screen.getByText(/Ready · \+1000 accepted words/)).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Accept exact batch" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const apply = requests.find((item) => item.url.endsWith("/acceptance/apply"));
    expect(JSON.parse(String(apply?.init?.body))).toEqual({ selections: preview.selections, previewFingerprint: preview.fingerprint });
    expect(requests.some((item) => item.url.includes("/drafting/jobs") || item.url.endsWith("/start"))).toBe(false);
  }, 10_000);
});
