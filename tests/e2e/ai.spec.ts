import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { USERS, loginAs, currencyToNumber, resetData } from './helpers';

test.describe('AI studio and server-side billing', () => {
  test.beforeEach(async ({ request }) => {
    await resetData(request);
  });

  test('a tenant member generates an image, sees it, and is charged the database price', async ({ page }, testInfo) => {
    await loginAs(page, USERS.alice);
    await page.goto('/ai/image?tenant=alpha');
    await expect(page.getByRole('heading', { name: 'AI 出图' })).toBeVisible();
    await expect(page.getByTestId('model-fixture')).toBeVisible();
    await expect(page.getByTestId('ai-unconfigured')).toHaveCount(0);

    const before = currencyToNumber(
      await page.locator('.ai-metrics > div').first().locator('strong').innerText(),
    );
    const prompt = `E2E teal editorial poster ${Date.now()}`;
    await page.getByTestId('ai-prompt').fill(prompt);
    await expect(page.getByTestId('ai-generate')).toBeEnabled();
    await page.getByTestId('ai-generate').click();
    await expect(page.getByTestId('ai-result-image')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ai-result-panel')).toContainText('已完成');

    const after = currencyToNumber(
      await page.locator('.ai-metrics > div').first().locator('strong').innerText(),
    );
    expect(after).toBeCloseTo(before - 5, 2);

    await expect(page.getByTestId('ai-history')).toContainText(prompt);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('ai-download').click();
    const download = await downloadPromise;
    const target = testInfo.outputPath('ai-result.png');
    await download.saveAs(target);
    const bytes = await fs.readFile(target);
    expect(bytes.length).toBeGreaterThan(20);
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  test('a tenant without balance is rejected before a model call', async ({ page }) => {
    await loginAs(page, USERS.bob);
    await page.goto('/ai/image?tenant=beta');
    await expect(page.getByTestId('model-fixture')).toBeVisible();
    await page.getByTestId('ai-prompt').fill('this request must be rejected before provider call');
    await page.getByTestId('ai-generate').click();
    await expect(page.getByText(/额度不足/)).toBeVisible();
    await expect(page.getByTestId('ai-result-image')).toHaveCount(0);
  });
});
