import { test, expect } from '@playwright/test';

test.describe('workbenches', () => {
  test('root opens the PDF workbench and each workbench only shows tool cards', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/pdf$/);
    await expect(page.getByTestId('workbench-pdf')).toBeVisible();
    await expect(page.getByTestId('workbench-pdf.merge')).toBeVisible();
    await expect(page.getByTestId('workbench-pdf.split')).toBeVisible();
    await expect(page.getByTestId('workbench-pdf.rotate')).toBeVisible();
    await expect(page.locator('.workbench-head')).toHaveCount(0);

    const firstCard = page.locator('.workbench-card').first();
    const iconBox = await firstCard.locator('.workbench-icon').boundingBox();
    const arrowBox = await firstCard.locator('.workbench-arrow').boundingBox();
    const titleBox = await firstCard.locator('h2').boundingBox();
    expect(iconBox).not.toBeNull();
    expect(arrowBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    if (iconBox && arrowBox && titleBox) {
      expect(iconBox.x).toBeLessThan(arrowBox.x);
      expect(Math.abs((iconBox.y + iconBox.height / 2) - (arrowBox.y + arrowBox.height / 2))).toBeLessThan(2);
      expect(titleBox.y).toBeGreaterThan(iconBox.y + iconBox.height);
    }

    await page.goto('/image');
    await expect(page.getByTestId('workbench-image')).toBeVisible();
    await expect(page.getByTestId('workbench-image.crop')).toBeVisible();
    await expect(page.getByTestId('workbench-image.resize')).toBeVisible();
    await expect(page.getByTestId('workbench-image.convert')).toBeVisible();
    await expect(page.getByTestId('workbench-image.compress')).toBeVisible();
    await expect(page.locator('.workbench-head')).toHaveCount(0);

    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: '我们从哪里开始？' })).toBeVisible();
    await expect(page.getByTestId('ai-command')).toBeVisible();
    await page.getByTestId('ai-image-open').click();
    await expect(page.getByRole('heading', { name: '登录后使用 AI 出图' })).toBeVisible();
  });
});
