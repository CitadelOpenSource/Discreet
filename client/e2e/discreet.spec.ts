import { test, expect, type Page } from '@playwright/test';

const TEST_USER = 'John1';
const TEST_PASS = process.env.TEST_PASSWORD || 'changeme';

test.describe('Authentication', () => {
  test('login page renders without crash', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="auth-screen"]')).toBeVisible({ timeout: 10000 });
  });

  test('wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[autocomplete="username"]', TEST_USER);
    await page.fill('input[autocomplete="current-password"]', 'WrongPassword123!');
    await page.getByTestId('login-form').getByRole('button', { name: 'Log In' }).click();
    await page.waitForTimeout(3000);
    const errorVisible = await page.getByText(/invalid|incorrect|wrong|failed/i).isVisible();
    const stillOnAuth = await page.locator('[data-testid="auth-screen"]').isVisible();
    expect(errorVisible || stillOnAuth).toBeTruthy();
  });

  test('reserved username blocked', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create Account' }).first().click();
    await page.waitForTimeout(1000);
    await page.fill('input[autocomplete="username"]', 'admin');
    await page.fill('input[autocomplete="email"]', 'test@example.com');
    await page.fill('input[autocomplete="new-password"]', 'StrongP@ss123!');
    await page.getByTestId('register-form').getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText(/reserved|taken|unavailable/i)).toBeVisible({ timeout: 5000 });
  });

  test('successful login reaches app', async ({ page }) => {
    await login(page);
    await expect(page.locator('[data-testid="home-page"]')).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Core App', () => {
  test.beforeEach(async ({ page }) => { await login(page); });

  test('home page loads', async ({ page }) => {
    await expect(page.getByText(/create server/i)).toBeVisible({ timeout: 10000 });
  });

  test('no crash on home', async ({ page }) => {
    await page.waitForTimeout(3000);
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });

  test('settings opens without crash', async ({ page }) => {
    await page.waitForTimeout(2000);
    const btn = page.locator('[aria-label="Settings"], button:has-text("Settings")').first();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(2000);
      await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    }
  });

  test('profile does not crash', async ({ page }) => {
    await page.waitForTimeout(2000);
    const btn = page.locator('[aria-label="Settings"], button:has-text("Settings")').first();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(1500);
      const tab = page.getByText(/profile/i).first();
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(2000);
        await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
      }
    }
  });

  test('discover does not spam API', async ({ page }) => {
    await page.waitForTimeout(2000);
    let calls = 0;
    page.on('request', req => { if (req.url().includes('/discover')) calls++; });
    const btn = page.getByText(/discover/i).first();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(5000);
      expect(calls).toBeLessThan(6);
    }
  });

  test('create server works', async ({ page }) => {
    await page.waitForTimeout(2000);
    await page.getByText(/create server/i).first().click();
    await page.waitForTimeout(1000);
    const input = page.locator('input[placeholder*="server" i], input[name="name"]');
    if (await input.isVisible()) {
      await input.fill('E2E Test ' + Date.now());
      await page.getByRole('button', { name: /create/i }).click();
      await page.waitForTimeout(3000);
      await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
    }
  });

  test('ESC closes modals', async ({ page }) => {
    await page.waitForTimeout(2000);
    const btn = page.locator('[aria-label="Settings"], button:has-text("Settings")').first();
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(1000);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
      await expect(page.locator('[data-testid="settings-modal"]')).not.toBeVisible();
    }
  });

  test('sign out works', async ({ page }) => {
    await page.waitForTimeout(2000);
    const btn = page.getByText(/sign out|log out/i).first();
    if (await btn.isVisible()) {
      page.on('dialog', d => d.accept());
      await btn.click();
      await page.waitForTimeout(3000);
      await expect(page.locator('[data-testid="auth-screen"]')).toBeVisible({ timeout: 10000 });
    }
  });
});

async function login(page: Page) {
  await page.goto('/');
  await page.fill('input[autocomplete="username"]', TEST_USER);
  await page.fill('input[autocomplete="current-password"]', TEST_PASS);
  await page.getByTestId('login-form').getByRole('button', { name: 'Log In' }).click();
  await page.waitForTimeout(5000);
}
