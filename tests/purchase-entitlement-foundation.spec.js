import { test, expect } from '@playwright/test';

test('purchase entitlement foundation blocks unpaid book creation', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const stamp = Date.now();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const api = context.request;

  const selfWithoutAccount = await api.post(`${base}/api/purchases`, {
    data: {
      purchaseMode: 'self',
      bookType: 'standard',
      paymentProvider: 'simplepay',
      purchaserName: 'Test Buyer',
      purchaserEmail: `buyer-${stamp}@example.com`,
      billingName: 'Test Buyer',
      billingEmail: `billing-${stamp}@example.com`,
      billingCountry: 'Magyarország',
      billingPostalCode: '1000',
      billingCity: 'Tesztváros',
      billingAddress: 'Teszt utca 1.',
      billingTaxNumber: '',
    },
  });
  expect(selfWithoutAccount.status()).toBe(401);
  expect((await selfWithoutAccount.json()).error).toBe('ACCOUNT_REQUIRED_FOR_SELF_PURCHASE');

  const giftDraft = await api.post(`${base}/api/purchases`, {
    data: {
      purchaseMode: 'gift',
      bookType: 'standard',
      paymentProvider: 'paypal',
      purchaserName: 'Gift Buyer',
      purchaserEmail: `gift-buyer-${stamp}@example.com`,
      billingName: 'Gift Buyer',
      billingEmail: `gift-billing-${stamp}@example.com`,
      billingCountry: 'Magyarország',
      billingPostalCode: '1000',
      billingCity: 'Tesztváros',
      billingAddress: 'Teszt utca 2.',
      billingTaxNumber: '',
    },
  });
  expect(giftDraft.status()).toBe(201);
  const giftDraftData = await giftDraft.json();
  expect(giftDraftData.purchase.purchaseMode).toBe('gift');
  expect(giftDraftData.purchase.includedPages).toBe(30);
  expect(giftDraftData.purchase.paymentStatus).toBe('draft');
  expect(giftDraftData.paymentReady).toBe(false);

  const signUp = await api.post(`${base}/api/auth/sign-up/email`, {
    headers: { Origin: base },
    data: {
      name: 'Entitlement Test Owner',
      email: `entitlement-owner-${stamp}@example.com`,
      password: `Memory-${stamp}-9!`,
    },
  });
  expect([200, 201]).toContain(signUp.status());

  const entitlements = await api.get(`${base}/api/my/entitlements`);
  expect(entitlements.status()).toBe(200);
  expect((await entitlements.json()).entitlements).toEqual([]);

  const unpaidCreate = await api.post(`${base}/api/my/books`, {
    data: { title: `Nem fizetett könyv ${stamp}` },
  });
  expect(unpaidCreate.status()).toBe(402);
  expect((await unpaidCreate.json()).error).toBe('BOOK_ENTITLEMENT_REQUIRED');

  const selfDraft = await api.post(`${base}/api/purchases`, {
    data: {
      purchaseMode: 'self',
      bookType: 'standard',
      paymentProvider: 'simplepay',
      purchaserName: 'ignored for signed in account',
      purchaserEmail: `ignored-${stamp}@example.com`,
      billingName: 'Entitlement Test Owner',
      billingEmail: `owner-billing-${stamp}@example.com`,
      billingCountry: 'Magyarország',
      billingPostalCode: '1000',
      billingCity: 'Tesztváros',
      billingAddress: 'Teszt utca 3.',
      billingTaxNumber: '',
    },
  });
  expect(selfDraft.status()).toBe(201);
  const selfDraftData = await selfDraft.json();
  expect(selfDraftData.purchase.purchaseMode).toBe('self');
  expect(selfDraftData.purchase.paymentProvider).toBe('simplepay');
  expect(selfDraftData.purchase.paymentStatus).toBe('draft');

  const afterDraftEntitlements = await api.get(`${base}/api/my/entitlements`);
  expect((await afterDraftEntitlements.json()).entitlements).toEqual([]);

  await page.goto(`${base}/my-books`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Új emlékkönyv' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Új könyv vásárlása' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Emlékkönyv létrehozása' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await page.goto(`${base}/purchase?mode=gift`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Emlékkönyv vásárlása' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajándékba' })).toBeVisible();
  await expect(page.getByLabel('Könyv típusa')).toHaveValue('standard');
  await expect(page.getByLabel('Fizetési mód')).toHaveValue('simplepay');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  const missingGift = await api.get(`${base}/api/gift-entitlements/not-a-real-gift-${stamp}`);
  expect(missingGift.status()).toBe(404);

  console.log('PASS: self purchase requires an account');
  console.log('PASS: gift purchase draft can be prepared without an account');
  console.log('PASS: standard entitlement carries 30 included pages');
  console.log('PASS: draft/unpaid purchase creates no entitlement');
  console.log('PASS: book creation without entitlement is blocked with 402');
  console.log('PASS: PayPal and SimplePay are modeled independently of payment execution');
  console.log('PASS: mobile purchase and my-books views have no horizontal overflow');

  await context.close();
});
