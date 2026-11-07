// Offline acceptance host. All persistence goes through Creator's canonical services.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildApp } from '../../apps/server/dist/app.js';
import { ArtifactRepository, ChangeSetRepository, ProjectRepository, WorkflowRepository, openDatabase } from '../../packages/persistence/dist/index.js';
import { LongFormProjectService } from '../../apps/server/dist/services/long-form-project-service.js';
import { editMessages } from '../../apps/server/dist/services/conversational-edit-provider.js';

const id = process.env.PF001_PROJECT, databasePath = process.env.PF001_DATABASE;
const db = openDatabase(databasePath), projects = new ProjectRepository(db);
if (!projects.get(id)) {
  const service = new LongFormProjectService(projects, new ArtifactRepository(db), new WorkflowRepository(db), new ChangeSetRepository(db));
  const made = service.createProject('Regional research station', 'original-premise', { projectId: id });
  service.saveArtifact(id, 'brief', { ...made.brief.content, routeTarget: 3, endingTarget: 7, totalWordTarget: 100000, typicalPlaythroughWordTarget: 40000 });
}
db.close();
const capturePath = process.env.PF001_CAPTURE;
const captures = existsSync(capturePath) ? JSON.parse(readFileSync(capturePath, 'utf8')) : [];
const person = { id: '$new:browser-witness', name: 'Inspection witness', role: 'Independent observer', summary: 'Records attributed evidence.', motivations: [], knowledge: [], plannedArc: 'Corroborates the inspection.' };
const decision = { id: '$new:browser-decision', label: 'Inspection decision', actId: 'shared-route-pivot', question: 'Record testimony now or seek corroboration?', choices: [1, 2].map(i => ({ id: `$new:browser-choice-${i}`, label: i === 1 ? 'Record the attributed account' : 'Ask for corroboration', destinationActId: 'shared-route-pivot', routeId: null, conditions: [], consequences: ['Preserve this approach in the later review.'] })) };
const app = buildApp({ databasePath, connectedEditing: { token: process.env.CYOA_MCP_TOKEN, projectIds: [id] },
  conversationalEditProvider: { id: 'offline-edit', async generate(plan) {
    captures.push({ request: plan.request, targets: plan.targets, messages: editMessages(plan), authoringInstructions: plan.context.authoringInstructions });
    writeFileSync(capturePath, JSON.stringify(captures, null, 2) + '\n');
    let operations;
    if (plan.request.message === 'Create an inspection witness') operations = [{ targetKey: 'collection:bible:characters', kind: 'add-item', collection: 'characters', item: person }];
    else if (plan.request.message === 'Create an inspection decision') operations = [{ targetKey: 'collection:routes:decisionPoints', kind: 'add-item', collection: 'decisionPoints', item: decision }];
    else if (plan.request.message === 'Rename the reviewed witness') operations = [{ targetKey: plan.targets.find(t => t.owner === 'bible' && !t.scope).key, kind: 'set-fields', changes: { name: 'Final reviewed witness' } }];
    else if (plan.request.message === 'Refine the second decision and its first choice') operations = plan.targets.filter(t => !t.scope).map(t => ({ targetKey: t.key, kind: 'set-fields', changes: 'question' in t.value ? { question: 'Which attributed account is ready for public review?' } : { label: 'Request an independent witness' } }));
    else throw new Error('Unexpected offline fixture request');
    return { message: 'Review these exact investigation records', groups: [{ id: 'requested', label: 'Requested investigation change', explanation: plan.request.message, dependsOnGroupIds: [], operations }] };
  } } });
console.log(JSON.stringify({ address: await app.listen({ host: '127.0.0.1', port: 0 }), projectId: id }));
process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
