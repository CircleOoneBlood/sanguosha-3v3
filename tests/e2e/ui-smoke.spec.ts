import { test, expect } from '@playwright/test';

test('frontend renders and can create room', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '三国杀 3v3（Web MVP）' })).toBeVisible();

  await page.getByPlaceholder('例如：Will').fill('E2E-P1');
  await page.getByRole('button', { name: '创建房间' }).click();

  await expect(page.getByText('当前房间：')).toBeVisible();
  await expect(page.getByRole('heading', { name: '对局状态：lobby' })).toBeVisible();
});
