// Read-only live verification of one explicitly authorized, finished fictional PDF.
// Run after deployment: node --import tsx scripts/verify-book-view-internet.ts
// Optional --config <ignored.local> --grant <ignored.local>; --check-config is offline.
// Never logs the bearer URL/token, refreshes an owner login, or performs a write.
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, request } from '@playwright/test';
import type { APIRequestContext, APIResponse, Browser, BrowserContext } from '@playwright/test';
import { pilotOrigin, loadInternetConfig, createRemoteContext, fictionalBook, getJson, hash, ensure, uuid, writeJson } from './mcp-internet-utils';

type GrantFile = { version: 1; url: string; bookId: string; exportId: string; versionId: string; expiresAt: string; grant?: { pdfHash?: string } };
type Version = { id: string; snapshotId: string; approved_at: string | null; draft: { pages: unknown[] } };
type Job = { id: string; version_id: string; status: string; withheld?: boolean };
type Check = { name: string; method: 'GET' | 'HEAD'; status: number; pass: boolean };
type BrowserResult = {
  transport: 'PASS' | 'FAIL'; visual: 'OPEN_MANUAL_REVIEW' | 'OPEN_VIEWER_NOT_OBSERVED';
  loginRedirect: boolean; passwordUi: boolean; nativePdfContainer: boolean; nativePdfDocumentReady: boolean; displayedPageCount?: number; pdfResponseCount: number;
  blockedWrites: number; blockedExternalRequests: number; blockedOtherPaths: number; runtimeErrors: number;
  screenshotCandidate?: string; screenshotMeaning: 'UNREVIEWED_NATIVE_VIEWER' | 'NONE'; navigationError?: 'NATIVE_PDF_NAVIGATION';
};
type Report = {
  status: 'RUNNING' | 'PASS_WITH_VISUAL_OPEN' | 'FAIL'; stage: string; mode: 'READ_ONLY_GET_HEAD';
  startedAt: string; completedAt?: string; origin: string; bookId?: string; exportId?: string; versionId?: string;
  configuredExpiresAt?: string; expiryEnforcement: 'NOT_CHANGED_OR_TIME_TRAVEL_TESTED'; checks: Check[];
  pdf?: { sha256: string; bytes: number; expectedPages: number; pageDictionaries: number; matchesProtectedOwnerPdf: boolean };
  browser?: BrowserResult; ownerStateUnchanged?: boolean; anonymousCookies?: number;
  approvalBoundary: 'GET_ONLY_NO_POST_ATTEMPT'; physicalSamsung: 'OPEN'; physicalIPhone: 'OPEN'; errorCode?: string;
};
const directory = resolve('test-results/book-view');
const report: Report = { status: 'RUNNING', stage: 'load_local_config', mode: 'READ_ONLY_GET_HEAD', startedAt: new Date().toISOString(),
  origin: pilotOrigin, expiryEnforcement: 'NOT_CHANGED_OR_TIME_TRAVEL_TESTED', checks: [], approvalBoundary: 'GET_ONLY_NO_POST_ATTEMPT',
  physicalSamsung: 'OPEN', physicalIPhone: 'OPEN' };
let owner: APIRequestContext | undefined, anonymous: APIRequestContext | undefined, browser: Browser | undefined, browserContext: BrowserContext | undefined;
let offline = false;
function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  ensure(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), 'LOCAL_ARGUMENT_REQUIRED');
  return process.argv[index + 1];
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function noCookie(response: APIResponse) { ensure(!response.headers()['set-cookie'], 'ANONYMOUS_RESPONSE_SET_COOKIE'); }
function check(name: string, method: 'GET' | 'HEAD', response: APIResponse, status: number) {
  report.checks.push({ name, method, status: response.status(), pass: response.status() === status });
  ensure(response.status() === status, 'CHECK_' + name.toUpperCase() + '_HTTP_' + response.status());
  noCookie(response);
}
function pdfHeaders(response: APIResponse) {
  const headers = response.headers();
  ensure(/^application\/pdf(?:;|$)/i.test(headers['content-type'] || ''), 'PUBLIC_PDF_MIME_REQUIRED');
  ensure(/^inline\s*;\s*filename="memorybook\.pdf"$/i.test(headers['content-disposition'] || ''), 'SAFE_INLINE_PDF_FILENAME_REQUIRED');
  ensure(/\bno-store\b/i.test(headers['cache-control'] || ''), 'PUBLIC_PDF_MUST_NOT_CACHE');
  ensure(headers['referrer-policy'] === 'no-referrer', 'PUBLIC_PDF_REFERRER_POLICY_REQUIRED');
  ensure(headers['x-content-type-options'] === 'nosniff', 'PUBLIC_PDF_NOSNIFF_REQUIRED');
}

try {
  offline = process.argv.includes('--check-config');
  const { config, storagePath } = await loadInternetConfig(arg('--config', 'test-results/mcp-internet/config.local'));
  const grantPath = resolve(arg('--grant', 'test-results/book-view/grant.local'));
  ensure(grantPath.startsWith(directory + '\\') || grantPath.startsWith(directory + '/'), 'GRANT_FILE_MUST_STAY_IN_BOOK_VIEW');
  ensure(grantPath.endsWith('.local'), 'GRANT_FILE_MUST_BE_IGNORED_LOCAL');
  const grant = JSON.parse(await readFile(grantPath, 'utf8')) as GrantFile;
  ensure(grant.version === 1 && grant.bookId === config.bookId && uuid.test(grant.exportId) && uuid.test(grant.versionId), 'EXACT_EXPORT_GRANT_REQUIRED');
  const url = new URL(grant.url);
  ensure(url.origin === pilotOrigin && !url.username && !url.password && !url.search && !url.hash && /^\/wedding\/view\/[A-Za-z\d_-]{43}$/.test(url.pathname), 'INVALID_VIEW_URL');
  ensure(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(grant.expiresAt) && Date.parse(grant.expiresAt) > Date.now(), 'GRANT_EXPIRED_OR_INVALID_EXPIRY');
  ensure(!grant.grant?.pdfHash || /^[a-f\d]{64}$/.test(grant.grant.pdfHash), 'INVALID_EXPECTED_PDF_HASH');
  Object.assign(report, { bookId: grant.bookId, exportId: grant.exportId, versionId: grant.versionId, configuredExpiresAt: grant.expiresAt });
  if (offline) {
    console.log('PASS: ignored inputs, existing owner storage, exact fictional book/export scope and unexpired view grant validated. No network/browser activity.');
  } else {
    await mkdir(directory, { recursive: true });
    await writeJson(resolve(directory, 'verification.json'), report);
    // Use the existing owner state without login/refresh or writing a new storage file.
    owner = await createRemoteContext(storagePath);
    anonymous = await request.newContext({ baseURL: pilotOrigin, timeout: 60000 });
    report.stage = 'owner_baseline';
    const detail = await fictionalBook(owner, config), root = '/api/book-workflow/' + grant.bookId;
    const versionPath = root + '/versions/' + grant.versionId, exportPath = root + '/exports/' + grant.exportId;
    const reviewsPath = root + '/reviews?versionId=' + grant.versionId;
    const baseline = { book: detail, head: await getJson(owner, root), version: await getJson<Version>(owner, versionPath),
      job: await getJson<Job>(owner, exportPath), reviews: await getJson(owner, reviewsPath) };
    ensure(baseline.version.id === grant.versionId && baseline.version.snapshotId && baseline.version.approved_at, 'EXACT_APPROVED_VERSION_REQUIRED');
    ensure(baseline.job.id === grant.exportId && baseline.job.version_id === grant.versionId && baseline.job.status === 'complete' && !baseline.job.withheld, 'EXACT_COMPLETED_EXPORT_REQUIRED');
    ensure(baseline.version.draft.pages.length === 16, 'EXPECTED_SIXTEEN_PAGE_BOOK_REQUIRED');
    const protectedResponse = await owner.get(exportPath + '/download', { maxRedirects: 0 });
    ensure(protectedResponse.status() === 200, 'OWNER_PROTECTED_PDF_UNAVAILABLE');
    const protectedPdf = await protectedResponse.body(), expectedHash = sha(protectedPdf);
    ensure(protectedPdf.subarray(0, 5).toString() === '%PDF-', 'OWNER_RESPONSE_NOT_PDF');
    ensure(!grant.grant?.pdfHash || expectedHash === grant.grant.pdfHash, 'OWNER_PDF_DIFFERS_FROM_LOCAL_GRANT');

    report.stage = 'anonymous_exact_pdf';
    const response = await anonymous.get(url.pathname, { maxRedirects: 0 });
    check('exact_view', 'GET', response, 200); pdfHeaders(response);
    const publicPdf = await response.body(), publicHash = sha(publicPdf);
    ensure(publicPdf.subarray(0, 5).toString() === '%PDF-' && publicHash === expectedHash, 'PUBLIC_PDF_BYTES_DIFFER');
    const pages = publicPdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length || 0;
    ensure(pages === baseline.version.draft.pages.length, 'PUBLIC_PDF_PAGE_COUNT_DIFFERS');
    report.pdf = { sha256: publicHash, bytes: publicPdf.length, expectedPages: baseline.version.draft.pages.length, pageDictionaries: pages, matchesProtectedOwnerPdf: true };
    const head = await anonymous.head(url.pathname, { maxRedirects: 0 });
    check('head_view', 'HEAD', head, 200); pdfHeaders(head);
    ensure((await head.body()).length === 0, 'HEAD_RETURNED_BODY');
    const range = await anonymous.get(url.pathname, { headers: { Range: 'bytes=0-31' }, maxRedirects: 0 });
    check('range_view', 'GET', range, 206); pdfHeaders(range);
    ensure(range.headers()['content-range'] === `bytes 0-31/${publicPdf.length}` && (await range.body()).equals(publicPdf.subarray(0, 32)), 'PUBLIC_PDF_RANGE_DIFFERS');

    report.stage = 'anonymous_scope_boundaries';
    const token = url.pathname.split('/').pop()!;
    const wrongToken = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
    const deniedViews: [string, string][] = [
      ['bad_token', '/wedding/view/' + wrongToken], ['empty_token', '/wedding/view'], ['empty_token_slash', '/wedding/view/'],
      ['extra_path', url.pathname + '/extra'], ['other_book_suffix', url.pathname + '/' + config.denyBookId],
      ['other_export_suffix', url.pathname + '/exports/' + randomUUID() + '/download'],
      ['book_query_override', url.pathname + '?bookId=' + config.denyBookId], ['export_query_override', url.pathname + '?exportId=' + randomUUID()],
    ];
    for (const [name, path] of deniedViews) {
      const denied = await anonymous.get(path, { maxRedirects: 0 }); check(name, 'GET', denied, 404);
      ensure(!/^application\/pdf/i.test(denied.headers()['content-type'] || ''), 'DENIED_VIEW_RETURNED_PDF');
      const body = await denied.text(); ensure(!body.includes(token) && !body.includes(grant.bookId) && !body.includes(grant.exportId), 'DENIAL_DISCLOSES_GRANT_DETAILS');
    }
    const mediaId = detail.submissions.flatMap(item => item.media).find(item => uuid.test(item.id))?.id;
    ensure(mediaId, 'OWNER_ORIGINAL_PROTECTION_FIXTURE_REQUIRED');
    const ownerPaths: [string, string][] = [
      ['owner_book_list', '/api/wedding/books'], ['owner_book_detail', '/api/wedding/books/' + grant.bookId], ['owner_workflow_list', '/api/book-workflow'],
      ['owner_sources', root + '/submissions'], ['owner_snapshot', root + '/snapshots/' + baseline.version.snapshotId],
      ['owner_original', '/api/wedding/media/' + mediaId + '/original'], ['owner_editor_data', '/api/montage/' + grant.bookId],
      ['owner_version', versionPath], ['owner_edit_boundary_get', root + '/versions'], ['owner_approval_boundary_get', versionPath + '/approve'],
      ['owner_export_download', exportPath + '/download'],
    ];
    for (const [name, path] of ownerPaths) check(name, 'GET', await anonymous.get(path, { maxRedirects: 0 }), 401);
    report.anonymousCookies = (await anonymous.storageState()).cookies.length;
    ensure(report.anonymousCookies === 0, 'ANONYMOUS_SESSION_CREATED');

    report.stage = 'fresh_chrome_pdf';
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    browserContext = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'hu-HU', serviceWorkers: 'block', acceptDownloads: false });
    const result: BrowserResult = { transport: 'FAIL', visual: 'OPEN_VIEWER_NOT_OBSERVED', loginRedirect: false, passwordUi: false, nativePdfContainer: false, nativePdfDocumentReady: false,
      pdfResponseCount: 0, blockedWrites: 0, blockedExternalRequests: 0, blockedOtherPaths: 0, runtimeErrors: 0, screenshotMeaning: 'NONE' };
    report.browser = result;
    await browserContext.route('**/*', async route => {
      const req = route.request(), target = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) { result.blockedWrites++; await route.abort(); return; }
      // Chrome's PDF viewer loads its bundled UI from chrome://resources/.
      // Permit that proven internal host, never arbitrary chrome or external URLs.
      const nativeChromeResource = target.protocol === 'chrome:' && target.hostname === 'resources';
      if (nativeChromeResource || ['data:', 'blob:', 'chrome-extension:'].includes(target.protocol)) { await route.continue(); return; }
      if (target.origin !== pilotOrigin) { result.blockedExternalRequests++; await route.abort(); return; }
      if (target.pathname !== url.pathname && !/^\/favicon\.(?:ico|png|svg)$/.test(target.pathname)) { result.blockedOtherPaths++; await route.abort(); return; }
      await route.continue();
    });
    const page = await browserContext.newPage();
    page.on('pageerror', () => { result.runtimeErrors++; });
    page.on('dialog', dialog => { void dialog.dismiss(); });
    page.on('response', res => {
      if (res.url() === grant.url && [200, 206].includes(res.status()) && /^application\/pdf/.test(res.headers()['content-type'] || '')) result.pdfResponseCount++;
    });
    try { await page.goto(grant.url, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch { result.navigationError = 'NATIVE_PDF_NAVIGATION'; } // Browser-native PDF navigation sometimes aborts the document navigation.
    // A newly created embed has an empty dark surface and a URL-derived title.
    // Wait for the known PDF metadata and exact page count in Chrome's toolbar.
    // This proves document loading; the resulting pixels still require human review.
    const viewerDeadline = Date.now() + 15000;
    while (Date.now() < viewerDeadline) {
      result.nativePdfContainer = (await Promise.all(page.frames().map(frame =>
        frame.locator('embed[type="application/pdf"], object[type="application/pdf"], pdf-viewer').count().catch(() => 0)))).some(count => count > 0);
      const metadata = await Promise.all(page.frames().map(async frame => {
        const titles = await frame.locator('viewer-toolbar #title').allTextContents().catch(() => []);
        const counts = await frame.locator('viewer-toolbar #pagelength').allTextContents().catch(() => []);
        return { knownTitle: titles.some(text => /^MemoryBook\s*[–-]\s*ellenőrző PDF$/.test(text.trim())),
          pageCount: counts.map(text => Number(text.trim())).find(count => count === baseline.version.draft.pages.length) };
      }));
      const ready = metadata.find(item => item.knownTitle && item.pageCount === baseline.version.draft.pages.length);
      if (ready && result.nativePdfContainer && result.pdfResponseCount > 0) {
        result.nativePdfDocumentReady = true; result.displayedPageCount = ready.pageCount;
        await new Promise(resolve => setTimeout(resolve, 500)); // Allow the now-loaded native surface to paint.
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    result.loginRedirect = page.frames().some(frame => /\/pilot\/account|\/sign-in|\/login/i.test(new URL(frame.url()).pathname));
    result.passwordUi = (await Promise.all(page.frames().map(frame => frame.locator('input[type="password"]').count().catch(() => 0)))).some(count => count > 0);
    ensure(!result.loginRedirect && !result.passwordUi && result.pdfResponseCount > 0, 'BROWSER_PDF_WITHOUT_LOGIN_NOT_OBSERVED');
    ensure(result.blockedWrites === 0 && result.blockedExternalRequests === 0 && result.blockedOtherPaths === 0, 'BROWSER_UNEXPECTED_REQUEST_BLOCKED');
    ensure(result.runtimeErrors === 0, 'BROWSER_RUNTIME_ERRORS');
    ensure((await browserContext.cookies()).length === 0, 'BROWSER_SESSION_CREATED');
    ensure(result.nativePdfDocumentReady, 'NATIVE_PDF_DOCUMENT_NOT_READY');
    if (result.nativePdfDocumentReady) {
      // The address bar is not captured. Never save a page displaying the token in its DOM.
      const visibleTexts = await Promise.all(page.frames().map(frame => frame.locator('body').innerText({ timeout: 2000 }).catch(() => null)));
      if (visibleTexts.every(text => text !== null && !text.includes(token))) {
        await page.screenshot({ path: resolve(directory, 'native-pdf-unreviewed.png'), fullPage: false });
        result.screenshotCandidate = 'native-pdf-unreviewed.png'; result.screenshotMeaning = 'UNREVIEWED_NATIVE_VIEWER'; result.visual = 'OPEN_MANUAL_REVIEW';
      }
    }
    result.transport = 'PASS';
    await browserContext.close(); browserContext = undefined;
    await browser.close(); browser = undefined;

    report.stage = 'owner_state_unchanged';
    const final = { book: await fictionalBook(owner, config), head: await getJson(owner, root), version: await getJson(owner, versionPath),
      job: await getJson(owner, exportPath), reviews: await getJson(owner, reviewsPath) };
    report.ownerStateUnchanged = hash(baseline) === hash(final); ensure(report.ownerStateUnchanged, 'OWNER_STATE_CHANGED');
    const finalPdf = await owner.get(exportPath + '/download', { maxRedirects: 0 });
    ensure(finalPdf.status() === 200 && sha(await finalPdf.body()) === expectedHash, 'OWNER_PDF_CHANGED');
    report.status = 'PASS_WITH_VISUAL_OPEN'; report.stage = 'complete';
  }
} catch (error) {
  report.status = 'FAIL';
  // Playwright/network errors may embed the bearer URL. Never retain messages/stacks.
  const message = error instanceof Error ? error.message : '';
  report.errorCode = /^[A-Z][A-Z0-9_]{1,110}$/.test(message) ? message : 'UNEXPECTED_ERROR_REDACTED';
  process.exitCode = 1;
} finally {
  await browserContext?.close().catch(() => undefined); await browser?.close().catch(() => undefined);
  await owner?.dispose().catch(() => undefined); await anonymous?.dispose().catch(() => undefined);
  report.completedAt = new Date().toISOString();
  if (!offline) await writeJson(resolve(directory, 'verification.json'), report).catch(() => { process.exitCode = 1; });
  if (!offline || report.status === 'FAIL') console.log(JSON.stringify({ status: report.status, stage: report.stage, checks: report.checks.length,
    errorCode: report.errorCode, report: offline ? undefined : 'test-results/book-view/verification.json', physicalPhone: 'OPEN', visual: report.browser?.visual }));
}
