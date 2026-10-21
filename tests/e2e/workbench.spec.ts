import { test, expect } from '@playwright/test';

test.describe('workbenches', () => {
  test('root opens the PDF workbench and each workbench only shows tool cards', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/pdf$/);
    await expect(page.getByTestId('workbench-pdf')).toBeVisible();
    await expect(page.getByTestId('workbench-pdf.merge')).toBeVisible();
    await expect(page.getByTestId('workbench-pdf.split')).toBeVisible();
    await expect(page.getByTestId('workbench-pdf.rotate')).toBeVisible();

    await page.goto('/image');
    await expect(page.getByTestId('workbench-image')).toBeVisible();
    await expect(page.getByTestId('workbench-image.crop')).toBeVisible();
    await expect(page.getByTestId('workbench-image.resize')).toBeVisible();
    await expect(page.getByTestId('workbench-image.convert')).toBeVisible();
    await expect(page.getByTestId('workbench-image.compress')).toBeVisible();

    await page.goto('/ai');
    await expect(page.getByTestId('workbench-ai')).toBeVisible();
    await expect(page.getByTestId('workbench-ai-image')).toBeVisible();
    await page.getByTestId('workbench-ai-image').click();
    await expect(page).toHaveURL(/\/ai\/image$/);
    await expect(page.getByRole('heading', { name: '登录后使用 AI 出图' })).toBeVisible();
  });
});
