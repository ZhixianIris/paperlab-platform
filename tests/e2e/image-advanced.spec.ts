import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';
import { FIXTURES } from './helpers';

async function saveResult(page: Page, testInfo: TestInfo) {
  const pending = page.waitForEvent('download');
  await page.getByTestId('result-download').first().click();
  const download = await pending;
  const path = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return path;
}

const TRANSFORMS = [
  'rotate', 'flip', 'adjust', 'watermark', 'frame', 'round',
  'pixelate', 'blur', 'mask', 'background', 'replace-background', 'strip',
] as const;

test.describe('extended browser-local image tools', () => {
  for (const name of TRANSFORMS) {
    test(`${name} produces a valid local output`, async ({ page }, testInfo) => {
      await page.goto(`/image/${name}`);
      await page.getByTestId(`image-${name}-drop-input`).setInputFiles(FIXTURES.image);
      await expect(page.locator('.tool-hero h1')).toBeVisible();
      await page.getByTestId('process-button').click();
      await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 30_000 });
      if (name === 'strip') {
        await expect(page.getByTestId('compare-stage')).toHaveCount(0);
        await expect(page.locator('.result-image')).toHaveCount(0);
        await expect(page.locator('.image-utility-preview')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('compare-stage')).toBeVisible();
      }
      const file = await saveResult(page, testInfo);
      const bytes = await fs.readFile(file);
      expect(bytes.byteLength).toBeGreaterThan(100);
      if (file.endsWith('.png')) {
        const png = PNG.sync.read(bytes);
        expect(png.width).toBeGreaterThan(0);
        expect(png.height).toBeGreaterThan(0);
        if (name === 'rotate') {
          expect(png.width).toBe(600);
          expect(png.height).toBe(800);
        }
        if (name === 'frame') {
          expect(png.width).toBe(848);
          expect(png.height).toBe(648);
        }
        if (name === 'mask') {
          const index = (200 * png.width + 200) * 4;
          expect(Array.from(png.data.subarray(index, index + 3))).toEqual([17, 17, 17]);
        }
      }
    });
  }

  test('collage joins multiple images and exports a single PNG', async ({ page }, testInfo) => {
    const buf = await fs.readFile(FIXTURES.image);
    await page.goto('/image/collage');
    await page.getByTestId('image-collage-drop-input').setInputFiles([
      { name: 'first.png', mimeType: 'image/png', buffer: buf },
      { name: 'second.png', mimeType: 'image/png', buffer: buf },
    ]);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 30_000 });
    const output = PNG.sync.read(await fs.readFile(await saveResult(page, testInfo)));
    expect(output.width).toBe(1612);
    expect(output.height).toBe(600);
  });

  test('batch processing returns one downloadable output for every input', async ({ page }, testInfo) => {
    const buf = await fs.readFile(FIXTURES.image);
    await page.goto('/image/batch');
    await page.getByTestId('image-batch-drop-input').setInputFiles([
      { name: 'alpha.png', mimeType: 'image/png', buffer: buf },
      { name: 'beta.png', mimeType: 'image/png', buffer: buf },
    ]);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toHaveCount(2, { timeout: 30_000 });
    const output = PNG.sync.read(await fs.readFile(await saveResult(page, testInfo)));
    expect(output.width).toBe(800);
    expect(output.height).toBe(600);
  });

  test('mask works with network offline and does not send uploaded image', async ({ page, context }) => {
    const remoteRequests: string[] = [];
    await page.goto('/image/mask');
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });
    await context.setOffline(true);
    await page.getByTestId('image-mask-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 30_000 });
    expect(remoteRequests).toEqual([]);
  });

  test('region tools use a draggable box instead of position inputs', async ({ page }) => {
    await page.goto('/image/blur');
    await page.getByTestId('image-blur-drop-input').setInputFiles(FIXTURES.image);
    const region = page.getByTestId('utility-region');
    await expect(region).toBeVisible();
    await expect(page.getByLabel('区域宽度')).toHaveCount(0);
    await expect(page.getByLabel('区域高度')).toHaveCount(0);

    await page.getByTestId('utility-region-handle-se').scrollIntoViewIfNeeded();
    await page.waitForTimeout(50);
    const handle = await page.getByTestId('utility-region-handle-se').boundingBox();
    const before = await region.boundingBox();
    expect(handle).not.toBeNull();
    expect(before).not.toBeNull();
    if (handle && before) {
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x - 70, handle.y - 50, { steps: 8 });
      await page.mouse.up();
      const after = await region.boundingBox();
      expect(after?.width).toBeLessThan(before.width);
      expect(after?.height).toBeLessThan(before.height);
    }
  });
});
