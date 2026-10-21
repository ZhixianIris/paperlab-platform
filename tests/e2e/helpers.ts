import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const USERS = {
  admin: 'admin@paperlab.test',
  alice: 'alice@paperlab.test',
  bob: 'bob@paperlab.test',
  carol: 'carol@paperlab.test',
};

export const PASSWORD = 'Passw0rd!';

export const FIXTURES = {
  alphaPdf: path.resolve('tests/fixtures/sample-alpha.pdf'),
  betaPdf: path.resolve('tests/fixtures/sample-beta.pdf'),
  fivePagePdf: path.resolve('tests/fixtures/sample-five.pdf'),
  image: path.resolve('tests/fixtures/sample-image.png'),
};

export async function resetData(request: APIRequestContext): Promise<void> {
  const response = await request.post('http://127.0.0.1:8788/e2e/reset');
  expect(response.ok()).toBeTruthy();
}

export async function loginAs(page: Page, email: string, next = '/account'): Promise<void> {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(next)}$`));
}

export async function logout(page: Page): Promise<void> {
  await page.goto('/account');
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/$/);
}

export function currencyToNumber(value: string): number {
  return Number(value.replace(/[^\d.-]/g, ''));
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
