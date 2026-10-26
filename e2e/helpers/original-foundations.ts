import { randomUUID } from "node:crypto";

export type FoundationCall = (name: string, args: Record<string, unknown>) => Promise<any>;
export const originalTitle = "The Last Harbor Signal";

export async function proposeFoundation(call: FoundationCall, projectId: string, artifactId: string, changes: Record<string, unknown>, extraOperations: unknown[] = []) {
  const current = await call("read_foundation", { projectId, artifactId });
  const preview = await call("prepare_edit", { projectId, operationId: randomUUID(), message: `Author ${artifactId} for ${originalTitle}. Keep all other work intact.`,
    headFingerprint: current.headFingerprint, targets: [{ key: `${artifactId}:root`, versionId: current.versionId }] });
  return call("submit_edit", { projectId, operationId: randomUUID(), planId: preview.plan.id, fingerprint: preview.plan.fingerprint,
    response: { message: `Original ${artifactId} proposal`, groups: [{ id: "foundation", label: `Author ${artifactId}`, explanation: "Original harbor mystery foundations, not generated or approved content.", dependsOnGroupIds: [],
      operations: [{ targetKey: `${artifactId}:root`, kind: "set-fields", changes }, ...extraOperations] }] } });
}

export async function applyFoundation(call: FoundationCall, projectId: string, proposalId: string) {
  const review = await call("review_edit", { projectId, proposalId, groupIds: ["foundation"] });
  return call("apply_edit", { projectId, operationId: randomUUID(), proposalId, groupIds: ["foundation"], fingerprint: review.fingerprint, approved: true });
}

export async function approveFoundation(call: FoundationCall, projectId: string, artifactId: string) {
  const current = await call("read_foundation", { projectId, artifactId });
  const review = await call("review_foundation_approval", { projectId, artifactId, versionId: current.versionId });
  return call("approve_foundation", { projectId, operationId: randomUUID(), artifactId, versionId: current.versionId, fingerprint: review.fingerprint, approved: true });
}

// Deterministic authored content exercises all six existing schemas and their cross-artifact references.
export async function completeOriginalFoundations(call: FoundationCall, projectId: string, onProposal?: (artifactId: string, proposal: any) => Promise<void>, afterBible?: () => Promise<void>) {
  const authored = async (id: string, changes: Record<string, unknown>, extra: unknown[] = []) => {
    const proposal = await proposeFoundation(call, projectId, id, changes, extra);
    await onProposal?.(id, proposal);
    await applyFoundation(call, projectId, proposal.proposalId);
    return approveFoundation(call, projectId, id);
  };
  await authored("brief", { workingTitle: originalTitle, premise: "A storm severs the harbor signal. Keeper Mira must choose between exposing a civic cover-up and bargaining for the town's safety.",
    protagonist: "Mira", routeTarget: 2, endingTarget: 3, totalWordTarget: 50000, typicalPlaythroughWordTarget: 20000,
    contentBoundaries: ["No graphic violence"], projectConstraints: ["Original mystery; no source adaptation", "Choices carry civic consequences"] });
  const direction = (await call("read_foundation", { projectId, artifactId: "creative-direction" })).content;
  await authored("creative-direction", { tone: { ...direction.tone, customGuidance: "Restrained coastal mystery. Hope follows costly honesty, never an effortless rescue." } });
  for (const artifactId of ["bible", "routes", "endings", "mechanics"]) {
    const state = await call("project_state", { projectId });
    await call("initialize_foundation", { projectId, operationId: randomUUID(), artifactId, headFingerprint: state.headFingerprint, approved: true });
    const content = (await call("read_foundation", { projectId, artifactId })).content;
    if (artifactId === "bible") await authored(artifactId, { overview: "Mira keeps the storm beacon; the town council has hidden the cost of maintaining the breakwater.",
      characters: content.characters.map((c: any) => ({ ...c, summary: "Harbor signal keeper responsible for the last safe channel.", motivations: ["Protect the town without repeating its lies"], plannedArc: "Move from solitary duty toward accountable public action." })) },
    [{ targetKey: "bible:root", kind: "add-item", collection: "settings", item: { id: "$new:harbor", label: "Storm beacon", description: "An aging signal tower above a flooded public quay." } }]);
    if (artifactId === "routes") await authored(artifactId, { overview: "A shared investigation branches into public testimony or a negotiated repair, each with lasting civic costs.",
      routes: content.routes.map((r: any, n: number) => ({ ...r, name: n ? "Repair the compact" : "Reveal the ledger", promise: n ? "Secure a fragile collective repair" : "Demand public accountability", summary: n ? "Mira bargains openly for labor and supplies." : "Mira releases the hidden maintenance ledger." })),
      acts: content.acts.map((a: any) => ({ ...a, summary: a.routeId ? "Carry the chosen commitment through the storm and accept its cost." : "Follow the false signal and uncover the council's ledger." })),
      endingHooks: content.endingHooks.map((h: any, n: number) => ({ ...h, label: ["A public reckoning", "A shared repair", "The costly warning"][n], summary: ["The ledger becomes public and the town rebuilds trust.", "A transparent compact saves the beacon.", "The warning saves lives but the beacon is lost."][n] })) });
    if (artifactId === "endings") await authored(artifactId, { overview: "Each ending pays off Mira's commitment and preserves the cost of the decision.",
      endings: content.endings.map((e: any) => ({ ...e, thematicPayoff: "Safety becomes durable only when its costs are shared honestly.", contributingDecisionIds: ["decision-route-selection"],
        foreshadowing: ["The damaged signal and hidden ledger"], characterOutcomes: [{ characterId: "character-protagonist", outcome: "Mira accepts public responsibility for her decision." }], stateConsequences: ["The town records the cost of its chosen repair."] })) });
    if (artifactId === "mechanics") await authored(artifactId, { overview: "Resolve sustains difficult action, insight exposes the ledger, and integrity makes the public compact credible." },
      [{ targetKey: "mechanics:root", kind: "add-item", collection: "choiceEffectPlans", item: { id: "$new:signal-consequence", label: "The signal decision", sourceDecisionIds: ["decision-route-selection"], mechanicKeys: ["resolve", "insight", "integrity", ...(afterBible ? content.relationships.map((r: { key: string }) => r.key) : [])], effectGuidance: ["Public testimony favors integrity and insight; negotiated repair requires resolve. Neither commitment erases the other costs."] } }]);
    if (artifactId === "bible") await afterBible?.();
  }
  return call("project_state", { projectId });
}
