import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
const require = createRequire(new URL('package.json', `file://${process.cwd()}/`));
const { chromium, request, expect } = require('playwright/test');
const directory = (process.env.PROBE_OUTPUT_DIR ?? new URL('.', import.meta.url).pathname).replace(/\/?$/, '/');
const baseURL = process.env.PROBE_BASE_URL ?? 'http://127.0.0.1:3103';
const api = await request.newContext({ baseURL });
const browser = await chromium.launch();
try {
  for (const scenario of ['before', 'after']) {
    const { projectId } = await (await api.post('/api/quick/drafts')).json();
    await api.post(`/api/projects/${projectId}/commands`, { data: { name: 'Neutral voice', instruction: 'Use present tense and quiet humor.' } });
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 900 } });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const page = await context.newPage();
    const requests = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ method: request.method(), path: new URL(request.url()).pathname }); });
    let release, observed;
    const gate = new Promise(resolve => { release = resolve; });
    const intercepted = new Promise(resolve => { observed = resolve; });
    let bootstrapProjectId = null;
    if (scenario === 'before') await page.route('**/api/quick/drafts', async route => {
      const response = await route.fetch();
      bootstrapProjectId = (await response.json()).projectId;
      observed(); await gate; await route.fulfill({ response });
    });
    // Before reproduces the original fixture; after uses the corrected setup.
    await page.goto(scenario === 'before' ? '/' : '/api/health');
    if (scenario === 'before') await intercepted;
    await page.evaluate(id => localStorage.setItem('story-to-cyoa.active-project-id', id), projectId);
    const manuallySelected = await page.evaluate(() => localStorage.getItem('story-to-cyoa.active-project-id'));
    if (scenario === 'before') {
      release();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('story-to-cyoa.active-project-id'))).toBe(bootstrapProjectId);
    }
    await page.goto('/'); await page.reload();
    const panel = page.locator('details.authoring-settings'); await panel.locator('summary').click();
    const checkbox = panel.getByRole('checkbox'); await expect(checkbox).toBeChecked();
    await checkbox.focus(); await page.keyboard.press('Space');
    await panel.getByRole('button', { name: 'Review preference change' }).click();
    await expect(panel.getByText(`${scenario === 'before' ? 0 : 1} custom instructions retained.`)).toBeVisible();
    const selectedProjectId = await page.evaluate(() => localStorage.getItem('story-to-cyoa.active-project-id'));
    const read = async id => (await (await api.post(`/api/projects/${id}/authoring/read_authoring_settings`, { data: {} })).json()).context;
    const intended = await read(projectId), selected = await read(selectedProjectId);
    const draftRequests = requests.filter(request => request.method === 'POST' && request.path === '/api/quick/drafts');
    if (scenario === 'after') { expect(selectedProjectId).toBe(projectId); expect(draftRequests).toEqual([]); }
    const evidence = { scenario, viewport: { width: 390, height: 900 }, intendedProjectId: projectId, manuallySelected, bootstrapProjectId, selectedProjectId, intendedInstructions: intended.customInstructions.length, selectedInstructions: selected.customInstructions.length, bootstrapDraftRequests: draftRequests.length, reviewText: await panel.innerText(), requests };
    await writeFile(`${directory}controlled-${scenario}.json`, JSON.stringify(evidence, null, 2) + '\n');
    await page.screenshot({ path: `${directory}controlled-${scenario}.png`, fullPage: true });
    await context.tracing.stop({ path: `${directory}controlled-${scenario}-trace.zip` });
    console.log(JSON.stringify({ scenario, intendedProjectId: projectId, selectedProjectId, selectedInstructions: selected.customInstructions.length, bootstrapDraftRequests: draftRequests.length }));
    await context.close();
    await api.post(`/api/projects/${projectId}/archive`, { data: {} });
    if (bootstrapProjectId) await api.post(`/api/projects/${bootstrapProjectId}/archive`, { data: {} });
  }
} finally { await browser.close(); await api.dispose(); }
