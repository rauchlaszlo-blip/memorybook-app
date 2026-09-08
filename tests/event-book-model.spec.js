import { test, expect } from '@playwright/test';

test('standard and event book models work on mobile', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ownerPage = await ownerContext.newPage();
  const api = ownerContext.request;

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: { name: 'Book Model Owner', email: `book-model-${stamp}@example.com`, password: `BookModel-${stamp}-9!` },
  });
  expect([200, 201]).toContain(signUp.status());

  const standardResponse = await api.post(`${base}/api/my/books`, { data: { title: `Normál könyv ${stamp}`, bookType: 'standard' } });
  expect(standardResponse.status()).toBe(201);
  const standardBook = (await standardResponse.json()).book;
  expect(standardBook.bookType).toBe('standard');
  expect(standardBook.pageCount).toBe(30);

  const eventResponse = await api.post(`${base}/api/my/books`, { data: { title: `Rendezvény könyv ${stamp}`, bookType: 'event' } });
  expect(eventResponse.status()).toBe(201);
  const eventBook = (await eventResponse.json()).book;
  expect(eventBook.bookType).toBe('event');
  expect(eventBook.pageCount).toBe(0);

  await ownerPage.goto(`${base}/my-books/${standardBook.id}`, { waitUntil: 'networkidle' });
  await expect(ownerPage.getByText('Oldal 1', { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: 'QR-kód megnyitása' })).toHaveCount(0);

  await ownerPage.goto(`${base}/my-books/${eventBook.id}`, { waitUntil: 'networkidle' });
  await expect(ownerPage.getByText('Rendezvény vendégkönyv', { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: 'QR-kód megnyitása' })).toBeVisible();
  await expect(ownerPage.getByRole('link', { name: 'Beérkezett bejegyzések' })).toBeVisible();
  await expect(ownerPage.getByText('Oldal 1', { exact: true })).toHaveCount(0);
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  const ownerData = await (await api.get(`${base}/api/my/books/${eventBook.id}/pages`)).json();
  const token = ownerData.book.eventInviteToken;
  expect(ownerData.book.bookType).toBe('event');
  expect(ownerData.pages).toHaveLength(0);
  expect(token).toBeTruthy();

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guestPage = await guestContext.newPage();

  async function submitGuest(name, text) {
    await guestPage.goto(`${base}/join/${token}`, { waitUntil: 'networkidle' });
    await guestPage.getByLabel('Neved').fill(name);
    await guestPage.getByLabel('Üzeneted').fill(text);
    await guestPage.getByRole('button', { name: 'Bejegyzés elküldése' }).click();
    await expect(guestPage.getByRole('heading', { name: `Köszönjük, ${name}!` })).toBeVisible();
  }

  await submitGuest('Anna', 'Első bejegyzés ugyanerről a telefonról.');
  await submitGuest('Anna', 'Második bejegyzés ugyanerről a telefonról.');
  expect(await guestPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await ownerPage.goto(`${base}/organizer/${eventBook.id}/contributions`, { waitUntil: 'networkidle' });
  await expect(ownerPage.getByRole('button', { name: 'Új (2)' })).toBeVisible();
  const cards = ownerPage.locator('article');
  await expect(cards).toHaveCount(2);

  const firstCard = cards.nth(0);
  const secondCard = cards.nth(1);
  const firstText = await firstCard.innerText();
  const secondText = await secondCard.innerText();

  await firstCard.getByRole('button', { name: 'Megtartom' }).click();
  await ownerPage.getByRole('button', { name: 'Új (1)' }).waitFor();
  await secondCard.getByRole('button', { name: 'Elutasítom' }).click().catch(async () => {
    const remaining = ownerPage.locator('article').first();
    await remaining.getByRole('button', { name: 'Elutasítom' }).click();
  });

  await ownerPage.getByRole('button', { name: 'Megtartott (1)' }).waitFor();
  await ownerPage.getByRole('button', { name: 'Elutasított (1)' }).waitFor();

  const saved = (await (await api.get(`${base}/api/books/${eventBook.id}/contributions`)).json()).contributions;
  expect(saved).toHaveLength(2);
  expect(saved.filter((x) => x.ownerStatus === 'kept')).toHaveLength(1);
  expect(saved.filter((x) => x.ownerStatus === 'rejected')).toHaveLength(1);
  expect(saved.every((x) => x.contributorName === 'Anna')).toBeTruthy();

  console.log('PASS: one owner can create standard and event books');
  console.log('PASS: standard book starts with 30 pages and has no event QR');
  console.log('PASS: event book starts without fixed pages and has shared QR entry');
  console.log('PASS: same mobile device can submit multiple event entries');
  console.log('PASS: owner can keep or reject each entry independently');

  await guestContext.close();
  await ownerContext.close();
});
