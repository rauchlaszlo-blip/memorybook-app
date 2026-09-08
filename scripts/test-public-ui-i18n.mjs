import { chromium } from 'playwright';

const base = 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE' });
await context.addInitScript(() => localStorage.setItem('memorybook.appLanguage', 'de'));
const page = await context.newPage();

await page.route('**/api/auth-capabilities', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ google: false }) }));
await page.route('**/api/me', async route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'UNAUTHENTICATED' }) }));
await page.route('**/api/gift-entitlements/test-token', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bookType: 'standard', includedPages: 30, claimStatus: 'available' }) }));
await page.route('**/api/public-pages/test-token', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bookTitle: 'Testbuch', id: 'page-1', pageNumber: 7, previewImageUrl: null }) }));
await page.route('**/api/invites/test-token', async route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bookId: 'event-1', title: 'Sommerfest', deviceLimit: 5, identityMode: 'none' }) }));

async function assertNoOverflow(label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) throw new Error(`${label}: horizontal overflow`);
}

async function visit(path, expected, label) {
  await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
  await page.getByText(expected, { exact: false }).first().waitFor({ state: 'visible' });
  const switcher = page.locator('select[aria-label="Anwendungssprache"]');
  if (await switcher.count() === 0) throw new Error(`${label}: German language switcher missing`);
  await assertNoOverflow(label);
}

await visit('/login', 'Anmelden oder registrieren', 'login');
await visit('/purchase', 'Erinnerungsbuch kaufen', 'purchase');
await visit('/gift/test-token', 'Geschenk-Erinnerungsbuch', 'gift');
await visit('/nekem-is-kell', 'Ich möchte auch ein Erinnerungsbuch', 'cta');

await page.locator('select[aria-label="Anwendungssprache"]').selectOption('en');
await page.getByText('I want a memory book too', { exact: false }).waitFor({ state: 'visible' });
await page.locator('select[aria-label="Application language"]').selectOption('de');
await page.getByText('Ich möchte auch ein Erinnerungsbuch', { exact: false }).waitFor({ state: 'visible' });

await visit('/share/test-token', 'Öffentlich geteilte Seite · Seite 7', 'public page');
await visit('/join/test-token', 'Schreibe eine Nachricht oder Erinnerung', 'event guest entry');

console.log('PUBLIC_UI_I18N_MOBILE_PASS');
await browser.close();
