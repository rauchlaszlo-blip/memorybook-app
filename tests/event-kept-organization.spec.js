import { test, expect } from '@playwright/test';

test('kept event contributions can be organized independently on mobile', async ({ browser }) => {
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
      name: 'Organization Owner',
      email: `organization-${stamp}@example.com`,
      password: `Organization-${stamp}-9!`,
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

  const eventBookA = await createEventBook(`Rendezés A ${stamp}`);
  const eventBookB = await createEventBook(`Rendezés B ${stamp}`);

  const ownerData = await (
    await api.get(`${base}/api/my/books/${eventBookA.id}/pages`)
  ).json();
  const token = ownerData.book.eventInviteToken;
  expect(token).toBeTruthy();

  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const guestPage = await guestContext.newPage();

  async function submitGuest(name, text) {
    await guestPage.goto(`${base}/join/${token}`, { waitUntil: 'networkidle' });
    await guestPage.getByLabel('Neved').fill(name);
    await guestPage.getByLabel('Üzeneted').fill(text);
    await guestPage.getByRole('button', { name: 'Bejegyzés elküldése' }).click();
    await expect(
      guestPage.getByRole('heading', { name: `Köszönjük, ${name}!` })
    ).toBeVisible();
  }

  await submitGuest('Anna', 'Első megtartott bejegyzés.');
  await submitGuest('Béla', 'Második megtartott bejegyzés.');
  await submitGuest('Csilla', 'Harmadik megtartott bejegyzés.');

  const initial = (
    await (
      await api.get(`${base}/api/books/${eventBookA.id}/contributions`)
    ).json()
  ).contributions;
  expect(initial).toHaveLength(3);

  for (const contribution of initial) {
    const keepResponse = await api.patch(
      `${base}/api/my/books/${eventBookA.id}/contributions/${contribution.id}`,
      { data: { ownerStatus: 'kept' } }
    );
    expect(keepResponse.status()).toBe(200);
  }

  const keptBeforeReorder = (
    await (
      await api.get(`${base}/api/books/${eventBookA.id}/contributions`)
    ).json()
  ).contributions
    .filter((item) => item.ownerStatus === 'kept')
    .sort((a, b) => a.ownerOrder - b.ownerOrder);
  expect(keptBeforeReorder).toHaveLength(3);
  const targetText = keptBeforeReorder[keptBeforeReorder.length - 1].memoryText;

  await ownerPage.goto(
    `${base}/organizer/${eventBookA.id}/contributions`,
    { waitUntil: 'networkidle' }
  );
  await ownerPage.getByRole('button', { name: 'Megtartott (3)' }).click();
  await expect(
    ownerPage.getByText('Megtartott bejegyzések rendezése', { exact: true })
  ).toBeVisible();
  await expect(
    ownerPage.getByText('AI-rendszerezési javaslat – később', { exact: true })
  ).toBeVisible();

  expect(
    await ownerPage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBeTruthy();

  const firstCard = ownerPage
    .locator('article')
    .filter({ hasText: 'Első megtartott bejegyzés.' });
  const firstGroup = firstCard.getByLabel('Csoport / tematika');
  await firstGroup.fill('Család');
  const groupSavePromise = ownerPage.waitForResponse(
    (response) =>
      response.url().includes('/group') && response.request().method() === 'PATCH'
  );
  await firstCard.getByRole('button', { name: 'Tematika mentése' }).click();
  expect((await groupSavePromise).ok()).toBeTruthy();

  for (let move = 0; move < 2; move += 1) {
    const targetCard = ownerPage.locator('article').filter({ hasText: targetText });
    const upButton = targetCard.getByRole('button', { name: 'Bejegyzés feljebb' });
    await expect(upButton).toBeEnabled();
    const reorderPromise = ownerPage.waitForResponse(
      (response) =>
        response.url().includes('/contributions/reorder') &&
        response.request().method() === 'PUT'
    );
    await upButton.click();
    expect((await reorderPromise).ok()).toBeTruthy();
  }

  await ownerPage.reload({ waitUntil: 'networkidle' });
  await ownerPage.getByRole('button', { name: 'Megtartott (3)' }).click();

  const cardsAfterReload = ownerPage.locator('article');
  await expect(cardsAfterReload).toHaveCount(3);
  await expect(cardsAfterReload.nth(0)).toContainText(targetText);

  const firstOriginalAfterReload = ownerPage
    .locator('article')
    .filter({ hasText: 'Első megtartott bejegyzés.' });
  await expect(firstOriginalAfterReload.getByLabel('Csoport / tematika')).toHaveValue(
    'Család'
  );

  const persisted = (
    await (
      await api.get(`${base}/api/books/${eventBookA.id}/contributions`)
    ).json()
  ).contributions;
  const ordered = persisted
    .filter((item) => item.ownerStatus === 'kept')
    .sort((a, b) => a.ownerOrder - b.ownerOrder);
  expect(ordered).toHaveLength(3);
  expect(ordered[0].memoryText).toBe(targetText);
  expect(
    persisted.find((item) => item.memoryText === 'Első megtartott bejegyzés.')
      .ownerGroup
  ).toBe('Család');

  const otherBookContributions = (
    await (
      await api.get(`${base}/api/books/${eventBookB.id}/contributions`)
    ).json()
  ).contributions;
  expect(otherBookContributions).toHaveLength(0);

  console.log('PASS: kept entries can be assigned a manual theme');
  console.log('PASS: kept entries can be reordered on mobile');
  console.log('PASS: theme and order persist after reload');
  console.log('PASS: organization in one event book does not affect another book');
  console.log('PASS: AI organization is clearly marked as a future suggestion-only feature');

  await guestContext.close();
  await ownerContext.close();
});
