// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreativeDirectionWorkspace } from "../src/features/workspace/CreativeDirectionWorkspace.js";
import type { CreativeDirection } from "../src/api/long-form.js";

const content: CreativeDirection = {
  schemaId: "cyoa.creative-direction", schemaVersion: 1,
  tone: { descriptors: ["tense", "uncanny"], tonalRange: "focused", exclusions: [], customGuidance: "" },
  pacing: { developmentPace: "measured", sceneTreatment: "scene-focused", actionIntensity: "moderate", narrativeDensity: "dense", transitionDensity: "sparse", quietScenesAllowed: true, escalationShape: "stepped", customGuidance: "Investigative escalation" },
  prose: { descriptiveness: "restrained", treatment: "long-form", pointOfView: "third-person-close", tense: "past", interiority: "high", dialogueIntegration: "integrated", sceneTransitionDensity: "sparse", passageLengthPreference: "expansive", voiceDescriptors: [], avoid: [], customGuidance: "" },
  scopedVariations: [], fieldProvenance: [{ fieldPath: "/tone", reference: { kind: "manual-edit", excerpt: "Configured for mystery" } }],
  materialFingerprint: "a".repeat(64), provenanceFingerprint: "b".repeat(64),
};
const artifact = { id: "direction-v1", projectId: "project-1", artifactId: "creative-direction", version: 1, stale: false, createdAt: "t", content };
const workflow = { projectId: "project-1", artifactId: "creative-direction", status: "draft" as const, approvedVersionId: null, updatedAt: "t" };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("CreativeDirectionWorkspace", () => {
  it("presents legacy adoption as an explicit unapproved draft action", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ artifact, workflow, conflicts: [] }), {
      status: 201, headers: { "content-type": "application/json" },
    }));
    const changed = vi.fn();
    const user = userEvent.setup();
    render(<CreativeDirectionWorkspace projectId="project-1" direction={null}
      workflow={{ ...workflow, status: "empty" }} busy={false} message={null}
      setBusy={() => {}} setMessage={() => {}} onChanged={changed} />);
    expect(screen.getByText(/Nothing is approved automatically/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create adoption draft" }));
    expect(changed).toHaveBeenCalled();
  });

  it("shows a non-romance friendly summary, progressive advanced editor, provenance, and saves exact fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      creativeDirection: { ...artifact, id: "direction-v2", version: 2 }, workflow,
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const user = userEvent.setup();
    render(<CreativeDirectionWorkspace projectId="project-1" direction={artifact} workflow={workflow}
      busy={false} message={null} setBusy={() => {}} setMessage={() => {}} onChanged={() => {}} />);

    expect(screen.getByText("tense · uncanny")).toBeTruthy();
    expect(screen.getByText("0 configured profile(s)")).toBeTruthy();
    expect(screen.queryByLabelText("Sensuality")).toBeNull();
    await user.click(screen.getByText("Advanced prose and scoped presentation"));
    expect(screen.getByText(/No relationship profile is required/)).toBeTruthy();
    await user.click(screen.getByText("Why is this set?"));
    expect(screen.getByText(/Configured for mystery/)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Development pace"), "slow-burn");
    await user.click(screen.getByRole("button", { name: "Save Creative Direction draft" }));
    const request = fetchMock.mock.calls[0]![1]!;
    const saved = JSON.parse(String(request.body));
    expect(saved.pacing.developmentPace).toBe("slow-burn");
    expect(saved.fieldProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath: "/pacing", reference: expect.objectContaining({ kind: "manual-edit", versionId: "direction-v1" }) }),
    ]));
  });

  it("keeps established profile and variation stable IDs read-only during ordinary editing", async () => {
    const scopedContent: CreativeDirection = {
      ...content,
      relationshipPresentation: { profiles: [{
        id: "profile-stable", relationshipKind: "friendship", relationshipId: "relationship-stable",
        participantIds: [], developmentStyle: "steady", emotionalTension: "moderate", melodrama: "low",
        mechanicsVisibility: "subtle", customGuidance: "", contentBoundaries: [],
      }] },
      scopedVariations: [{
        id: "variation-stable", scopeKind: "route", scopeId: "route-stable",
        toneDescriptors: [], pacingGuidance: "", proseGuidance: "",
      }],
    };
    const user = userEvent.setup();
    render(<CreativeDirectionWorkspace projectId="project-1" direction={{ ...artifact, content: scopedContent }} workflow={workflow}
      busy={false} message={null} setBusy={() => {}} setMessage={() => {}} onChanged={() => {}} />);
    await user.click(screen.getByText("Advanced prose and scoped presentation"));
    expect(screen.getByLabelText("Stable profile ID")).toHaveProperty("readOnly", true);
    expect(screen.getByLabelText("Stable variation ID")).toHaveProperty("readOnly", true);
  });
});
