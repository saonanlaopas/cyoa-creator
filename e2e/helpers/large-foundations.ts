import type { LongFormStoryBible, LongFormRoutePlan } from "@story-to-cyoa/domain";

const focus = ['arrival records', 'equipment custody', 'maintenance priorities', 'consent for interviews', 'public notices', 'archived correspondence', 'team responsibilities', 'conflicting recollections', 'inspection reports', 'handover duties', 'accountable decisions', 'later follow-up'];
const detail = (subject: string, n = 8) => Array.from({ length: n }, (_, i) => `${subject}: ${focus[i % focus.length]} are documented in section ${i + 1}. The plan distinguishes what the person observed from what colleagues inferred, records who can verify the account, and carries the unresolved question into the later investigation.`).join(' ');

export function largeBible(base: LongFormStoryBible, scale = 1): LongFormStoryBible {
  return { ...base, characters: Array.from({ length: 20 }, (_, i) => ({ id: `person-${i}`, name: `Station specialist ${i + 1}`, role: focus[i % focus.length], summary: detail(`Specialist ${i + 1}`, 9 * scale), motivations: ['Resolve the disputed inspection without destroying the evidence.'], knowledge: ['Knows the assigned station records; other accounts require verification.'], plannedArc: detail(`Specialist ${i + 1} follow-up`, 4 * scale) })),
    relationships: Array.from({ length: 10 }, (_, i) => ({ id: `bond-${i}`, characterIds: [`person-${i}`, `person-${i + 10}`], label: `Review partnership ${i + 1}`, currentState: 'Professional trust depends on accurate attribution.', plannedArc: detail(`Partnership ${i + 1}`, 2) })),
    settings: Array.from({ length: 12 }, (_, i) => ({ id: `setting-${i}`, label: `Station department ${i + 1}`, description: detail(`Department ${i + 1}`, 7 * scale) })),
    timeline: Array.from({ length: 8 }, (_, i) => ({ id: `timeline-${i}`, label: `Investigation phase ${i + 1}`, description: detail(`Phase ${i + 1}`, 3) })),
    worldRules: Array.from({ length: 4 }, (_, i) => ({ id: `rule-${i}`, label: `Evidence rule ${i + 1}`, description: detail(`Evidence rule ${i + 1}`, 2) })),
    themes: Array.from({ length: 4 }, (_, i) => ({ id: `theme-${i}`, label: `Accountability theme ${i + 1}`, description: detail(`Theme ${i + 1}`, 2) })),
    canonFacts: Array.from({ length: 8 }, (_, i) => ({ id: `fact-${i}`, statement: `Department ${i + 1} maintains its own inspection ledger.`, source: 'Authored neutral fixture' })), contradictions: [], adaptationOpportunities: [], unresolvedQuestions: [] };
}

export function largeRoutes(base: LongFormRoutePlan, scale = 1): LongFormRoutePlan {
  return { ...base,
    routes: base.routes.map((r, i) => ({ ...r, summary: detail(`Investigation approach ${i + 1}`, 8 * scale) })),
    acts: base.acts.map((a, i) => ({ ...a, summary: detail(`Act ${i + 1}`, 7 * scale) })),
    endingHooks: base.endingHooks.map((e, i) => ({ ...e, summary: detail(`Outcome ${i + 1}`, 4 * scale) })),
    decisionPoints: [...base.decisionPoints, ...Array.from({ length: 12 }, (_, i) => ({ id: `decision-phase-${i}`, label: `Evidence decision ${i + 1}`, actId: base.acts[i % base.acts.length].id, question: detail(`Decision ${i + 1}`, 9 * scale), choices: base.routes.map((r, j) => ({ id: `choice-phase-${i}-${j}`, label: `Use approach ${j + 1} for evidence set ${i + 1}`, destinationActId: `${r.id}-act`, routeId: r.id, conditions: [], consequences: [detail(`Decision ${i + 1}, approach ${j + 1}`, 3)] })) }))] };
}
