import type { ArtifactRepository } from "@story-to-cyoa/persistence";

export function assertPassageFidelityAuthority(artifacts: ArtifactRepository, projectId: string, expected?: unknown, checkExpected = false) {
  if (artifacts.getCurrent(projectId, "adaptation-intent")) {
    try {
      const authority = artifacts.foundationAuthority(projectId);
      if (checkExpected && JSON.stringify(authority) !== JSON.stringify(expected)) throw new Error("bootstrap_context_stale");
      return authority;
    } catch {
      throw Object.assign(new Error("Adaptation Intent owns fidelity. A5 foundation bootstrap is required: apply compatible foundations, approve their ordinary drafts, then create a new passage plan. Manual authoring remains available."), {
        code: "adaptation_foundation_bootstrap_required", retryable: false,
      });
    }
  }
}
