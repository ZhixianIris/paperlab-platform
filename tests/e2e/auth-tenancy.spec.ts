import { test, expect, type Page } from '@playwright/test';
import { USERS, loginAs, resetData } from './helpers';

async function clickSwitch(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((element) => {
    (element as HTMLInputElement).click();
  });
}

test.describe('authentication and tenant isolation', () => {
  test.beforeEach(async ({ request }) => {
    await resetData(request);
  });

  test('anonymous visitors can use local tools but see login gates for account and tenant', async ({ page }) => {
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: '请先登录' })).toBeVisible();

    await page.goto('/t/alpha');
    await expect(page.getByRole('heading', { name: 'Alpha Studio' })).toBeVisible();
    await expect(page.getByRole('link', { name: /登录进入/ })).toBeVisible();
  });

  test('Alice sees only Alpha and cannot open Beta; Bob sees only Beta', async ({ page }) => {
    await loginAs(page, USERS.alice);
    await expect(page.getByRole('heading', { name: '账户与额度' })).toBeVisible();
    await expect(page.getByText('Alpha Studio')).toBeVisible();
    await expect(page.getByText('充值暂未开放')).toBeVisible();

    await page.goto('/t/alpha');
    await expect(page.getByRole('heading', { name: 'Alpha Studio' })).toBeVisible();
    await expect(page.getByText('carol@paperlab.test')).toBeVisible();
    await expect(page.getByText('alice@paperlab.test').first()).toBeVisible();

    await page.goto('/t/beta');
    await expect(page.getByRole('heading', { name: '你没有访问权限' })).toBeVisible();

    const bob = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:4173' });
    const bobPage = await bob.newPage();
    await loginAs(bobPage, USERS.bob);
    await bobPage.goto('/t/beta');
    await expect(bobPage.getByRole('heading', { name: 'Beta Works' })).toBeVisible();
    await bobPage.goto('/t/alpha');
    await expect(bobPage.getByRole('heading', { name: '你没有访问权限' })).toBeVisible();
    await bob.close();
  });

  test('platform admin manages tenants, members, tools, models and manual credits through real APIs', async ({ page }) => {
    await loginAs(page, USERS.admin, '/admin');
    await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();
    await expect(page.locator('.admin-metrics article').first().locator('strong')).toHaveText('2');

    await page.getByTestId('admin-tab-tenants').click();
    await page.getByTestId('admin-tenant-name').fill('Gamma Lab');
    await page.getByTestId('admin-tenant-slug').fill('gamma');
    await page.getByTestId('admin-tenant-owner').fill(USERS.carol);
    await page.getByTestId('admin-create-tenant').click();
    await expect(page.getByTestId('admin-tenant-gamma')).toBeVisible();
    await page.getByTestId('admin-tenant-gamma').click();
    await expect(page.getByTestId('admin-tenant-edit-name')).toBeVisible();
    await expect(page.getByText('carol@paperlab.test')).toBeVisible();

    await page.getByTestId('admin-tenant-edit-name').fill('Gamma Lab Two');
    await page.getByTestId('admin-save-tenant').click();
    await expect(page.getByText('租户设置已保存')).toBeVisible();

    await page.getByTestId('admin-member-email').fill(USERS.bob);
    await page.getByTestId('admin-add-member').click();
    await expect(page.getByText('成员已加入')).toBeVisible();
    await expect(page.getByText(USERS.bob)).toBeVisible();

    await page.getByTestId('admin-wallet-amount').fill('10.00');
    await page.getByTestId('admin-wallet-reason').fill('E2E 人工入账验收');
    await page.getByTestId('admin-wallet-adjust').click();
    await expect(page.getByText('¥10.00').first()).toBeVisible();

    await clickSwitch(page, 'admin-tool-pdf.merge');
    await expect(page.getByTestId('admin-tool-pdf.merge')).not.toBeChecked();

    await page.getByTestId('admin-tab-models').click();
    await expect(page.getByText('标准图像模型')).toBeVisible();
    await clickSwitch(page, 'model-toggle-fixture');
    await expect(page.getByTestId('model-toggle-fixture')).not.toBeChecked();
    await clickSwitch(page, 'model-toggle-fixture');
    await expect(page.getByTestId('model-toggle-fixture')).toBeChecked();

    await page.getByTestId('admin-tab-orders').click();
    await expect(page.getByText('暂无真实订单')).toBeVisible();

    const bob = await page.context().browser()!.newContext({ baseURL: 'http://127.0.0.1:4173' });
    const bobPage = await bob.newPage();
    await loginAs(bobPage, USERS.bob);
    await expect(bobPage.getByText('Gamma Lab Two')).toBeVisible();
    await bobPage.goto('/t/gamma');
    await expect(bobPage.getByRole('heading', { name: 'Gamma Lab Two' })).toBeVisible();
    await bob.close();
  });
});
