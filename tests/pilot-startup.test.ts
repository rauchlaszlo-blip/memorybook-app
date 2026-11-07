import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import express from 'express';
import { chromium, webkit, expect } from '@playwright/test';

for (const engine of ['chromium', 'webkit'] as const) {
  test(`${engine}: guest starts with blocked storage, switches language, submits; failed script has visible fallback`, async () => {
    const app = express(); app.use(express.json());
    app.get('/api/wedding/guest/:token', (_req, res) => res.json({ event: { title: 'Startup test', starts_on: '2027-06-05', closed: false, template_id: 'wedding-classic', template_version: 1 } }));
    let sent = 0;
    app.post('/api/wedding/guest/:token/submissions', (req, res) => { assert.equal(req.body.message, 'Árvíztűrő próba'); sent++; res.status(201).json({ success: true }); });
    app.use(express.static(resolve('dist'))); app.get(/^\/wedding\/.*$/, (_req, res) => res.sendFile(resolve('dist/index.html')));
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
    const addr = server.address(); assert.ok(addr && typeof addr !== 'string'); const url = `http://127.0.0.1:${addr.port}/wedding/join/${'A'.repeat(43)}`;
    const browser = await (engine === 'webkit' ? webkit.launch() : chromium.launch({ channel: 'chrome' }));
    try {
      for (const blocked of [false, true]) {
        const context = await browser.newContext({ locale: 'hu-HU', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        if (blocked) await context.addInitScript(() => {
          for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
        });
        const page = await context.newPage(); const errors: string[] = []; const assets: string[] = [];
        page.on('pageerror', e => errors.push(e.message)); page.on('request', r => assets.push(r.url()));
        await page.goto(url); await expect(page.getByLabel('Neved', { exact: true })).toBeVisible();
        await page.getByRole('combobox').selectOption('en'); await expect(page.getByRole('combobox')).toHaveValue('en');
        await page.getByRole('combobox').selectOption('hu');
        await page.getByLabel('Neved', { exact: true }).fill('Fiktív Éva'); await page.getByLabel('Jókívánságod', { exact: true }).fill('Árvíztűrő próba');
        await page.getByRole('button', { name: 'Beküldés', exact: true }).click();
        await expect(page.getByText('Köszönjük! A jókívánságod megérkezett.', { exact: true })).toBeVisible();
        assert.deepEqual(errors, []); assert.ok(!assets.some(a => a.includes('/legacy-main-'))); await context.close();
      }
      assert.equal(sent, 2);
      const page = await browser.newPage(); await page.route('**/assets/*.js', route => route.abort()); await page.goto(url);
      await expect(page.locator('#startup-status')).toContainText('BETÖLTÉS-01'); await expect(page.getByRole('button', { name: 'Újrapróbálás / Retry' })).toBeVisible();
    } finally { await browser.close(); await new Promise<void>(r => server.close(() => r())); }
  });
}
