import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactRepository, ChangeSetRepository, ConversationRepository, openDatabase, ProjectRepository, WorkflowRepository } from "@story-to-cyoa/persistence";
import { defaultLongFormStoryBible, defaultProjectBrief, enrichOperationGroups } from "@story-to-cyoa/pipeline";
import { buildApp } from "../src/app.js";

describe("long-form project brief", () => {
  it("enforces Creative Direction as the single current presentation write authority", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Authority" },
    })).json();
    const projectId = created.project.id as string;
    const rejectedBrief = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/brief`,
      payload: { ...created.brief.content, tone: "LEGACY-TONE-MUTATION", pointOfView: "first-person" },
    });
    expect(rejectedBrief.statusCode).toBe(400);
    expect(rejectedBrief.json().error).toContain("Creative Direction owns current tone");
    const acceptedBrief = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/brief`,
      payload: { ...created.brief.content, premise: "A changed premise that preserves legacy presentation." },
    });
    expect(acceptedBrief.statusCode).toBe(201);
    expect(acceptedBrief.json().brief.content).toMatchObject({
      premise: "A changed premise that preserves legacy presentation.",
      tone: created.brief.content.tone,
      pointOfView: created.brief.content.pointOfView,
    });
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: acceptedBrief.json().brief.id },
    });
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`,
      payload: { versionId: created.creativeDirection.id },
    });
    const bible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`, payload: {},
    })).json().bible;
    const rejectedBible = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...bible.content, proseGuidance: { ...bible.content.proseGuidance, tone: ["LEGACY-BIBLE-MUTATION"] } },
    });
    expect(rejectedBible.statusCode).toBe(400);
    expect(rejectedBible.json().error).toContain("Creative Direction owns current prose presentation");
    const acceptedBible = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...bible.content, overview: "Changed structural overview." },
    });
    expect(acceptedBible.statusCode).toBe(201);
    expect(acceptedBible.json().bible.content.proseGuidance).toEqual(bible.content.proseGuidance);
    await app.close();
  });

  it("prevents a persisted generic proposal from bypassing presentation authority", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-authority-proposal-")); const databasePath = join(directory, "story.sqlite");
    const setupApp = buildApp({ databasePath });
    const created = (await setupApp.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Proposal authority" },
    })).json();
    await setupApp.close();
    const database = openDatabase(databasePath); const project = created.project; const brief = created.brief;
    const conversations = new ConversationRepository(database);
    const conversation = conversations.create(project.id, { kind: "project", projectId: project.id, stage: "brief" });
    const proposal = new ChangeSetRepository(database).createOperations({
      projectId: project.id, conversationId: conversation.id, artifactId: "brief", baseVersionId: brief.id,
      summary: "Mutate legacy tone", rationale: "Regression probe", proposal: { groups: enrichOperationGroups(brief.content, [{
        id: "legacy-tone", label: "Legacy tone", summary: "Attempt forbidden mutation", dependsOnGroupIds: [],
        safeToApplyIndependently: true, operations: [{ kind: "set-fields", targetId: "root", changes: { tone: "forbidden" } }],
      }]) },
    });
    database.close();
    const app = buildApp({ databasePath });
    try {
      const beforeApply = (await app.inject({
        method: "GET", url: `/api/long-form/projects/${project.id}`,
      })).json();
      expect(beforeApply.brief.id).toBe(proposal.baseVersionId);
      const response = await app.inject({
        method: "POST", url: `/api/long-form/projects/${project.id}/conversations/${conversation.id}/proposals/${proposal.id}/apply`,
      });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error).toContain("Creative Direction owns current tone");
    } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
  });

  it("versions Creative Direction with material-only staleness and exact provenance", async () => {
    const app = buildApp();
    const created = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Direction Project" } })).json();
    const projectId = created.project.id as string;
    expect(created.creativeDirection).toMatchObject({ artifactId: "creative-direction", version: 1, content: { schemaId: "cyoa.creative-direction" } });
    expect(created.creativeDirectionWorkflow.status).toBe("draft");
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`, payload: { versionId: created.brief.id } });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: created.creativeDirection.id } });
    const bible = (await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible` })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`, payload: { versionId: bible.bible.id } });

    const provenanceOnly = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: { ...created.creativeDirection.content, fieldProvenance: [{
        fieldPath: "/tone", reference: { kind: "manual-edit", versionId: created.creativeDirection.id, excerpt: "Why this default exists" },
      }] },
    });
    expect(provenanceOnly.statusCode).toBe(201);
    expect(provenanceOnly.json().creativeDirection.content.materialFingerprint).toBe(created.creativeDirection.content.materialFingerprint);
    expect(provenanceOnly.json().creativeDirection.content.provenanceFingerprint).not.toBe(created.creativeDirection.content.provenanceFingerprint);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: provenanceOnly.json().creativeDirection.id } });
    let state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);

    const noOp = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: provenanceOnly.json().creativeDirection.content,
    })).json();
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: noOp.creativeDirection.id } });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);

    const restoredEquivalent = (await app.inject({
      method: "POST", url: `/api/projects/${projectId}/artifacts/creative-direction/restore`,
      payload: { versionId: created.creativeDirection.id },
    })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: restoredEquivalent.version.id } });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("approved");
    expect(state.bible.stale).toBe(false);

    const material = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: { ...provenanceOnly.json().creativeDirection.content, tone: { ...provenanceOnly.json().creativeDirection.content.tone, descriptors: ["uncanny", "tense"] } },
    });
    await app.inject({ method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: material.json().creativeDirection.id } });
    state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}` })).json();
    expect(state.workflow.bible.status).toBe("stale");
    expect(state.bible.stale).toBe(true);

    const exported = await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/creative-direction/export?format=json` });
    expect(exported.statusCode).toBe(200);
    expect(exported.json().artifact.content.materialFingerprint).toBe(material.json().creativeDirection.content.materialFingerprint);
    const context = (await app.inject({ method: "GET", url: `/api/long-form/projects/${projectId}/creative-direction/context-preview` })).json();
    expect(context.diagnostics).toMatchObject({
      artifactVersionId: material.json().creativeDirection.id,
      materialFingerprint: material.json().creativeDirection.content.materialFingerprint,
      omittedRelationshipProfileIds: [], omittedScopedVariationIds: [], tokenEstimateKind: "estimated",
      hardLimitBytes: expect.any(Number), hardLimits: expect.any(Object),
    });
    await app.close();
  });

  it("rejects cross-project Creative Direction provenance before any version is written", async () => {
    const app = buildApp();
    const first = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "First" } })).json();
    const second = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Second" } })).json();
    const rejected = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${first.project.id}/creative-direction`,
      payload: { ...first.creativeDirection.content, fieldProvenance: [{
        fieldPath: "/tone", reference: { kind: "approved-artifact", targetId: "brief", versionId: second.brief.id },
      }] },
    });
    expect(rejected.statusCode).toBe(400);
    const state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${first.project.id}` })).json();
    expect(state.creativeDirection.version).toBe(1);
    await app.close();
  });

  it("enforces Creative Direction stable IDs and resolves every scoped target through approval and restore", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Scoped Direction" },
    })).json();
    const projectId = created.project.id as string;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const initialBible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`, payload: {},
    })).json();
    const characters = ["a", "b", "c"].map((suffix) => ({
      id: `character-${suffix}`, name: suffix.toUpperCase(), role: "", summary: "",
      motivations: [], knowledge: [], plannedArc: "",
    }));
    const bible = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: {
        ...initialBible.bible.content,
        characters,
        relationships: [{
          id: "relationship-ab", characterIds: ["character-a", "character-b"],
          label: "A and B", currentState: "Friends", plannedArc: "Deepening trust",
        }],
      },
    })).json().bible;
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`, payload: { versionId: bible.id },
    })).statusCode).toBe(200);
    const routes = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes`, payload: {},
    })).json().routes;
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`, payload: { versionId: routes.id },
    })).statusCode).toBe(200);

    const valid = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`,
      payload: {
        ...created.creativeDirection.content,
        relationshipPresentation: { profiles: [{
          id: "profile-ab", relationshipKind: "friendship", relationshipId: "relationship-ab",
          participantIds: ["character-a", "character-b"], developmentStyle: "gradual",
          emotionalTension: "moderate", melodrama: "low", mechanicsVisibility: "subtle",
          customGuidance: "Let trust change slowly.", contentBoundaries: [],
        }] },
        scopedVariations: [
          { id: "variation-route", scopeKind: "route", scopeId: routes.content.routes[0].id, toneDescriptors: ["warm"], pacingGuidance: "", proseGuidance: "" },
          { id: "variation-act", scopeKind: "act", scopeId: routes.content.acts[0].id, toneDescriptors: ["tense"], pacingGuidance: "", proseGuidance: "" },
        ],
      },
    })).json().creativeDirection;
    expect(valid.id).toEqual(expect.any(String));
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: valid.id },
    })).statusCode).toBe(200);
    // Material Creative Direction approval intentionally stales its downstream Bible;
    // reapprove the exact still-valid Bible before exercising later route approvals.
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`, payload: { versionId: bible.id },
    })).statusCode).toBe(200);

    const saveDirection = (content: unknown) => app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/creative-direction`, payload: content,
    });
    const renamedProfile = await saveDirection({
      ...valid.content,
      relationshipPresentation: { profiles: [{ ...valid.content.relationshipPresentation.profiles[0], id: "profile-renamed" }] },
    });
    expect(renamedProfile.statusCode).toBe(400);
    expect(renamedProfile.json().error).toContain("cannot be renamed in place");
    const renamedVariation = await saveDirection({
      ...valid.content,
      scopedVariations: valid.content.scopedVariations.map((item: { id: string }) =>
        item.id === "variation-route" ? { ...item, id: "variation-renamed" } : item),
    });
    expect(renamedVariation.statusCode).toBe(400);
    expect(renamedVariation.json().error).toContain("cannot be renamed in place");

    const invalidDirections = [
      {
        label: "unscoped",
        content: { ...valid.content, relationshipPresentation: { profiles: [{
          ...valid.content.relationshipPresentation.profiles[0], relationshipId: undefined, participantIds: [],
        }] } },
        message: "requires a relationshipId or participantIds",
      },
      {
        label: "mismatched participants",
        content: { ...valid.content, relationshipPresentation: { profiles: [{
          ...valid.content.relationshipPresentation.profiles[0], participantIds: ["character-a", "character-c"],
        }] } },
        message: "participants do not match",
      },
      {
        label: "missing character",
        content: { ...valid.content, relationshipPresentation: { profiles: [{
          ...valid.content.relationshipPresentation.profiles[0], relationshipId: undefined,
          participantIds: ["character-a", "character-missing"],
        }] } },
        message: "missing character",
      },
      {
        label: "missing relationship",
        content: { ...valid.content, relationshipPresentation: { profiles: [{
          ...valid.content.relationshipPresentation.profiles[0], relationshipId: "relationship-missing",
        }] } },
        message: "missing relationship",
      },
      {
        label: "missing route",
        content: { ...valid.content, scopedVariations: valid.content.scopedVariations.map((item: { id: string }) =>
          item.id === "variation-route" ? { ...item, scopeId: "route-missing" } : item) },
        message: "missing route",
      },
      {
        label: "missing act",
        content: { ...valid.content, scopedVariations: valid.content.scopedVariations.map((item: { id: string }) =>
          item.id === "variation-act" ? { ...item, scopeId: "act-missing" } : item) },
        message: "missing act",
      },
    ];
    for (const invalid of invalidDirections) {
      const response = await saveDirection(invalid.content);
      expect(response.statusCode, invalid.label).toBe(400);
      expect(response.json().error, invalid.label).toContain(invalid.message);
    }

    const routeId = routes.content.routes[0].id as string;
    const renamedRouteId = `${routeId}-renamed`;
    const renamedRoute = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/routes`, payload: {
        ...routes.content,
        routes: routes.content.routes.map((item: { id: string }) => item.id === routeId ? { ...item, id: renamedRouteId } : item),
        acts: routes.content.acts.map((item: { routeId: string | null }) => item.routeId === routeId ? { ...item, routeId: renamedRouteId } : item),
        decisionPoints: routes.content.decisionPoints.map((decision: { choices: Array<{ routeId: string | null }> }) => ({
          ...decision,
          choices: decision.choices.map((choice) => choice.routeId === routeId ? { ...choice, routeId: renamedRouteId } : choice),
        })),
        endingHooks: routes.content.endingHooks.map((item: { routeId: string }) => item.routeId === routeId ? { ...item, routeId: renamedRouteId } : item),
      },
    })).json().routes;
    const blockedRouteApproval = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`, payload: { versionId: renamedRoute.id },
    });
    expect(blockedRouteApproval.statusCode).toBe(409);
    expect(blockedRouteApproval.json().error).toContain("missing route");

    const actId = routes.content.acts[0].id as string;
    const renamedActId = `${actId}-renamed`;
    const renamedAct = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/routes`, payload: {
        ...routes.content,
        acts: routes.content.acts.map((item: { id: string }) => item.id === actId ? { ...item, id: renamedActId } : item),
        decisionPoints: routes.content.decisionPoints.map((decision: { actId: string; choices: Array<{ destinationActId: string }> }) => ({
          ...decision,
          actId: decision.actId === actId ? renamedActId : decision.actId,
          choices: decision.choices.map((choice) => choice.destinationActId === actId ? { ...choice, destinationActId: renamedActId } : choice),
        })),
        reconvergences: routes.content.reconvergences.map((item: { fromActIds: string[]; toActId: string }) => ({
          ...item,
          fromActIds: item.fromActIds.map((id) => id === actId ? renamedActId : id),
          toActId: item.toActId === actId ? renamedActId : item.toActId,
        })),
      },
    })).json().routes;
    const blockedActApproval = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`, payload: { versionId: renamedAct.id },
    });
    expect(blockedActApproval.statusCode).toBe(409);
    expect(blockedActApproval.json().error).toContain("missing act");

    const bibleWithoutRelationship = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...bible.content, relationships: [] },
    })).json().bible;
    const blockedUpstreamApproval = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bibleWithoutRelationship.id },
    });
    expect(blockedUpstreamApproval.statusCode).toBe(409);
    expect(blockedUpstreamApproval.json().error).toContain("invalidate approved Creative Direction scopes");

    const clean = (await saveDirection({ ...valid.content, relationshipPresentation: { profiles: [] } })).json().creativeDirection;
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`, payload: { versionId: clean.id },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`, payload: { versionId: bibleWithoutRelationship.id },
    })).statusCode).toBe(200);

    const restored = (await app.inject({
      method: "POST", url: `/api/projects/${projectId}/artifacts/creative-direction/restore`,
      payload: { versionId: valid.id },
    })).json().version;
    const rejectedRestore = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/creative-direction/approve`,
      payload: { versionId: restored.id },
    });
    expect(rejectedRestore.statusCode).toBe(409);
    expect(rejectedRestore.json().error).toContain("missing relationship relationship-ab");
    await app.close();
  });

  it("opens a pre-A1 project unchanged and creates only an explicit migration-derived adoption draft", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cyoa-legacy-direction-"));
    const databasePath = join(directory, "story.sqlite");
    const database = openDatabase(databasePath);
    const project = new ProjectRepository(database).create("Legacy project", "legacy-project", "long-form");
    const artifacts = new ArtifactRepository(database); const workflow = new WorkflowRepository(database);
    const briefContent = { ...defaultProjectBrief("Legacy project"), tone: "uncanny", pointOfView: "first-person" as const };
    const brief = artifacts.saveArtifact({ projectId: project.id, artifactId: "brief", artifactType: "brief", schemaVersion: 1, content: briefContent });
    workflow.approve(project.id, "brief", brief.id);
    const bibleContent = defaultLongFormStoryBible({
      title: "Legacy project", overview: "Historical overview", protagonist: "Mara", pointOfView: "first-person", tone: "restrained",
    });
    const bible = artifacts.saveArtifact({ projectId: project.id, artifactId: "bible", artifactType: "bible", schemaVersion: 1, content: bibleContent });
    workflow.approve(project.id, "bible", bible.id);
    const exactBefore = artifacts.listVersions(project.id, "brief").concat(artifacts.listVersions(project.id, "bible"));
    database.close();

    const app = buildApp({ databasePath });
    try {
      const opened = (await app.inject({ method: "GET", url: `/api/long-form/projects/${project.id}` })).json();
      expect(opened.creativeDirection).toBeNull();
      expect(opened.workflow["creative-direction"]).toMatchObject({ status: "empty", approvedVersionId: null });
      const compatibleLegacyEdit = await app.inject({
        method: "PUT", url: `/api/long-form/projects/${project.id}/brief`,
        payload: { ...briefContent, tone: "warmly uncanny" },
      });
      expect(compatibleLegacyEdit.statusCode).toBe(201);
      const compatibleBrief = compatibleLegacyEdit.json().brief;
      const adopted = await app.inject({ method: "POST", url: `/api/long-form/projects/${project.id}/creative-direction/adopt-legacy` });
      expect(adopted.statusCode).toBe(201);
      expect(adopted.json()).toMatchObject({ workflow: { status: "draft", approvedVersionId: null } });
      expect(adopted.json().artifact.content.prose.pointOfView).toBe("first-person");
      expect(adopted.json().artifact.content.fieldProvenance).toEqual(expect.arrayContaining([
        expect.objectContaining({ reference: expect.objectContaining({ kind: "migration-derived", versionId: compatibleBrief.id }) }),
        expect.objectContaining({ reference: expect.objectContaining({ kind: "migration-derived", versionId: bible.id }) }),
      ]));
      const reopenedDatabase = openDatabase(databasePath);
      const reopenedHistory = new ArtifactRepository(reopenedDatabase).listVersions(project.id, "brief")
        .concat(new ArtifactRepository(reopenedDatabase).listVersions(project.id, "bible"));
      for (const historical of exactBefore) expect(reopenedHistory.find((item) => item.id === historical.id)).toEqual(historical);
      reopenedDatabase.close();
    } finally {
      await app.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("duplicates complete Creative Direction history with remapped project-owned provenance", async () => {
    const app = buildApp();
    const source = (await app.inject({ method: "POST", url: "/api/long-form/projects", payload: { name: "Source" } })).json();
    const saved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${source.project.id}/creative-direction`,
      payload: {
        ...source.creativeDirection.content,
        tone: { ...source.creativeDirection.content.tone, descriptors: ["hopeful"] },
        fieldProvenance: ["😀", "é", "e\u0301", "ASCII"].map((excerpt) => ({
          fieldPath: "/tone", reference: { kind: "manual-edit", versionId: source.creativeDirection.id, excerpt },
        })),
      },
    })).json();
    await app.inject({ method: "POST", url: `/api/long-form/projects/${source.project.id}/creative-direction/approve`, payload: { versionId: saved.creativeDirection.id } });
    const copy = (await app.inject({ method: "POST", url: `/api/projects/${source.project.id}/duplicate`, payload: { name: "Copy" } })).json();
    const state = (await app.inject({ method: "GET", url: `/api/long-form/projects/${copy.id}` })).json();
    const history = (await app.inject({ method: "GET", url: `/api/projects/${copy.id}/artifacts/creative-direction/versions` })).json();
    expect(history).toHaveLength(2);
    expect(state.workflow["creative-direction"]).toMatchObject({ status: "approved", approvedVersionId: history[0].id });
    expect(state.creativeDirection.content.materialFingerprint).toBe(saved.creativeDirection.content.materialFingerprint);
    const referenceVersionId = state.creativeDirection.content.fieldProvenance[0].reference.versionId;
    expect(history.map((item: { id: string }) => item.id)).toContain(referenceVersionId);
    expect(referenceVersionId).not.toBe(source.creativeDirection.id);
    expect(state.creativeDirection.content.fieldProvenance.map((item: { reference: { excerpt: string } }) => item.reference.excerpt))
      .toEqual(["ASCII", "e\u0301", "é", "😀"]);
    await app.close();
  });

  it("creates, persists, approves, and exports a validated brief", async () => {
    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "The Long Road" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.project).toMatchObject({ name: "The Long Road", mode: "long-form" });
    expect(body.brief.content).toMatchObject({ totalWordTarget: 175_000, branchingStyle: "braided" });

    const brief = {
      ...body.brief.content,
      premise: "A student discovers why an apparently easy course has no surviving graduates.",
      protagonist: "The student",
      totalWordTarget: 190_000,
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${body.project.id}/brief`,
      payload: brief,
    });
    expect(saved.statusCode).toBe(201);
    expect(saved.json().workflow.status).toBe("draft");

    const versionId = saved.json().brief.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${body.project.id}/brief/approve`,
      payload: { versionId },
    })).json()).toMatchObject({ status: "approved", approvedVersionId: versionId });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${body.project.id}/brief/export?format=markdown`,
    });
    expect(markdown.headers["content-type"]).toContain("text/markdown");
    expect(markdown.body).toContain("# The Long Road");
    expect(markdown.body).toContain("190,000");

    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${body.project.id}`,
    })).json();
    expect(reloaded.brief.content.premise).toContain("apparently easy course");
    expect(reloaded.workflow.brief.status).toBe("approved");
    await app.close();
  });

  it("rejects invalid budgets and quick-project access", async () => {
    const app = buildApp();
    const longForm = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Invalid" },
    })).json();
    const invalid = {
      ...longForm.brief.content,
      totalWordTarget: 100_000,
      typicalPlaythroughWordTarget: 100_000,
    };
    expect((await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${longForm.project.id}/brief`,
      payload: invalid,
    })).statusCode).toBe(400);

    const quick = (await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "Quick" },
    })).json();
    expect((await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${quick.id}`,
    })).statusCode).toBe(404);
    await app.close();
  });

  it("gates, versions, approves, exports, and invalidates the long-form story bible", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Bible Project" },
    })).json();
    const projectId = created.project.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    })).statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bibleCreated = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    });
    expect(bibleCreated.statusCode).toBe(201);
    expect(bibleCreated.json()).toMatchObject({
      bible: { version: 1, content: { title: "Bible Project story bible" } },
      workflow: { status: "draft" },
    });

    const candidate = {
      ...bibleCreated.json().bible.content,
      characters: [{
        id: "character-mara",
        name: "Mara",
        role: "Student",
        summary: "She underestimated the course.",
        motivations: ["Survive"],
        knowledge: ["The professor is hiding something"],
        plannedArc: "From avoidance to responsibility.",
      }],
      canonFacts: [{
        id: "fact-course",
        statement: "FAE 200 appears to be an easy general-education course.",
        sourceExcerptIds: ["chapter-1-block-1"],
        confidence: "confirmed",
      }],
    };
    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/bible`,
      payload: candidate,
    });
    expect(saved.statusCode).toBe(201);
    const bibleVersionId = saved.json().bible.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bibleVersionId },
    })).json()).toMatchObject({ status: "approved", approvedVersionId: bibleVersionId });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/bible/export?format=markdown`,
    });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain("# Bible Project story bible");
    expect(markdown.body).toContain("### Mara");
    expect(markdown.body).toContain("FAE 200");

    await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/brief`,
      payload: { ...created.brief.content, premise: "A changed premise." },
    });
    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}`,
    })).json();
    expect(reloaded.workflow.bible.status).toBe("stale");
    expect(reloaded.bible.stale).toBe(true);
    await app.close();
  });

  it("creates, budgets, versions, approves, exports, and invalidates route architecture", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST",
      url: "/api/long-form/projects",
      payload: { name: "Route Project" },
    })).json();
    const projectId = created.project.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes`,
    })).statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible`,
    })).json();
    await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });

    const routesCreated = await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes`,
    });
    expect(routesCreated.statusCode).toBe(201);
    const routePlan = routesCreated.json().routes.content;
    expect(routePlan.routes).toHaveLength(created.brief.content.routeTarget);
    expect(routePlan.endingHooks).toHaveLength(created.brief.content.endingTarget);
    expect(routePlan.acts.reduce((total: number, act: { wordTarget: number }) => total + act.wordTarget, 0))
      .toBe(created.brief.content.totalWordTarget);

    const saved = await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/routes`,
      payload: {
        ...routePlan,
        routes: routePlan.routes.map((route: { id: string; name: string }) =>
          route.id === "route-1" ? { ...route, name: "Forgiveness route" } : route),
      },
    });
    expect(saved.statusCode).toBe(201);
    const routeVersionId = saved.json().routes.id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/long-form/projects/${projectId}/routes/approve`,
      payload: { versionId: routeVersionId },
    })).json()).toMatchObject({ status: "approved", approvedVersionId: routeVersionId });

    const markdown = await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}/routes/export?format=markdown`,
    });
    expect(markdown.statusCode).toBe(200);
    expect(markdown.body).toContain("Forgiveness route");
    expect(markdown.body).toContain("175,000");

    await app.inject({
      method: "PUT",
      url: `/api/long-form/projects/${projectId}/bible`,
      payload: { ...bible.bible.content, overview: "A revised canonical overview." },
    });
    const reloaded = (await app.inject({
      method: "GET",
      url: `/api/long-form/projects/${projectId}`,
    })).json();
    expect(reloaded.workflow.routes.status).toBe("stale");
    expect(reloaded.routes.stale).toBe(true);
    await app.close();
  });

  it("promotes route hooks into detailed, budgeted, versioned endings", async () => {
    const app = buildApp();
    const created = (await app.inject({
      method: "POST", url: "/api/long-form/projects", payload: { name: "Ending Project" },
    })).json();
    const projectId = created.project.id as string;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/brief/approve`,
      payload: { versionId: created.brief.id },
    });
    const bible = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible`,
    })).json();
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/bible/approve`,
      payload: { versionId: bible.bible.id },
    });
    const routes = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes`,
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings`,
    })).statusCode).toBe(409);
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/routes/approve`,
      payload: { versionId: routes.routes.id },
    });

    const createdEndings = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings`,
    });
    expect(createdEndings.statusCode).toBe(201);
    const plan = createdEndings.json().endings.content;
    expect(plan.endings).toHaveLength(routes.routes.content.endingHooks.length);
    expect(plan.endings.reduce((total: number, ending: { wordTarget: number }) => total + ending.wordTarget, 0))
      .toBe(plan.endingWordTarget);

    const incomplete = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/endings`,
      payload: { ...plan, endings: plan.endings.slice(1) },
    })).json();
    const blockedApproval = await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings/approve`,
      payload: { versionId: incomplete.endings.id },
    });
    expect(blockedApproval.statusCode).toBe(409);
    expect(blockedApproval.json().error).toContain("hook");

    const saved = await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/endings`,
      payload: {
        ...plan,
        endings: plan.endings.map((ending: { id: string }) => ending.id === "ending-1"
          ? { ...ending, title: "Forgiveness", summary: "The protagonist chooses repair.", thematicPayoff: "Accountability permits change.", requirements: ["Chose honesty"] }
          : ending),
      },
    });
    expect(saved.statusCode).toBe(201);
    const endingVersionId = saved.json().endings.id as string;
    await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/endings/approve`,
      payload: { versionId: endingVersionId },
    });
    const markdown = await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}/endings/export?format=markdown`,
    });
    expect(markdown.body).toContain("## Forgiveness");
    expect(markdown.body).toContain("Chose honesty");

    const mechanicsCreated = (await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/mechanics`,
    })).json();
    expect(mechanicsCreated.mechanics.content.visibleStats).toHaveLength(3);
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
      payload: { versionId: mechanicsCreated.mechanics.id },
    })).statusCode).toBe(409);
    const mechanicsSaved = (await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/mechanics`,
      payload: {
        ...mechanicsCreated.mechanics.content,
        choiceEffectPlans: [{
          id: "effect-core",
          label: "Core choice consequences",
          sourceDecisionIds: ["decision-route-selection"],
          mechanicKeys: ["resolve", "insight", "integrity"],
          effectGuidance: ["Choices change values only when they carry narrative cost."],
        }],
      },
    })).json();
    expect((await app.inject({
      method: "POST", url: `/api/long-form/projects/${projectId}/mechanics/approve`,
      payload: { versionId: mechanicsSaved.mechanics.id },
    })).statusCode).toBe(200);

    await app.inject({
      method: "PUT", url: `/api/long-form/projects/${projectId}/routes`,
      payload: { ...routes.routes.content, overview: "Revised routes." },
    });
    const reloaded = (await app.inject({
      method: "GET", url: `/api/long-form/projects/${projectId}`,
    })).json();
    expect(reloaded.workflow.endings.status).toBe("stale");
    expect(reloaded.endings.stale).toBe(true);
    expect(reloaded.workflow.mechanics.status).toBe("stale");
    await app.close();
  });
});
