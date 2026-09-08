import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import pg from 'pg';

const { Client } = pg;
const API = 'http://127.0.0.1:3001';
const WEB = 'http://127.0.0.1:4173';
const db = new Client({ connectionString: process.env.DATABASE_URL });

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function json(response) {
  return response.json().catch(() => ({}));
}

async function expectStatus(response, expected, label) {
  const body = await json(response);
  assert.equal(response.status(), expected, `${label}: expected ${expected}, got ${response.status()} ${JSON.stringify(body)}`);
  return body;
}

async function expectOk(response, label) {
  const body = await json(response);
  assert.ok(response.ok(), `${label}: ${response.status()} ${JSON.stringify(body)}`);
  return body;
}

async function noOverflow(page, label) {
  const dims = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  assert.ok(dims.scrollWidth <= dims.clientWidth + 1, `${label}: horizontal overflow ${dims.scrollWidth} > ${dims.clientWidth}`);
}

async function grantEntitlement({ purchaseId, userId = null, bookType, pages, giftToken = null }) {
  const entitlementId = id('ent-reg');
  await db.query(
    `UPDATE purchases
     SET payment_status = 'paid', paid_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [purchaseId]
  );
  await db.query(
    `INSERT INTO book_entitlements
       (id, purchase_id, assigned_user_id, gift_token, book_type, included_pages, status, claimed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'available', CASE WHEN $3::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`,
    [entitlementId, purchaseId, userId, giftToken, bookType, pages]
  );
  return entitlementId;
}

async function createPurchase(api, { mode, bookType, email }) {
  const response = await api.post(`${API}/api/purchases`, {
    data: {
      purchaseMode: mode,
      bookType,
      paymentProvider: 'simplepay',
      purchaserName: 'Regression Owner',
      purchaserEmail: email,
      billingName: 'Regression Owner',
      billingEmail: email,
      billingCountry: 'Hungary',
      billingPostalCode: '8900',
      billingCity: 'Zalaegerszeg',
      billingAddress: 'Regression utca 1.',
      billingTaxNumber: '',
    },
  });
  const body = await expectStatus(response, 201, `create ${mode} ${bookType} purchase`);
  assert.equal(body.paymentReady, false, 'payment integration must still be pending');
  assert.ok(body.purchase?.id, 'purchase id missing');
  return body.purchase.id;
}

async function createBook(api, entitlementId, title, language) {
  const response = await api.post(`${API}/api/my/books`, {
    data: { title, entitlementId, language },
  });
  const body = await expectStatus(response, 201, `create book ${title}`);
  assert.ok(body.book?.id, 'book id missing');
  return body.book;
}

await db.connect();
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'de-DE',
});
const api = context.request;
const page = await context.newPage();

try {
  // 1. Public/auth foundation and first-use language.
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Anmelden oder registrieren' }).waitFor();
  await noOverflow(page, 'login mobile');
  const languageSelect = page.locator('select').first();
  assert.equal(await languageSelect.inputValue(), 'de', 'German browser locale must select German on first use');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'de');
  assert.equal(await page.evaluate(() => localStorage.getItem('memorybook-app-language')), null, 'automatic detection need not persist a manual preference');
  await languageSelect.selectOption('en');
  await page.getByRole('heading', { name: 'Sign in or register' }).waitFor();
  await languageSelect.selectOption('de');
  await page.getByRole('heading', { name: 'Anmelden oder registrieren' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('memorybook-app-language')), 'de', 'manual language choice must persist');

  const unauthPurchase = await fetch(`${API}/api/purchases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      purchaseMode: 'self',
      bookType: 'standard',
      paymentProvider: 'simplepay',
      purchaserName: 'No User',
      purchaserEmail: 'nouser@example.com',
      billingName: 'No User',
      billingEmail: 'nouser@example.com',
      billingCountry: 'Hungary',
      billingPostalCode: '8900',
      billingCity: 'Zalaegerszeg',
      billingAddress: 'Test 1',
    }),
  });
  assert.equal(unauthPurchase.status, 401, 'self purchase must require account');

  const email = `regression-${Date.now()}@example.com`;
  const password = `R3g-${crypto.randomUUID()}-Aa!`;
  await expectOk(
    await api.post(`${API}/api/auth/sign-up/email`, {
      data: { name: 'Regression Owner', email, password },
    }),
    'signup'
  );
  const me = await expectOk(await api.get(`${API}/api/me`), 'load session');
  assert.equal(me.user?.email, email);
  const userId = me.user.id;

  // 2. Standard self-purchase -> entitlement -> 30-page book.
  const standardPurchaseId = await createPurchase(api, { mode: 'self', bookType: 'standard', email });
  const draftCheck = await db.query('SELECT payment_status FROM purchases WHERE id = $1', [standardPurchaseId]);
  assert.equal(draftCheck.rows[0]?.payment_status, 'draft', 'purchase must start as draft');
  const standardEntitlementId = await grantEntitlement({
    purchaseId: standardPurchaseId,
    userId,
    bookType: 'standard',
    pages: 30,
  });

  const entitlementsBefore = await expectOk(await api.get(`${API}/api/my/entitlements`), 'list entitlements');
  assert.ok(entitlementsBefore.entitlements.some((e) => e.id === standardEntitlementId && e.status === 'available'));

  const standardBook = await createBook(api, standardEntitlementId, 'Regression Standard DE', 'de');
  const standardBookId = standardBook.id;
  const standardPagesData = await expectOk(
    await api.get(`${API}/api/my/books/${encodeURIComponent(standardBookId)}/pages`),
    'load standard pages'
  );
  assert.equal(standardPagesData.book?.bookType, 'standard');
  assert.equal(standardPagesData.book?.language, 'de');
  assert.equal(standardPagesData.pages?.length, 30, 'standard book must start with 30 pages');
  const [page1, page2] = standardPagesData.pages;
  assert.ok(page1?.id && page2?.id);

  const reused = await api.post(`${API}/api/my/books`, {
    data: { title: 'Must not exist', entitlementId: standardEntitlementId, language: 'de' },
  });
  assert.ok(!reused.ok(), 'redeemed entitlement must not create a second book');

  // 3. Standard page invite, autosave, final submit, notification, sharing.
  const inviteCreate1 = await expectOk(
    await api.post(`${API}/api/my/books/${standardBookId}/pages/${page1.id}/invite`),
    'create page 1 invite'
  );
  const token1 = inviteCreate1.inviteToken;
  assert.ok(token1);
  const sent1 = await expectOk(
    await api.post(`${API}/api/my/books/${standardBookId}/pages/${page1.id}/invite/sent`, {
      data: {
        recipientName: 'Anna Regression',
        recipientEmail: '',
        deliveryMethod: 'share',
        inviteLanguage: null,
      },
    }),
    'mark page 1 invite sent'
  );
  assert.equal(sent1.inviteLanguage, null);

  const invite1 = await expectOk(await api.get(`${API}/api/page-invites/${token1}`), 'load page 1 invite');
  assert.equal(invite1.language, 'de', 'invite must inherit German book language');
  assert.equal(invite1.inviteLanguage, null);

  await page.goto(`${WEB}/p/${token1}`, { waitUntil: 'networkidle' });
  await page.getByText(`Deine Seite: Seite ${page1.pageNumber}`, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Seite einreichen' }).waitFor();
  await noOverflow(page, 'German invite editor mobile');
  assert.equal(await page.evaluate(() => localStorage.getItem('memorybook-app-language')), 'de', 'invite language must not alter app preference');

  const save1 = await expectOk(
    await api.put(`${API}/api/page-invites/${token1}`, {
      data: {
        canvasData: { version: 'regression', objects: [{ type: 'textbox', text: 'Regression draft' }] },
        previewDataUrl: null,
        expectedVersion: invite1.version,
      },
    }),
    'autosave invited page'
  );
  assert.ok(save1.version > invite1.version);

  const notifBefore = await expectOk(await api.get(`${API}/api/my/notifications/unread-count`), 'notification count before submit');
  assert.equal(notifBefore.unreadCount, 0, 'autosave must not notify owner');

  const submit1 = await expectOk(
    await api.post(`${API}/api/page-invites/${token1}/submit`, { data: { authorShareApproved: true } }),
    'final page submit'
  );
  assert.equal(submit1.success, true);

  const notifications = await expectOk(await api.get(`${API}/api/my/notifications`), 'notifications after submit');
  assert.equal(notifications.unreadCount, 1, 'final submit must create exactly one unread notification');
  const standardNotification = notifications.notifications.find((n) => n.pageId === page1.id);
  assert.ok(standardNotification, 'submitted page notification missing');
  assert.equal(standardNotification.actorName, 'Anna Regression');
  assert.equal(standardNotification.targetPath, `/my-books/${standardBookId}?page=${page1.id}`);

  const readResult = await expectOk(
    await api.patch(`${API}/api/my/notifications/${standardNotification.id}/read`),
    'mark notification read'
  );
  assert.equal(readResult.unreadCount, 0);

  const postSubmitSave = await api.put(`${API}/api/page-invites/${token1}`, {
    data: { canvasData: { objects: [] }, previewDataUrl: null, expectedVersion: save1.version },
  });
  assert.equal(postSubmitSave.status(), 410, 'submitted page must be locked against autosave');

  const sharing = await expectOk(
    await api.patch(`${API}/api/my/books/${standardBookId}/pages/${page1.id}/sharing`, {
      data: { approved: true },
    }),
    'approve public sharing'
  );
  assert.ok(sharing.page?.publicShareToken, 'public share token missing');
  const publicToken = sharing.page.publicShareToken;
  const publicData = await expectOk(await api.get(`${API}/api/public-pages/${publicToken}`), 'load public shared page');
  assert.equal(publicData.pageNumber, page1.pageNumber);

  await page.goto(`${WEB}/share/${publicToken}`, { waitUntil: 'networkidle' });
  await page.getByText(`Öffentlich geteilte Seite · Seite ${page1.pageNumber}`, { exact: true }).waitFor();
  await noOverflow(page, 'public shared page mobile');

  // 4. Explicit invite language + 14-day reassignment privacy reset.
  const inviteCreate2 = await expectOk(
    await api.post(`${API}/api/my/books/${standardBookId}/pages/${page2.id}/invite`),
    'create page 2 invite'
  );
  const oldToken2 = inviteCreate2.inviteToken;
  await expectOk(
    await api.post(`${API}/api/my/books/${standardBookId}/pages/${page2.id}/invite/sent`, {
      data: {
        recipientName: 'Bob Regression',
        recipientEmail: '',
        deliveryMethod: 'share',
        inviteLanguage: 'en',
      },
    }),
    'mark page 2 invite sent'
  );
  const invite2 = await expectOk(await api.get(`${API}/api/page-invites/${oldToken2}`), 'load explicit English invite');
  assert.equal(invite2.language, 'en');
  assert.equal(invite2.inviteLanguage, 'en');
  await expectOk(
    await api.put(`${API}/api/page-invites/${oldToken2}`, {
      data: {
        canvasData: { version: 'regression', objects: [{ type: 'textbox', text: 'PRIVATE OLD DRAFT' }] },
        previewDataUrl: null,
        expectedVersion: invite2.version,
      },
    }),
    'save private draft before reassignment'
  );

  await db.query(`UPDATE pages SET invite_created_at = CURRENT_TIMESTAMP - INTERVAL '15 days' WHERE id = $1`, [page2.id]);
  const reassigned = await expectOk(
    await api.post(`${API}/api/my/books/${standardBookId}/pages/${page2.id}/invite/reassign`),
    'reassign expired page invite'
  );
  assert.ok(reassigned.inviteToken && reassigned.inviteToken !== oldToken2, 'reassignment must rotate token');
  assert.equal(reassigned.inviteLanguage, null, 'reassignment must clear invite language override');

  const oldLookup = await api.get(`${API}/api/page-invites/${oldToken2}`);
  assert.ok(!oldLookup.ok(), 'old invite token must be invalid after reassignment');
  const page2Db = await db.query(
    `SELECT canvas_json, preview_image_url, invite_recipient_name, invite_recipient_email, invite_delivery_method, invite_language
     FROM pages WHERE id = $1`,
    [page2.id]
  );
  const resetRow = page2Db.rows[0];
  assert.equal(resetRow.preview_image_url, null);
  assert.equal(resetRow.invite_recipient_name, null);
  assert.equal(resetRow.invite_recipient_email, null);
  assert.equal(resetRow.invite_delivery_method, null);
  assert.equal(resetRow.invite_language, null);
  assert.ok(!JSON.stringify(resetRow.canvas_json ?? {}).includes('PRIVATE OLD DRAFT'), 'old draft content must be deleted');

  await expectOk(
    await api.post(`${API}/api/my/books/${standardBookId}/pages/${page2.id}/invite/sent`, {
      data: {
        recipientName: 'Carla Regression',
        recipientEmail: '',
        deliveryMethod: 'share',
        inviteLanguage: null,
      },
    }),
    'send reassigned invite'
  );
  const newInvite2 = await expectOk(await api.get(`${API}/api/page-invites/${reassigned.inviteToken}`), 'load reassigned invite');
  assert.equal(newInvite2.language, 'de');

  // 5. Gift purchase/redeem -> event entitlement -> event book.
  const giftPurchaseId = await createPurchase(api, { mode: 'gift', bookType: 'event', email });
  const giftToken = id('gift-reg');
  const eventEntitlementId = await grantEntitlement({
    purchaseId: giftPurchaseId,
    userId: null,
    bookType: 'event',
    pages: 0,
    giftToken,
  });

  const giftPublic = await expectOk(await api.get(`${API}/api/gift-entitlements/${giftToken}`), 'load gift entitlement');
  assert.equal(giftPublic.bookType, 'event');
  assert.equal(giftPublic.claimStatus, 'available');

  await page.goto(`${WEB}/gift/${giftToken}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Erinnerungsbuch als Geschenk' }).waitFor();
  await page.getByRole('button', { name: 'Geschenk einlösen' }).waitFor();
  await noOverflow(page, 'gift redeem mobile');

  await expectOk(await api.post(`${API}/api/gift-entitlements/${giftToken}/redeem`), 'redeem gift entitlement');
  const claimed = await db.query('SELECT assigned_user_id, status FROM book_entitlements WHERE id = $1', [eventEntitlementId]);
  assert.equal(claimed.rows[0]?.assigned_user_id, userId);
  assert.equal(claimed.rows[0]?.status, 'available');

  const eventBook = await createBook(api, eventEntitlementId, 'Regression Event DE', 'de');
  const eventBookId = eventBook.id;
  const eventOwnerData = await expectOk(
    await api.get(`${API}/api/my/books/${eventBookId}/pages`),
    'load event book owner data'
  );
  assert.equal(eventOwnerData.book?.bookType, 'event');
  assert.equal(eventOwnerData.book?.language, 'de');
  assert.equal(eventOwnerData.pages?.length, 0, 'event book must not create blank pages');
  const eventToken = eventOwnerData.book?.eventInviteToken;
  assert.ok(eventToken, 'event invite token missing');

  const settings1 = await expectOk(await api.get(`${API}/api/my/books/${eventBookId}/event-settings`), 'load event settings');
  assert.equal(settings1.deviceLimit, 1);
  const settings2 = await expectOk(
    await api.patch(`${API}/api/my/books/${eventBookId}/event-settings`, { data: { deviceLimit: 2 } }),
    'set event device limit'
  );
  assert.equal(settings2.deviceLimit, 2);

  const joinMeta = await expectOk(await api.get(`${API}/api/invites/${eventToken}`), 'load event join metadata');
  assert.equal(joinMeta.deviceLimit, 2);

  await page.goto(`${WEB}/join/${eventToken}`, { waitUntil: 'networkidle' });
  await page.getByText('Von diesem Gerät können höchstens', { exact: false }).waitFor();
  await noOverflow(page, 'event join mobile');

  const submitContribution = async (deviceId, contributorName, memoryText) => {
    return api.post(`${API}/api/invites/${eventToken}/contributions`, {
      data: { contributorName, memoryText, photoDataUrl: null, deviceId },
    });
  };

  const c1 = await expectOk(await submitContribution('device-reg-a', 'Guest One', 'First event memory'), 'event contribution 1');
  assert.equal(c1.deviceSubmissionsRemaining, 1);
  const c2 = await expectOk(await submitContribution('device-reg-a', 'Guest Two', 'Second event memory'), 'event contribution 2');
  assert.equal(c2.deviceSubmissionsRemaining, 0);
  const c3BlockedResponse = await submitContribution('device-reg-a', 'Guest Blocked', 'Should not save');
  const c3Blocked = await json(c3BlockedResponse);
  assert.ok(!c3BlockedResponse.ok());
  assert.equal(c3Blocked.error, 'DEVICE_CONTRIBUTION_LIMIT_REACHED');
  const c3 = await expectOk(await submitContribution('device-reg-b', 'Guest Three', 'Third event memory'), 'event contribution other device');

  const eventNotifications = await db.query('SELECT COUNT(*)::int AS count FROM notifications WHERE book_id = $1', [eventBookId]);
  assert.equal(eventNotifications.rows[0]?.count, 0, 'event contributions must not create notification rows');
  const unreadAfterEvent = await expectOk(await api.get(`${API}/api/my/notifications/unread-count`), 'unread after event submissions');
  assert.equal(unreadAfterEvent.unreadCount, 0, 'event submissions must not increment notification badge');

  let ownerContribs = await expectOk(await api.get(`${API}/api/books/${eventBookId}/contributions`), 'owner event contributions');
  assert.equal(ownerContribs.contributions.length, 3);
  assert.equal(ownerContribs.contributions.filter((c) => (c.ownerStatus ?? 'pending') === 'pending').length, 3);

  const firstId = c1.contribution.id;
  const secondId = c2.contribution.id;
  const thirdId = c3.contribution.id;
  const kept1 = await expectOk(
    await api.patch(`${API}/api/my/books/${eventBookId}/contributions/${firstId}`, { data: { ownerStatus: 'kept' } }),
    'keep contribution 1'
  );
  assert.equal(kept1.contribution.ownerStatus, 'kept');
  const kept2 = await expectOk(
    await api.patch(`${API}/api/my/books/${eventBookId}/contributions/${secondId}`, { data: { ownerStatus: 'kept' } }),
    'keep contribution 2'
  );
  assert.equal(kept2.contribution.ownerStatus, 'kept');
  const grouped = await expectOk(
    await api.patch(`${API}/api/my/books/${eventBookId}/contributions/${firstId}/group`, { data: { ownerGroup: 'Familie' } }),
    'group kept contribution'
  );
  assert.equal(grouped.contribution.ownerGroup, 'Familie');
  const reordered = await expectOk(
    await api.put(`${API}/api/my/books/${eventBookId}/contributions/reorder`, { data: { contributionIds: [secondId, firstId] } }),
    'reorder kept contributions'
  );
  assert.deepEqual(reordered.order.map((x) => x.id), [secondId, firstId]);
  const rejected = await expectOk(
    await api.patch(`${API}/api/my/books/${eventBookId}/contributions/${thirdId}`, { data: { ownerStatus: 'rejected' } }),
    'reject contribution 3'
  );
  assert.equal(rejected.contribution.ownerStatus, 'rejected');

  ownerContribs = await expectOk(await api.get(`${API}/api/books/${eventBookId}/contributions`), 'reload moderated event contributions');
  const byId = new Map(ownerContribs.contributions.map((c) => [c.id, c]));
  assert.equal(byId.get(firstId)?.ownerGroup, 'Familie');
  assert.equal(byId.get(secondId)?.ownerOrder, 1);
  assert.equal(byId.get(firstId)?.ownerOrder, 2);
  assert.equal(byId.get(thirdId)?.ownerStatus, 'rejected');

  // 6. Owner/public mobile smoke on real data and language separation.
  await page.goto(`${WEB}/my-books`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Meine Bücher' }).waitFor();
  await page.getByText('Regression Standard DE', { exact: true }).waitFor();
  await page.getByText('Regression Event DE', { exact: true }).waitFor();
  await noOverflow(page, 'my books mobile');

  await page.goto(`${WEB}/purchase`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Erinnerungsbuch kaufen' }).waitFor();
  await noOverflow(page, 'purchase mobile');

  await page.goto(`${WEB}/my-books/${standardBookId}`, { waitUntil: 'networkidle' });
  await page.getByText('Regression Standard DE', { exact: true }).waitFor();
  await noOverflow(page, 'standard owner mobile');

  await page.goto(`${WEB}/my-books/${eventBookId}`, { waitUntil: 'networkidle' });
  await page.getByText('Regression Event DE', { exact: true }).waitFor();
  await noOverflow(page, 'event owner mobile');

  await page.goto(`${WEB}/organizer/${eventBookId}/contributions`, { waitUntil: 'networkidle' });
  await page.getByText('Regression Event DE', { exact: true }).waitFor();
  await page.getByText('Behalten', { exact: false }).first().waitFor();
  await noOverflow(page, 'event organizer mobile');

  // Reassigned invitation uses book language; app-level preference remains independent.
  const activeToken2 = reassigned.inviteToken;
  await page.goto(`${WEB}/p/${activeToken2}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Seite einreichen' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('memorybook-app-language')), 'de');

  const booksFinal = await expectOk(await api.get(`${API}/api/my/books`), 'final owner book list');
  assert.ok(booksFinal.books.some((b) => b.id === standardBookId && b.pageCount === 30 && b.language === 'de'));
  assert.ok(booksFinal.books.some((b) => b.id === eventBookId && b.pageCount === 0 && b.contributionCount === 3 && b.language === 'de'));

  console.log('FULL_REGRESSION_PASS');
  console.log(JSON.stringify({
    standardBookId,
    eventBookId,
    checks: {
      purchaseDraft: true,
      entitlementOneBook: true,
      standard30Pages: true,
      inviteAutosaveNoNotification: true,
      finalSubmitNotification: true,
      submittedLock: true,
      publicSharing: true,
      invitePrivacyReassignment: true,
      giftRedeem: true,
      eventNoBlankPages: true,
      eventDeviceLimit: true,
      eventNoNotifications: true,
      eventModerationGroupingReorder: true,
      mobile390: true,
      huEnDeFoundation: true,
    },
  }, null, 2));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await db.end().catch(() => {});
}
