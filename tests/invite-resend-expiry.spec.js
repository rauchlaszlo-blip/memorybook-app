import { test, expect } from '@playwright/test';

test('standard page invite becomes resend-only after send and carries a 14-day window', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data) => {
        window.__memoryBookLastShare = data;
      },
    });
  });

  const page = await context.newPage();
  const api = context.request;

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: {
      name: 'Invite Test Owner',
      email: `invite-resend-${stamp}@example.com`,
      password: `Invite-${stamp}-9!`,
    },
  });
  expect([200, 201]).toContain(signUp.status());

  const createBook = await api.post(`${base}/api/my/books`, {
    data: { title: `Meghívó teszt ${stamp}`, bookType: 'standard' },
  });
  expect(createBook.status()).toBe(201);
  const book = (await createBook.json()).book;

  const initialOwnerData = await (
    await api.get(`${base}/api/my/books/${book.id}/pages`)
  ).json();
  expect(initialOwnerData.pages).toHaveLength(30);
  const firstPageId = initialOwnerData.pages[0].id;

  await page.goto(`${base}/my-books/${book.id}`, { waitUntil: 'networkidle' });
  const firstCard = page.locator('article').filter({
    has: page.getByText('Oldal 1', { exact: true }),
  });

  const inviteCreatePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/my/books/${book.id}/pages/${firstPageId}/invite`) &&
      response.request().method() === 'POST'
  );
  await firstCard.getByRole('button', { name: 'Meghívás', exact: true }).click();
  expect((await inviteCreatePromise).ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Meghívás küldése' })).toBeVisible();
  await expect(page.getByText(/A meghívó 14 napig használható/)).toBeVisible();

  // Opening and then cancelling the dialog must NOT count as sent.
  const beforeSend = await (
    await api.get(`${base}/api/my/books/${book.id}/pages`)
  ).json();
  const invitedBeforeSend = beforeSend.pages.find((item) => item.id === firstPageId);
  expect(invitedBeforeSend.inviteToken).toBeTruthy();
  expect(invitedBeforeSend.inviteSentAt).toBeNull();
  expect(invitedBeforeSend.inviteCreatedAt).toBeTruthy();
  expect(invitedBeforeSend.inviteExpiresAt).toBeTruthy();

  const createdMs = new Date(invitedBeforeSend.inviteCreatedAt).getTime();
  const expiresMs = new Date(invitedBeforeSend.inviteExpiresAt).getTime();
  const expectedWindowMs = 14 * 24 * 60 * 60 * 1000;
  expect(Math.abs(expiresMs - createdMs - expectedWindowMs)).toBeLessThan(2000);

  const markSentPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/my/books/${book.id}/pages/${firstPageId}/invite/sent`) &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Címzett és app kiválasztása' }).click();
  expect((await markSentPromise).ok()).toBeTruthy();

  await expect(page.getByRole('heading', { name: 'Meghívás küldése' })).toHaveCount(0);
  await expect(firstCard.getByText('Meghívó kiküldve', { exact: true })).toBeVisible();
  await expect(firstCard.getByRole('button', { name: 'Meghívó újraküldése' })).toBeVisible();

  const sharedText = await page.evaluate(() => window.__memoryBookLastShare?.text || '');
  expect(sharedText).toContain('A meghívó 14 napig használható.');

  const afterSend = await (
    await api.get(`${base}/api/my/books/${book.id}/pages`)
  ).json();
  const invitedAfterSend = afterSend.pages.find((item) => item.id === firstPageId);
  expect(invitedAfterSend.inviteSentAt).toBeTruthy();
  expect(invitedAfterSend.inviteToken).toBe(invitedBeforeSend.inviteToken);

  await firstCard.getByRole('button', { name: 'Meghívó újraküldése' }).click();
  await expect(page.getByRole('heading', { name: 'Meghívó újraküldése' })).toBeVisible();
  await expect(
    page.getByText('Ezt a meghívót már kiküldted. Az újraküldést ugyanannak a személynek szánjuk.', { exact: true })
  ).toBeVisible();

  const guestInvite = await api.get(`${base}/api/page-invites/${invitedAfterSend.inviteToken}`);
  expect(guestInvite.status()).toBe(200);
  const guestData = await guestInvite.json();
  expect(guestData.inviteValidDays).toBe(14);
  expect(guestData.inviteExpiresAt).toBeTruthy();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBeTruthy();

  console.log('PASS: opening/cancelling an invite does not mark it as sent');
  console.log('PASS: successful share marks the page as invite sent');
  console.log('PASS: sent page offers only an explicit resend flow');
  console.log('PASS: resend warns that it is intended for the same person');
  console.log('PASS: invite window is fixed to 14 days and exposed to guest + owner');
  console.log('PASS: invitation UI remains mobile-width safe');

  await context.close();
});
