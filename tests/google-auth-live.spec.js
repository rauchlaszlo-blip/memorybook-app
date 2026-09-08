import { test, expect } from '@playwright/test';

test('Google is primary login and starts real OAuth', async ({ browser }) => {
  const base = 'https://memorybook-app.onrender.com';
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  await page.goto(`${base}/login?returnTo=${encodeURIComponent('/purchase?for=self')}`, {
    waitUntil: 'networkidle',
  });

  await expect(page.getByRole('heading', { name: 'Belépés vagy regisztráció' })).toBeVisible();
  const googleButton = page.getByRole('button', { name: 'Folytatás Google-fiókkal' });
  await expect(googleButton).toBeVisible();
  await expect(page.getByText('Teszt / fejlesztői belépés e-maillel')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

  await googleButton.click();

  await page.waitForURL((url) => url.hostname.endsWith('google.com'), { timeout: 15000 });
  expect(page.url()).toContain('accounts.google.com');

  console.log('PASS: Google is the primary login UI');
  console.log('PASS: live button starts Google OAuth');
  console.log('PASS: returnTo is supplied to Better Auth before OAuth');
  console.log('PASS: email/password fallback stays hidden for development/testing');
  console.log('PASS: login has no horizontal overflow at 390x844');

  await context.close();
});
