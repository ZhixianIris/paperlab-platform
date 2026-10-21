import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';
import { FIXTURES, USERS, loginAs, resetData } from './helpers';

test.describe('tenant-scoped browser tool visibility', () => {
  test.beforeEach(async ({ request }) => {
    await resetData(request);
  });

  test('tenant tool switch hides its card and prevents use inside that branded workspace', async ({ page }) => {
    await loginAs(page, USERS.alice);
    await page.goto('/t/alpha');
    await expect(page.getByTestId('tool-toggle-image.rotate')).toBeChecked();

    await page.getByTestId('tool-toggle-image.rotate').evaluate((element) => {
      (element as HTMLInputElement).click();
    });
    await expect(page.getByTestId('tool-toggle-image.rotate')).not.toBeChecked();

    await page.goto('/image?tenant=alpha');
    await expect(page.getByTestId('workbench-image.flip')).toBeVisible();
    await expect(page.getByTestId('workbench-image.rotate')).toHaveCount(0);
    await page.getByTestId('workbench-image.flip').click();
    await expect(page).toHaveURL(/\/image\/flip\?tenant=alpha$/);

    await page.goto('/image/rotate?tenant=alpha');
    await expect(page.getByRole('alert')).toContainText('未启用该工具');
    await expect(page.getByTestId('image-rotate-drop')).toHaveCount(0);
    await page.goto('/image/rotate');
    await expect(page.getByTestId('image-rotate-drop')).toBeVisible();
  });

  test('nonmembers cannot access tenant-branded PDF tools, public local tools remain open', async ({ page }) => {
    await page.goto('/pdf?tenant=alpha');
    await expect(page.getByRole('alert')).toContainText('需要登录');
    await page.goto('/pdf/merge?tenant=alpha');
    await expect(page.getByRole('alert')).toContainText('需要登录');
    await expect(page.getByTestId('pdf-merge-drop')).toHaveCount(0);
    await page.goto('/pdf/merge');
    await expect(page.getByTestId('pdf-merge-drop')).toBeVisible();

    await loginAs(page, USERS.bob);
    await page.goto('/pdf?tenant=alpha');
    await expect(page.getByRole('alert')).toContainText('没有此团队空间');
    await page.goto('/pdf?tenant=beta');
    await expect(page.getByTestId('workbench-pdf.merge')).toBeVisible();
  });
});

test('image frame uses selected border color in actual output pixels', async ({ page }, testInfo: TestInfo) => {
  await page.goto('/image/frame');
  await page.getByTestId('image-frame-drop-input').setInputFiles(FIXTURES.image);
  await page.locator('input[type="color"]').fill('#ff0000');
  await page.getByTestId('process-button').click();
  await expect(page.getByTestId('result-card')).toBeVisible();

  const waiting = page.waitForEvent('download');
  await page.getByTestId('result-download').click();
  const output = await waiting;
  const saved = testInfo.outputPath(output.suggestedFilename());
  await output.saveAs(saved);
  const png = PNG.sync.read(await fs.readFile(saved));
  expect(png.width).toBe(848);
  expect(png.height).toBe(648);
  expect(Array.from(png.data.subarray(0, 3))).toEqual([255, 0, 0]);
});
