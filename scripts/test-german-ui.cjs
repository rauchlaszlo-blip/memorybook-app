const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'de-DE',
  });
  const page = await context.newPage();

  await page.route('http://127.0.0.1:3001/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const cors = {
      'access-control-allow-origin': 'http://127.0.0.1:4173',
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      'access-control-allow-headers': 'content-type',
    };

    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: cors, body: '' });
    }

    const json = (body, status = 200) =>
      route.fulfill({
        status,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    if (path === '/api/me') {
      return json({ user: { id: 'u1', name: 'Deutsch Owner', email: 'owner@example.test' } });
    }
    if (path === '/api/my/books') {
      return json({
        books: [
          {
            id: 'book-de',
            title: 'Deutsches Buch',
            bookType: 'standard',
            language: 'de',
            pageCount: 1,
            contributionCount: 0,
            createdAt: '2026-09-08T20:00:00Z',
          },
        ],
      });
    }
    if (path === '/api/my/entitlements') return json({ entitlements: [] });
    if (path === '/api/my/notifications/unread-count') return json({ unreadCount: 0 });
    if (path === '/api/my/books/book-de/pages') {
      return json({
        book: {
          id: 'book-de',
          title: 'Deutsches Buch',
          bookType: 'standard',
          language: 'de',
          eventInviteToken: null,
        },
        pages: [
          {
            id: 'page-de',
            pageNumber: 7,
            version: 1,
            inviteStatus: 'invited',
            inviteToken: 'token-de',
            inviteCreatedAt: '2026-09-08T20:00:00Z',
            inviteExpiresAt: '2026-09-22T20:00:00Z',
            inviteSentAt: null,
            inviteRecipientName: null,
            inviteRecipientEmail: null,
            inviteDeliveryMethod: null,
            inviteLanguage: null,
            ownerVisibility: 'active',
            authorShareApproved: false,
            ownerShareApproved: false,
          },
        ],
      });
    }
    if (path === '/api/page-invites/token-de' && req.method() === 'GET') {
      return json({
        id: 'page-de',
        bookId: 'book-de',
        bookTitle: 'Deutsches Buch',
        pageNumber: 7,
        version: 1,
        inviteStatus: 'invited',
        language: 'de',
        canvasData: {},
        previewImageUrl: null,
      });
    }

    return json({ error: 'UNEXPECTED_TEST_REQUEST', path, method: req.method() }, 500);
  });

  try {
    await page.goto('http://127.0.0.1:4173/my-books');
    await page.waitForLoadState('networkidle');

    const appLanguage = page.getByRole('combobox', { name: 'Anwendungssprache' });
    await appLanguage.waitFor({ state: 'visible' });
    if ((await appLanguage.inputValue()) !== 'de') {
      throw new Error('German browser locale was not detected');
    }
    const deOption = appLanguage.locator('option[value="de"]');
    if ((await deOption.textContent()) !== 'Deutsch') {
      throw new Error('Deutsch option missing from app language switcher');
    }

    await page.goto('http://127.0.0.1:4173/my-books/book-de');
    await page.waitForLoadState('networkidle');

    const bookLanguage = page.getByRole('combobox', { name: 'Könyv nyelve' });
    await bookLanguage.waitFor({ state: 'visible' });
    if ((await bookLanguage.inputValue()) !== 'de') {
      throw new Error('German book language was not loaded');
    }

    await page.getByRole('button', { name: 'Meghívás folytatása' }).click();
    const inviteLanguage = page.getByRole('combobox', { name: 'Meghívó nyelve' });
    await inviteLanguage.waitFor({ state: 'visible' });
    await inviteLanguage.selectOption('de');

    const message = await page.locator('textarea').inputValue();
    if (!message.includes('Ich habe ein MemoryBook') || !message.includes('Die Einladung ist 14 Tage gültig.')) {
      throw new Error(`German invitation message missing: ${message}`);
    }

    await page.goto('http://127.0.0.1:4173/p/token-de');
    await page.waitForLoadState('networkidle');

    await page.getByText('Deine Seite: Seite 7').waitFor({ state: 'visible' });
    await page.getByText('+ Foto').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Freihand zeichnen' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Seite einreichen' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Jetzt speichern' }).waitFor({ state: 'visible' });

    console.log('GERMAN_UI_MOBILE_PASS');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
