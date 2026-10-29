const { chromium } = require('/workspace/cyoa-creator/node_modules/playwright');
const { pathToFileURL } = require('node:url');
const { writeFile } = require('node:fs/promises');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const waitForCompletion of [false, true]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.addInitScript(() => {
          const original = IDBFactory.prototype.open;
          IDBFactory.prototype.open = function (...args) {
            const request = original.apply(this, args);
            if (globalThis.__delayNextOpen) {
              globalThis.__delayNextOpen = false;
              let handler;
              Object.defineProperty(request, 'onsuccess', {
                get: () => handler,
                set: (callback) => { handler = callback; },
              });
              request.addEventListener('success', (event) => setTimeout(() => handler?.call(request, event), 750));
            }
            return request;
          };
        });
        await page.goto(pathToFileURL('/workspace/cyoa-creator/demos/last-harbor-signal/artifacts/chapter-led.html').href);
        await page.getByRole('button', { name: 'Save game', exact: true }).click();
        await page.getByLabel('Save name', { exact: true }).fill('Storage delay proof');
        await page.evaluate(() => { globalThis.__delayNextOpen = true; });
        await page.getByRole('button', { name: 'Create save', exact: true }).click();
        if (waitForCompletion) await page.getByRole('status').filter({ hasText: /^Saved “Storage delay proof”\.$/ }).waitFor({ state: 'visible' });
        await page.reload();
        await page.getByRole('button', { name: 'Load game', exact: true }).click();
        if (waitForCompletion) await page.getByRole('button', { name: 'Load', exact: true }).waitFor({ state: 'visible' });
        else await page.getByText('No manual saves yet.', { exact: true }).waitFor({ state: 'visible' });
        const loadButtons = await page.getByRole('button', { name: 'Load', exact: true }).count();
        assert.equal(loadButtons, waitForCompletion ? 1 : 0);
        const screenshot = `storage-delay-${waitForCompletion ? 'waited' : 'immediate-reload'}.png`;
        await page.screenshot({ path: `/workspace/.setup/cp1-save-sync-20261029/${screenshot}`, fullPage: true });
        results.push({ waitForCompletion, delayedSaveOpenMilliseconds: 750, loadButtons, screenshot });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  await writeFile('/workspace/.setup/cp1-save-sync-20261029/storage-delay-proof.json', JSON.stringify({ fixture: 'accepted standalone HTML; isolated browser contexts; no production changes', results }, null, 2) + '\n');
  console.log(JSON.stringify(results));
})().catch((error) => { console.error(error); process.exitCode = 1; });
