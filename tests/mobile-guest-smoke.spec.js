import { test, expect } from '@playwright/test';

test('mobile guest editor is usable', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();
  const email = `guest-mobile-${stamp}@example.com`;
  const password = `Test-${stamp}-Mb9!`;

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const api = context.request;

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: { name: 'Mobile Guest Test', email, password },
  });
  expect([200, 201]).toContain(signUp.status());

  const createBook = await api.post(`${base}/api/my/books`, {
    data: { title: `Mobile Guest ${stamp}` },
  });
  expect(createBook.status()).toBe(201);
  const bookId = (await createBook.json()).book.id;

  const pagesResponse = await api.get(`${base}/api/my/books/${bookId}/pages`);
  expect(pagesResponse.ok()).toBeTruthy();
  const firstPage = (await pagesResponse.json()).pages[0];

  const inviteResponse = await api.post(
    `${base}/api/my/books/${bookId}/pages/${firstPage.id}/invite`
  );
  expect(inviteResponse.ok()).toBeTruthy();
  const inviteToken = (await inviteResponse.json()).inviteToken;

  await page.goto(`${base}/p/${inviteToken}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('A te oldalad: 1. oldal')).toBeVisible();

  const frame = page.getByTestId('memorybook-canvas-frame');
  const frameBox = await frame.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(frameBox.width).toBeLessThanOrEqual(366.5);
  expect(Math.abs(frameBox.height / frameBox.width - 4 / 3)).toBeLessThan(0.03);

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

  for (const label of ['+ Szöveg', 'Szabadkézi rajz', 'Radír']) {
    const box = await page.getByRole('button', { name: label }).boundingBox();
    expect(box).not.toBeNull();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const photoBox = await page.getByText('+ Fotó', { exact: true }).boundingBox();
  expect(photoBox).not.toBeNull();
  expect(photoBox.height).toBeGreaterThanOrEqual(44);

  const submitButton = page.getByRole('button', { name: 'Oldal beküldése' });
  const submitBox = await submitButton.boundingBox();
  expect(submitBox).not.toBeNull();
  expect(submitBox.height).toBeGreaterThanOrEqual(48);

  await page.getByRole('button', { name: '+ Szöveg' }).click();
  await expect(page.getByText('Nem mentett')).toBeVisible();
  await expect(page.getByText('✓ Mentve')).toBeVisible({ timeout: 10000 });

  const afterSave = await api.get(`${base}/api/page-invites/${inviteToken}`);
  expect(afterSave.ok()).toBeTruthy();
  const saved = await afterSave.json();
  expect(saved.canvasData.objects.length).toBeGreaterThanOrEqual(1);

  page.on('dialog', (dialog) => dialog.accept());
  await submitButton.click();
  await expect(page.getByText('Az oldalad elküldve. Köszönjük!')).toBeVisible({ timeout: 10000 });

  console.log('PASS: responsive 3:4 guest canvas');
  console.log('PASS: no horizontal overflow at 390x844');
  console.log('PASS: editor controls >= 44px and submit >= 48px');
  console.log('PASS: add-text autosaves through live API');
  console.log('PASS: browser submit closes guest page');

  await context.close();
});
