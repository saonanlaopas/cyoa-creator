// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassageProposalReview } from "../src/features/workspace/PassageProposalReview.js";
import type { GenerationJob, PassageProposalPreview, PassageProposalSet } from "../src/api/passage-generation.js";

const job: GenerationJob = {
  id: "job-a", projectId: "project-a", planId: "plan-a", planFingerprint: "f".repeat(64),
  status: "completed", units: [], updatedAt: "2026-08-10T00:00:00.000Z",
};

const operation = (id: string, entityId: string) => ({
  id, kind: "update-entity" as const, entityKind: "passage" as const, entityId,
  baseVersionId: `version-${entityId}`,
  fieldDiffs: [{ field: "planningStatus", before: "planned", after: "reviewed" }],
  sourceCandidateIds: [`candidate-${entityId}`],
});

const proposal: PassageProposalSet = {
  id: "proposal-a", projectId: "project-a", generationPlanId: "plan-a", generationJobId: "job-a",
  generationPlanFingerprint: "f".repeat(64), snapshotId: "snapshot-a",
  proposalSchemaId: "cyoa.passage-planning-proposal-set", proposalSchemaVersion: 1,
  candidateIds: ["candidate-a", "candidate-b"], consolidationFingerprint: "c".repeat(64), status: "proposed",
  groups: [{
    id: "group-a", unitId: "unit-a", position: 0, label: "Unit 1", summary: "Review passage A",
    operationIds: ["operation-a"], dependsOnGroupIds: [], affectedEntityIds: ["passage-a"],
    downstreamInvalidations: ["passage-plan-approval", "passage-plan-validation"], validationFindingIds: [],
    safeToApplyIndependently: true, status: "proposed", operations: [operation("operation-a", "passage-a")],
  }, {
    id: "group-b", unitId: "unit-b", position: 1, label: "Unit 2", summary: "Review passage B",
    operationIds: ["operation-b"], dependsOnGroupIds: ["group-a"], affectedEntityIds: ["passage-b"],
    downstreamInvalidations: ["passage-plan-approval", "passage-plan-validation"], validationFindingIds: ["finding-b"],
    safeToApplyIndependently: false, status: "proposed", operations: [operation("operation-b", "passage-b")],
  }], applications: [], createdAt: "2026-08-10T00:00:00.000Z",
};

const preview: PassageProposalPreview = {
  id: "preview-a", proposalId: proposal.id, selectedGroupIds: ["group-a", "group-b"],
  selectedOperationIds: ["operation-a", "operation-b"], affectedEntityIds: ["passage-a", "passage-b"],
  downstreamInvalidations: ["passage-plan-approval", "passage-plan-validation"],
  beforeAfter: [{
    operationId: "operation-a", entityKind: "passage", entityId: "passage-a",
    fieldDiffs: [{ field: "planningStatus", before: "planned", after: "reviewed" }],
  }], previewFingerprint: "p".repeat(64), valid: true, hardErrors: [], warnings: [], stalePreconditions: [],
  createdAt: "2026-08-10T00:01:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PassageProposalReview", () => {
  it("creates locally, makes dependencies explicit, previews field changes, applies, and reloads audit state", async () => {
    const requests: Array<{ path: string; method: string; body?: { groupIds?: string[]; previewFingerprint?: string } }> = [];
    let listed: PassageProposalSet[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path, method, body });
      let response: unknown;
      if (path.endsWith("/proposals") && method === "GET") response = listed;
      else if (path.endsWith("/jobs/job-a/proposals")) { listed = [proposal]; response = proposal; }
      else if (path.endsWith("/preview")) response = preview;
      else if (path.endsWith("/apply")) {
        const applied: PassageProposalSet = {
          ...proposal, status: "applied", groups: proposal.groups.map((group) => ({ ...group, status: "applied" })),
          applications: [{
            id: "application-a", selectedGroupIds: ["group-a", "group-b"],
            appliedOperationIds: ["operation-a", "operation-b"],
            previousVersionIds: { "passage:passage-a": "version-passage-a" },
            resultingVersionIds: { "passage:passage-a": "version-passage-a-2" },
            validationPreviewFingerprint: preview.previewFingerprint, createdAt: "2026-08-10T00:02:00.000Z",
          }],
        };
        listed = [applied]; response = applied;
      } else response = { error: "Unexpected request" };
      return new Response(JSON.stringify(response), {
        status: "error" in (response as Record<string, unknown>) ? 500 : 200,
        headers: { "content-type": "application/json" },
      });
    });

    const user = userEvent.setup();
    const onApplied = vi.fn(async () => undefined);
    render(<PassageProposalReview
      projectId="project-a" job={job} busy={false} setBusy={vi.fn()} setMessage={vi.fn()} onApplied={onApplied}
    />);

    await user.click(await screen.findByRole("button", { name: "Create proposal set" }));
    expect(await screen.findByText("2 coherent groups / 2 validated candidates")).toBeTruthy();
    const first = screen.getByRole("checkbox", { name: "Select Unit 1" }) as HTMLInputElement;
    const dependent = screen.getByRole("checkbox", { name: "Select Unit 2" }) as HTMLInputElement;
    expect(first.checked).toBe(true);
    expect(dependent.checked).toBe(false);
    await user.click(dependent);
    expect(first.checked).toBe(true);
    expect(dependent.checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Refresh validation preview" }));
    expect((await screen.findByRole("region", { name: "Proposal validation preview" })).textContent).toContain("Preview valid");
    expect(screen.getByText(/planned -> reviewed/)).toBeTruthy();
    expect(requests.find((item) => item.path.endsWith("/preview"))?.body?.groupIds?.sort()).toEqual(["group-a", "group-b"]);

    await user.click(screen.getByRole("button", { name: "Apply reviewed selection" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledOnce());
    expect(await screen.findByText("Application history (1)")).toBeTruthy();
    expect(requests.find((item) => item.path.endsWith("/apply"))?.body?.previewFingerprint).toBe(preview.previewFingerprint);
    expect(requests.every((item) => item.path.includes("/passage-generation/") && item.path.includes("/proposals"))).toBe(true);
  });
});
