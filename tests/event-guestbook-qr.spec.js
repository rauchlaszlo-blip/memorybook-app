import { test, expect } from '@playwright/test';

test('event guestbook QR flow works on mobile', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ownerPage = await ownerContext.newPage();
  const api = ownerContext.request;

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: { name: 'Event QR Owner', email: `event-qr-${stamp}@example.com`, password: `QrTest-${stamp}-9!` },
  });
  expect([200, 201]).toContain(signUp.status());

  const createBook = await api.post(`${base}/api/my/books`, { data: { title: `Rendezvény vendégkönyv ${stamp}` } });
  expect(createBook.status()).toBe(201);
  const book = (await createBook.json()).book;

  const ownerDataResponse = await api.get(`${base}/api/my/books/${book.id}/pages`);
  expect(ownerDataResponse.ok()).toBeTruthy();
  const ownerData = await ownerDataResponse.json();
  const token = ownerData.book.eventInviteToken;
  expect(token).toBeTruthy();

  await ownerPage.goto(`${base}/my-books/${book.id}`, { waitUntil: 'networkidle' });
  await expect(ownerPage.getByText('Rendezvény vendégkönyv', { exact: true })).toBeVisible();
  const qrOpen = ownerPage.getByRole('link', { name: 'QR-kód megnyitása' });
  await expect(qrOpen).toBeVisible();
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await qrOpen.click();
  await ownerPage.waitForLoadState('networkidle');
  const qrImage = ownerPage.getByRole('img', { name: 'Rendezvény vendégkönyv QR-kód' });
  await expect(qrImage).toBeVisible();
  expect(await qrImage.getAttribute('src')).toMatch(/^data:image\/png;base64,/);

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guestPage = await guestContext.newPage();
  await guestPage.goto(`${base}/join/${token}`, { waitUntil: 'networkidle' });
  await expect(guestPage.getByLabel('Neved')).toBeVisible();
  await expect(guestPage.getByLabel('Üzeneted')).toBeVisible();
  expect(await guestPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await guestPage.getByLabel('Neved').fill('Anna');
  await guestPage.getByLabel('Üzeneted').fill('Sok boldogságot!');
  await guestPage.getByRole('button', { name: 'Bejegyzés elküldése' }).click();
  await expect(guestPage.getByRole('heading', { name: 'Köszönjük, Anna!' })).toBeVisible();

  const savedResponse = await api.get(`${base}/api/books/${book.id}/contributions`);
  expect(savedResponse.ok()).toBeTruthy();
  const saved = (await savedResponse.json()).contributions;
  expect(saved.some((item) => item.contributorName === 'Anna' && item.memoryText === 'Sok boldogságot!')).toBeTruthy();

  console.log('PASS: event QR page renders');
  console.log('PASS: shared join token opens guestbook');
  console.log('PASS: guest contribution is saved and visible to owner');
  console.log('PASS: mobile owner and guest pages do not overflow');

  await guestContext.close();
  await ownerContext.close();
});
