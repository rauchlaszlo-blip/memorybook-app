import { test, expect } from '@playwright/test';

test('event device limits are per book and persist on mobile', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();

  const ownerContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const ownerPage = await ownerContext.newPage();
  const api = ownerContext.request;

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: {
      name: 'Device Limit Owner',
      email: `device-limit-${stamp}@example.com`,
      password: `DeviceLimit-${stamp}-9!`,
    },
  });
  expect([200, 201]).toContain(signUp.status());

  async function createEventBook(title) {
    const response = await api.post(`${base}/api/my/books`, {
      data: { title, bookType: 'event' },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).book;
  }

  const bookA = await createEventBook(`Limit 2 ${stamp}`);
  const bookB = await createEventBook(`Limit 1 ${stamp}`);

  await ownerPage.goto(`${base}/my-books/${bookA.id}`, { waitUntil: 'networkidle' });
  await expect(ownerPage.getByText('Hány bejegyzés jöhet egy telefonról?', { exact: true })).toBeVisible();
  const limitInput = ownerPage.getByLabel('Bejegyzések száma egy eszközről');
  await expect(limitInput).toHaveValue('1');
  await limitInput.fill('2');
  await ownerPage.getByRole('button', { name: 'Beállítás mentése' }).click();
  await expect(ownerPage.getByText('Beállítás mentve.', { exact: true })).toBeVisible();
  expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await ownerPage.reload({ waitUntil: 'networkidle' });
  await expect(ownerPage.getByLabel('Bejegyzések száma egy eszközről')).toHaveValue('2');

  const settingsA = await api.get(`${base}/api/my/books/${bookA.id}/event-settings`);
  expect(settingsA.status()).toBe(200);
  expect((await settingsA.json()).deviceLimit).toBe(2);

  const settingsB = await api.get(`${base}/api/my/books/${bookB.id}/event-settings`);
  expect(settingsB.status()).toBe(200);
  expect((await settingsB.json()).deviceLimit).toBe(1);

  const dataA = await (await api.get(`${base}/api/my/books/${bookA.id}/pages`)).json();
  const dataB = await (await api.get(`${base}/api/my/books/${bookB.id}/pages`)).json();
  const tokenA = dataA.book.eventInviteToken;
  const tokenB = dataB.book.eventInviteToken;
  expect(tokenA).toBeTruthy();
  expect(tokenB).toBeTruthy();

  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const guestPage = await guestContext.newPage();

  async function fillAndSubmit(name, text) {
    await guestPage.getByLabel('Neved').fill(name);
    await guestPage.getByLabel('Üzeneted').fill(text);
    await guestPage.getByRole('button', { name: 'Bejegyzés elküldése' }).click();
  }

  await guestPage.goto(`${base}/join/${tokenA}`, { waitUntil: 'networkidle' });
  await expect(guestPage.getByText(/legfeljebb\s+2\s+bejegyzés/)).toBeVisible();
  await fillAndSubmit('Anna', 'Első üzenet ugyanerről a telefonról.');
  await expect(guestPage.getByText('Erről az eszközről még 1 bejegyzést küldhetsz.', { exact: true })).toBeVisible();
  await guestPage.getByRole('button', { name: 'Újabb bejegyzés' }).click();

  await fillAndSubmit('Anna', 'Második üzenet ugyanerről a telefonról.');
  await expect(guestPage.getByText(/elérted a rendezvényhez engedélyezett bejegyzésszámot/)).toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Újabb bejegyzés' })).toHaveCount(0);

  await guestPage.goto(`${base}/join/${tokenA}`, { waitUntil: 'networkidle' });
  await fillAndSubmit('Anna', 'Harmadik próbálkozás ugyanerről a telefonról.');
  await expect(guestPage.getByText('Erről az eszközről már elküldted az engedélyezett számú bejegyzést.', { exact: true })).toBeVisible();
  await expect(guestPage.getByRole('heading', { name: 'Köszönjük, Anna!' })).toHaveCount(0);

  await guestPage.goto(`${base}/join/${tokenB}`, { waitUntil: 'networkidle' });
  await expect(guestPage.getByText(/legfeljebb\s+1\s+bejegyzés/)).toBeVisible();
  await fillAndSubmit('Anna', 'Másik rendezvénykönyv első üzenete.');
  await expect(guestPage.getByRole('heading', { name: 'Köszönjük, Anna!' })).toBeVisible();

  const contributionsA = (await (await api.get(`${base}/api/books/${bookA.id}/contributions`)).json()).contributions;
  const contributionsB = (await (await api.get(`${base}/api/books/${bookB.id}/contributions`)).json()).contributions;
  expect(contributionsA).toHaveLength(2);
  expect(contributionsB).toHaveLength(1);

  console.log('PASS: owner can set a per-book device submission limit on mobile');
  console.log('PASS: device limit persists after reload');
  console.log('PASS: same device can submit up to the configured limit');
  console.log('PASS: additional submissions are blocked after the limit');
  console.log('PASS: the same device gets an independent allowance in another event book');

  await guestContext.close();
  await ownerContext.close();
});
