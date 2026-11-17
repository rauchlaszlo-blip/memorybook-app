// Read-only HTTPS editor smoke. Never approves, saves, uploads or starts an export.
// Run only after explicit operator authorization:
// node --import tsx scripts/verify-mcp-internet-browser.ts test-results/mcp-internet/config.local
// --check-config validates local inputs without network/browser activity.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import type { Draft } from '../shared/montage';
import { pilotOrigin, loadInternetConfig, createRemoteContext, getJson, fictionalBook, hash, ensure, writeJson } from './mcp-internet-utils';

type Head = { latestVersionId: string | null; versions: { id: string }[]; snapshots: { id: string }[] };
type Version = { id: string; snapshotId: string | null; approved_at: string | null; draft: Draft };
type Export = { id: string; version_id: string; status: string };
type ViewResult = { name: string; status: 'PASS' | 'FAIL'; viewport: { width: number; height: number }; mobileEmulation: boolean;
  versionId?: string; imageResponses?: number; canvas?: { width: number; height: number; colors: number }; fontLoaded?: boolean;
  horizontalOverflowPx?: number; approvalButtonDisabled?: boolean; exportButtonEnabled?: boolean; pdfLinkPresent?: boolean;
  blockedWrites: number; blockedExternalRequests: number; runtimeErrorCount: number; failedResponseCount: number; screenshots: string[] };
type Report = { status: 'RUNNING' | 'PASS' | 'FAIL'; stage: string; startedAt: string; completedAt?: string; origin: string;
  bookId?: string; versionId?: string; approved?: boolean; views: ViewResult[]; serverStateUnchanged?: boolean;
  actualChatGpt: 'NOT_TESTED'; physicalSamsung: 'NOT_TESTED'; physicalIPhone: 'NOT_TESTED'; mode: 'READ_ONLY_ALL_WRITES_BLOCKED'; errorCode?: string };

const report: Report = { status: 'RUNNING', stage: 'load_config', startedAt: new Date().toISOString(), origin: pilotOrigin, views: [],
  actualChatGpt: 'NOT_TESTED', physicalSamsung: 'NOT_TESTED', physicalIPhone: 'NOT_TESTED', mode: 'READ_ONLY_ALL_WRITES_BLOCKED' };
let owner: APIRequestContext | undefined, browser: Browser | undefined, context: BrowserContext | undefined, page: Page | undefined, outputDirectory: string | undefined;
try {
  const loaded = await loadInternetConfig(process.argv.find(arg => arg.endsWith('.local')) || 'test-results/mcp-internet/config.local');
  const { config, storagePath } = loaded; outputDirectory = loaded.outputDirectory; report.bookId = config.bookId;
  if (process.argv.includes('--check-config')) { console.log('PASS: exact fictional pilot scope and existing owner storage validated; no network request.'); process.exit(0); }
  await writeJson(resolve(outputDirectory, 'browser-verification.json'), report);
  // Use only the existing owner cookie state. No credential login or storage refresh.
  owner = await createRemoteContext(storagePath);
  report.stage = 'verify_exact_fictional_book'; await fictionalBook(owner, config);
  const root = '/api/book-workflow/' + config.bookId, initial = await getJson<Head>(owner, root);
  ensure(initial.latestVersionId, 'SAVED_VERSION_REQUIRED');
  const version = await getJson<Version>(owner, root + '/versions/' + initial.latestVersionId);
  ensure(version.id === initial.latestVersionId && version.snapshotId, 'VERSION_SNAPSHOT_REQUIRED');
  const initialExports = await getJson<{ exports: Export[] }>(owner, root + '/exports');
  const completeExport = initialExports.exports.find(job => job.version_id === version.id && job.status === 'complete');
  ensure(version.approved_at && completeExport, 'APPROVED_SAVED_VERSION_AND_COMPLETED_EXPORT_REQUIRED');
  const firstPhotoPage = version.draft.pages.findIndex(item => item.elements.some(element => element.kind === 'photo'));
  ensure(firstPhotoPage >= 0, 'SAVED_DRAFT_MUST_CONTAIN_REAL_IMAGE');
  report.versionId = version.id; report.approved = true;
  const baseline = hash({ head: initial, version, exports: initialExports });
  const rawStorage = JSON.parse(await readFile(storagePath, 'utf8')) as { cookies: Parameters<BrowserContext['addCookies']>[0] };
  ensure(Array.isArray(rawStorage.cookies) && rawStorage.cookies.length > 0, 'EXISTING_OWNER_COOKIES_REQUIRED');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mobile of [false, true]) {
    const name = mobile ? 'mobile-emulation' : 'desktop', viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 1000 };
    report.stage = name + '_editor';
    const result: ViewResult = { name, status: 'FAIL', viewport, mobileEmulation: mobile, blockedWrites: 0, blockedExternalRequests: 0, runtimeErrorCount: 0, failedResponseCount: 0, screenshots: [] };
    report.views.push(result);
    // Deliberately omit any old localStorage recovery draft; the saved server version is inspected.
    context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'hu-HU', serviceWorkers: 'block', storageState: { cookies: rawStorage.cookies, origins: [] } });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.protocol === 'data:' || url.protocol === 'blob:') { await route.continue(); return; }
      if (url.origin !== pilotOrigin) { result.blockedExternalRequests++; await route.abort('blockedbyclient'); return; }
      if (!['GET', 'HEAD'].includes(request.method())) { result.blockedWrites++; await route.abort('blockedbyclient'); return; }
      // No request from this browser may read a different book, even with the owner cookie.
      if (/^\/api\/(?:book-workflow|montage)\//.test(url.pathname) && !url.pathname.startsWith(root + '/') && url.pathname !== root && !url.pathname.startsWith('/api/montage/' + config.bookId + '/') && url.pathname !== '/api/montage/' + config.bookId) {
        result.blockedExternalRequests++; await route.abort('blockedbyclient'); return;
      }
      await route.continue();
    });
    page = await context.newPage(); page.setDefaultTimeout(30000); page.setDefaultNavigationTimeout(60000);
    page.on('pageerror', () => { result.runtimeErrorCount++; });
    page.on('dialog', dialog => { result.runtimeErrorCount++; void dialog.dismiss(); });
    const successfulImages = new Set<string>();
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== pilotOrigin) return;
      if (response.status() >= 400 && url.pathname !== '/favicon.ico') result.failedResponseCount++;
      if (url.pathname.startsWith(root + '/image/') && response.status() === 200 && response.headers()['content-type']?.startsWith('image/')) successfulImages.add(url.pathname.split('/').pop()!);
    });
    const navigation = await page.goto(pilotOrigin + '/wedding/books/' + config.bookId + '/montage?szerkesztes=1', { waitUntil: 'domcontentloaded' });
    ensure(navigation?.status() === 200, 'EDITOR_NAVIGATION_FAILED');
    await expect(page.getByRole('heading', { name: config.expectedTitle + ' – montázs', exact: true })).toBeVisible();
    await expect(page.getByLabel('Korábbi változat', { exact: true })).toHaveValue(version.id);
    if (firstPhotoPage !== 0) await page.getByRole('button', { name: new RegExp('^' + (firstPhotoPage + 1) + '\\. oldal(?: 🔒)?$') }).click();
    const imageIds = version.draft.pages[firstPhotoPage].elements.filter(element => element.kind === 'photo').map(element => element.mediaId!);
    await expect.poll(() => imageIds.every(id => successfulImages.has(id)), { timeout: 60000 }).toBe(true);
    const canvas = page.locator('canvas.lower-canvas'); await expect(canvas).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });
    const fontLoaded = await page.evaluate(() => Array.from(document.fonts).some(face => face.family.replace(/['"]/g, '') === 'DejaVu Sans' && face.status === 'loaded') && document.fonts.check('16px "DejaVu Sans"', 'Árvíztűrő tükörfúrógép'));
    ensure(fontLoaded, 'EMBEDDED_EDITOR_FONT_NOT_LOADED'); result.fontLoaded = fontLoaded;
    await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => {
      const drawing = element.getContext('2d'); if (!drawing || !element.width || !element.height) return 0;
      const pixels = drawing.getImageData(0, 0, element.width, element.height).data, colors = new Set<string>();
      for (let index = 0; index < pixels.length; index += 4 * 131) { colors.add([pixels[index] >> 4, pixels[index + 1] >> 4, pixels[index + 2] >> 4, pixels[index + 3] >> 4].join(',')); if (colors.size >= 20) break; }
      return colors.size;
    }), { timeout: 30000 }).toBeGreaterThan(10);
    result.canvas = await canvas.evaluate((element: HTMLCanvasElement) => {
      const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data, colors = new Set<string>();
      for (let index = 0; index < pixels.length; index += 4 * 131) colors.add([pixels[index] >> 4, pixels[index + 1] >> 4, pixels[index + 2] >> 4, pixels[index + 3] >> 4].join(','));
      return { width: element.width, height: element.height, colors: colors.size };
    });
    const approvalButton = page.getByRole('button', { name: 'Ezt a könyvváltozatot jóváhagyom', exact: true });
    const exportButton = page.getByRole('button', { name: 'Jóváhagyott PDF készítése', exact: true });
    await expect(approvalButton).toBeVisible(); await expect(approvalButton).toBeDisabled(); await expect(exportButton).toBeVisible(); await expect(exportButton).toBeEnabled();
    const pdfLink = page.getByRole('link', { name: 'Jóváhagyott ellenőrző PDF letöltése', exact: true });
    await expect(pdfLink).toBeVisible(); await expect(pdfLink).toHaveAttribute('href', root + '/exports/' + completeExport.id + '/download');
    result.approvalButtonDisabled = true; result.exportButtonEnabled = true; result.pdfLinkPresent = true;
    result.horizontalOverflowPx = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    ensure(result.horizontalOverflowPx <= 2, 'HORIZONTAL_PAGE_OVERFLOW');
    result.versionId = await page.getByLabel('Korábbi változat', { exact: true }).inputValue(); result.imageResponses = successfulImages.size;
    const editorScreenshot = name + '-editor.png', canvasScreenshot = name + '-canvas.png';
    await canvas.scrollIntoViewIfNeeded(); await canvas.screenshot({ path: resolve(outputDirectory, canvasScreenshot) });
    await page.screenshot({ path: resolve(outputDirectory, editorScreenshot), fullPage: true }); result.screenshots.push(editorScreenshot, canvasScreenshot);
    ensure(result.blockedWrites === 0, 'EDITOR_ATTEMPTED_SERVER_WRITE'); ensure(result.blockedExternalRequests === 0, 'EDITOR_ATTEMPTED_OUT_OF_SCOPE_REQUEST');
    ensure(result.runtimeErrorCount === 0 && result.failedResponseCount === 0, 'EDITOR_RUNTIME_OR_NETWORK_ERRORS');
    result.status = 'PASS'; await context.close(); context = undefined; page = undefined;
    await writeJson(resolve(outputDirectory, 'browser-verification.json'), report);
  }
  report.stage = 'confirm_readonly_server_state';
  const finalHead = await getJson<Head>(owner, root), finalVersion = await getJson<Version>(owner, root + '/versions/' + version.id), finalExports = await getJson<{ exports: Export[] }>(owner, root + '/exports');
  report.serverStateUnchanged = baseline === hash({ head: finalHead, version: finalVersion, exports: finalExports });
  ensure(report.serverStateUnchanged, 'SAVED_SERVER_STATE_CHANGED_DURING_READONLY_SMOKE');
  report.status = 'PASS'; report.stage = 'complete';
} catch (error) {
  report.status = 'FAIL'; report.errorCode = error instanceof Error && /^[A-Z_0-9]+$/.test(error.message) ? error.message : 'BROWSER_SMOKE_CHECK_FAILED'; process.exitCode = 1;
  if (page && outputDirectory) try { const file = report.views.at(-1)?.name + '-failure.png'; await page.screenshot({ path: resolve(outputDirectory, file), fullPage: true }); report.views.at(-1)?.screenshots.push(file); } catch { /* Keep the original failure. */ }
} finally {
  await context?.close(); await browser?.close(); await owner?.dispose(); report.completedAt = new Date().toISOString();
  if (outputDirectory) await writeJson(resolve(outputDirectory, 'browser-verification.json'), report);
  console.log(`${report.status}: read-only Chromium desktop/mobile-emulation smoke; stage=${report.stage}. Physical phones and actual ChatGPT NOT_TESTED.`);
}
