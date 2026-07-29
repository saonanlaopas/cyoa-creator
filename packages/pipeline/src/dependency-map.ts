export const pipelineDependencies: Record<string, string[]> = {
  bible: ["source", "brief"],
  adaptation: ["bible"],
  routes: ["adaptation"],
  endings: ["routes"],
  mechanics: ["bible", "routes", "endings"],
  drafts: ["routes"],
};
export function staleArtifacts(changed: string): string[] { const result: string[] = []; const visit = (item: string) => Object.entries(pipelineDependencies).forEach(([next, inputs]) => { if (inputs.includes(item) && !result.includes(next)) { result.push(next); visit(next); } }); visit(changed); return result; }
