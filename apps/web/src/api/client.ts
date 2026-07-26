export type Stage = "import" | "analysis" | "adaptation" | "studio";
export type ProjectState = { id: string; stage: Stage; title: string; chapters: string[]; stale?: boolean };
export type ChangeProposal = { id: string; summary: string; affected: string[]; version: number };
export const demoProject: ProjectState = { id: "demo", stage: "import", title: "The Glass Orchard", chapters: ["Arrival", "The orchard gate", "The bargain"], stale: true };

export class ApiClient {
  constructor(private readonly baseUrl = "/api") {}
  async project(): Promise<ProjectState> { try { const r = await fetch(`${this.baseUrl}/projects/current`); if (!r.ok) throw new Error(); return r.json() as Promise<ProjectState>; } catch { return demoProject; } }
  async saveKey(key: string): Promise<void> { await fetch(`${this.baseUrl}/settings/key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) }); }
  async proposeRepair(findingId: string): Promise<ChangeProposal> { try { const r = await fetch(`${this.baseUrl}/findings/${findingId}/repair`, { method: "POST" }); if (!r.ok) throw new Error(); return r.json() as Promise<ChangeProposal>; } catch { return { id: "proposal-demo", summary: "Clarify the gate requirement", affected: ["The orchard gate"], version: 2 }; } }
}
