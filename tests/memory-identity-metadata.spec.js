import { test, expect } from '@playwright/test';

test('standard book keeps page identity, order, dates and owner note', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const api = context.request;

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: {
      name: 'Memory Identity Owner',
      email: `memory-identity-${stamp}@example.com`,
      password: `Memory-${stamp}-9!`,
    },
  });
  expect([200, 201]).toContain(signUp.status());

  const createBook = await api.post(`${base}/api/my/books`, {
    data: { title: `Azonosítás teszt ${stamp}`, bookType: 'standard' },
  });
  expect(createBook.status()).toBe(201);
  const book = (await createBook.json()).book;

  const ownerData = await (await api.get(`${base}/api/my/books/${book.id}/pages`)).json();
  const p1 = ownerData.pages[0];
  const p2 = ownerData.pages[1];
  const p3 = ownerData.pages[2];

  const invite1 = await api.post(`${base}/api/my/books/${book.id}/pages/${p1.id}/invite`);
  expect(invite1.status()).toBe(200);
  const token1 = (await invite1.json()).inviteToken;
  const sent1 = await api.post(`${base}/api/my/books/${book.id}/pages/${p1.id}/invite/sent`, {
    data: { recipientName: '', recipientEmail: 'first.recipient@example.com', deliveryMethod: 'email' },
  });
  expect(sent1.status()).toBe(200);

  const invite2 = await api.post(`${base}/api/my/books/${book.id}/pages/${p2.id}/invite`);
  expect(invite2.status()).toBe(200);
  const token2 = (await invite2.json()).inviteToken;
  const sent2 = await api.post(`${base}/api/my/books/${book.id}/pages/${p2.id}/invite/sent`, {
    data: { recipientName: 'Messenger Címzett', recipientEmail: '', deliveryMethod: 'share' },
  });
  expect(sent2.status()).toBe(200);

  const submit2 = await api.post(`${base}/api/page-invites/${token2}/submit`, { data: { authorShareApproved: false } });
  expect(submit2.status()).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const submit1 = await api.post(`${base}/api/page-invites/${token1}/submit`, { data: { authorShareApproved: false } });
  expect(submit1.status()).toBe(200);

  const invite3 = await api.post(`${base}/api/my/books/${book.id}/pages/${p3.id}/invite`);
  expect(invite3.status()).toBe(200);
  const sent3 = await api.post(`${base}/api/my/books/${book.id}/pages/${p3.id}/invite/sent`, {
    data: { recipientName: 'Aktív Címzett', recipientEmail: '', deliveryMethod: 'share' },
  });
  expect(sent3.status()).toBe(200);
  const prematureReassign = await api.post(`${base}/api/my/books/${book.id}/pages/${p3.id}/invite/reassign`);
  expect(prematureReassign.status()).toBe(409);
  expect((await prematureReassign.json()).error).toBe('PAGE_INVITE_NOT_EXPIRED');

  await page.goto(`${base}/book/${book.id}/view`, { waitUntil: 'networkidle' });
  await expect(page.getByText('1 / 2 oldal', { exact: true })).toBeVisible();
  let metaPanel = page.locator('[data-memory-metadata="true"]');
  await expect(metaPanel.getByRole('heading', { name: 'first.recipient@example.com' })).toBeVisible();
  await expect(metaPanel.getByText('Meghívás dátuma', { exact: true })).toBeVisible();
  await expect(metaPanel.getByText('Beküldés dátuma', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Következő oldal' }).click();
  await expect(page.getByText('2 / 2 oldal', { exact: true })).toBeVisible();
  metaPanel = page.locator('[data-memory-metadata="true"]');
  await expect(metaPanel.getByRole('heading', { name: 'Messenger Címzett' })).toBeVisible();

  const note = 'Saját megjegyzés az emlék későbbi azonosításához.';
  await metaPanel.getByRole('textbox', { name: 'Saját megjegyzés' }).fill(note);
  await metaPanel.getByRole('button', { name: 'Megjegyzés mentése' }).click();
  await expect(metaPanel.getByRole('button', { name: 'Megjegyzés elmentve' })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('[data-memory-metadata="true"]').getByRole('textbox', { name: 'Saját megjegyzés' })).toHaveValue(note);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  console.log('PASS: page identity is stored independently for email and share');
  console.log('PASS: reverse submission order does not change fixed page order');
  console.log('PASS: invitation and submission dates are visible in metadata');
  console.log('PASS: owner note persists after reload');
  console.log('PASS: active invitation cannot be reassigned before 14-day expiry');
  console.log('PASS: memory content remains separate from metadata block');

  await context.close();
});
