import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  localStorage.setItem('memorybook.appLanguage', 'de');
});
const page = await context.newPage();

const json = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

await page.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const method = request.method();

  if (path === '/api/me') return json(route, { user: { id: 'u1', name: 'László', email: 'laszlo@example.com' } });
  if (path === '/api/my/notifications/unread-count') return json(route, { unreadCount: 2 });
  if (path === '/api/my/notifications') return json(route, {
    unreadCount: 2,
    notifications: [{
      id: 'n1', type: 'standard_page_submitted', bookId: 'std', bookTitle: 'Familienbuch',
      pageId: 'p1', actorName: 'Anna', pageNumber: 7, readAt: null,
      createdAt: new Date().toISOString(), targetPath: '/my-books/std?page=p1'
    }]
  });
  if (path === '/api/my/entitlements') return json(route, {
    entitlements: [{ id: 'e1', bookType: 'standard', includedPages: 30, status: 'available', wasGift: false }]
  });
  if (path === '/api/my/books' && method === 'GET') return json(route, {
    books: [
      { id: 'std', title: 'Familienbuch', bookType: 'standard', language: 'de', pageCount: 2, contributionCount: 0, createdAt: new Date().toISOString() },
      { id: 'event', title: 'Sommerfest', bookType: 'event', language: 'de', pageCount: 0, contributionCount: 2, createdAt: new Date().toISOString() }
    ]
  });

  if (path === '/api/my/books/std/pages' && method === 'GET') return json(route, {
    book: { id: 'std', title: 'Familienbuch', bookType: 'standard', language: 'de' },
    pages: [
      { id: 'p1', pageNumber: 1, version: 2, inviteStatus: 'submitted', ownerVisibility: 'active', inviteRecipientName: 'Anna', submittedAt: '2026-09-08T12:00:00Z', authorShareApproved: true, ownerShareApproved: false },
      { id: 'p2', pageNumber: 2, version: 0, inviteStatus: 'empty', ownerVisibility: 'active' }
    ]
  });
  if (path === '/api/my/books/std/pages/p2/invite' && method === 'POST') return json(route, {
    inviteToken: 'tok-p2', inviteCreatedAt: '2026-09-08T12:00:00Z', inviteExpiresAt: '2026-09-22T12:00:00Z'
  });

  if (path === '/api/my/books/event/pages' && method === 'GET') return json(route, {
    book: { id: 'event', title: 'Sommerfest', bookType: 'event', language: 'de', eventInviteToken: 'event-token' },
    pages: []
  });
  if (path === '/api/my/books/event/event-settings' && method === 'GET') return json(route, { deviceLimit: 5, identityMode: 'none' });

  if (path === '/api/books/event/contributions' && method === 'GET') return json(route, {
    book: { id: 'event', title: 'Sommerfest', bookType: 'event' },
    contributions: [
      { id: 'c1', contributorName: 'Anna', memoryText: 'Ein schöner Abend.', photoUrl: null, ownerStatus: 'pending', ownerGroup: null, ownerOrder: null, createdAt: '2026-09-08T12:00:00Z' },
      { id: 'c2', contributorName: 'Béla', memoryText: 'Danke!', photoUrl: null, ownerStatus: 'kept', ownerGroup: 'Freunde', ownerOrder: 1, createdAt: '2026-09-08T13:00:00Z' }
    ]
  });

  if (path === '/api/pages/p1' && method === 'GET') return json(route, {
    id: 'p1', pageNumber: 1, previewImageUrl: null, version: 2,
    inviteSentAt: '2026-09-01T12:00:00Z', inviteRecipientName: 'Anna', inviteRecipientEmail: 'anna@example.com',
    inviteDeliveryMethod: 'share', submittedAt: '2026-09-08T12:00:00Z', ownerNote: ''
  });

  return json(route, { error: `UNMOCKED ${method} ${path}` }, 404);
});

async function expectText(text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 });
}

async function noHorizontalOverflow(label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (result.scroll > result.width + 1) throw new Error(`${label} horizontal overflow: ${JSON.stringify(result)}`);
}

// Dashboard + reactive language switching + notifications.
await page.goto(`${base}/my-books`);
await expectText('Meine Bücher');
await noHorizontalOverflow('my-books de');
let languageSelect = page.locator('select[aria-label="Anwendungssprache"]');
await languageSelect.selectOption('en');
await expectText('My books');
languageSelect = page.locator('select[aria-label="Application language"]');
await languageSelect.selectOption('hu');
await expectText('Saját könyveim');
languageSelect = page.locator('select[aria-label="Alkalmazás nyelve"]');
await languageSelect.selectOption('de');
await expectText('Meine Bücher');
await page.locator('button[aria-label^="Benachrichtigungen"]').click();
await expectText('Benachrichtigungen');
await expectText('Anna hat Seite 7 eingereicht.');

// Standard owner book and invitation dialog.
await page.goto(`${base}/my-books/std`);
await expectText('Buchsprache');
await expectText('Jede Einladung gehört zu genau einer Seite.');
await expectText('Seite 2');
await noHorizontalOverflow('owner standard de');
await page.getByRole('button', { name: 'Einladen', exact: true }).click();
await expectText('Einladung senden');
await expectText('1. Versandart');
await expectText('2. Sprache der Einladung');
await expectText('3. Personalisierung');
await expectText('Name des Empfängers');
await noHorizontalOverflow('invite dialog de');
await page.getByRole('button', { name: 'Schließen' }).click();

// Event owner settings.
await page.goto(`${base}/my-books/event`);
await expectText('Veranstaltungs-Gästebuch');
await expectText('Wie viele Einträge dürfen von einem Gerät kommen?');
await expectText('Ohne Identifikation');
await noHorizontalOverflow('owner event de');

// Event QR page.
await page.goto(`${base}/my-books/event/event-qr`);
await expectText('Zurück zum Buch');
await expectText('Scanne den QR-Code und schreibe ins Gästebuch!');
await noHorizontalOverflow('qr de');

// Organizer entries.
await page.goto(`${base}/organizer/event/contributions`);
await expectText('Hier entscheidest du, welche Gästebucheinträge du behältst.');
await page.getByRole('button', { name: /Behalten \(1\)/ }).click();
await expectText('Behaltene Einträge ordnen');
await expectText('Gruppe / Thema');
await noHorizontalOverflow('organizer de');

// Read-only book viewer.
await page.goto(`${base}/book/std/view`);
await expectText('Nur-Leseansicht des Buches');
await expectText('Details der Erinnerung');
await expectText('Eigene Notiz');
await noHorizontalOverflow('viewer de');

console.log('OWNER_UI_I18N_MOBILE_PASS');
await browser.close();
