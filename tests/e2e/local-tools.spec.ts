import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FIXTURES } from './helpers';

const standardFontDataUrl = `${pathToFileURL(
  path.resolve('node_modules/pdfjs-dist/standard_fonts'),
).href}/`;

async function downloadedFile(page: Page, testInfo: TestInfo) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('result-download').click();
  const download = await downloadPromise;
  const target = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(target);
  return target;
}

async function pdfText(file: string): Promise<string> {
  const bytes = new Uint8Array(await fs.readFile(file));
  const document = await getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  try {
    let text = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }
    return text;
  } finally {
    await document.destroy();
  }
}

test.describe('local-only PDF and image tools', () => {
  test('PDF merge works fully offline, keeps all pages and the text layer', async ({ page, context }, testInfo) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    await page.goto('/pdf/merge');
    await expect(page.getByRole('heading', { name: 'PDF 合并' })).toBeVisible();
    requests.length = 0;

    await context.setOffline(true);
    await page.getByTestId('pdf-merge-drop-input').setInputFiles([FIXTURES.alphaPdf, FIXTURES.betaPdf]);
    await expect(page.getByTestId('merge-order')).toContainText('sample-alpha.pdf');
    await page.getByTestId('move-up-1').click();
    await expect(page.locator('.reorder-row').first()).toContainText('sample-beta.pdf');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toContainText('PDF 已合并', { timeout: 20_000 });

    const file = await downloadedFile(page, testInfo);
    expect(requests).toEqual([]);
    const document = await PDFDocument.load(await fs.readFile(file));
    expect(document.getPageCount()).toBe(4);
    const text = await pdfText(file);
    expect(text).toContain('PAPERLAB ALPHA');
    expect(text).toContain('PAPERLAB BETA');
    expect(text).toContain('native text layer must remain selectable');
  });

  test('PDF split extracts the requested page and rotate changes rotation without rasterizing', async ({ page }, testInfo) => {
    await page.goto('/pdf/split');
    await page.getByTestId('pdf-split-drop-input').setInputFiles(FIXTURES.alphaPdf);
    const range = page.getByTestId('page-range');
    await expect(range).toHaveValue('1-2');
    await range.fill('2');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const splitFile = await downloadedFile(page, testInfo);
    const split = await PDFDocument.load(await fs.readFile(splitFile));
    expect(split.getPageCount()).toBe(1);
    expect(await pdfText(splitFile)).toContain('PAGE 2');

    await page.goto('/pdf/rotate');
    await page.getByTestId('pdf-rotate-drop-input').setInputFiles(FIXTURES.betaPdf);
    await page.getByRole('button', { name: '180°' }).click();
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const rotatedFile = await downloadedFile(page, testInfo);
    const rotated = await PDFDocument.load(await fs.readFile(rotatedFile));
    expect(rotated.getPage(0).getRotation().angle).toBe(180);
    expect(await pdfText(rotatedFile)).toContain('PAPERLAB BETA');
  });

  test('image crop works fully offline and produces exact dimensions', async ({ page, context }, testInfo) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4173')) {
        requests.push(request.url());
      }
    });
    await page.goto('/image/crop');
    await expect(page.getByRole('heading', { name: '图片裁剪' })).toBeVisible();
    await page.getByTestId('image-crop-drop-input').setInputFiles(FIXTURES.image);
    await expect(page.getByText(/原始尺寸 800 × 600/)).toBeVisible();

    await context.setOffline(true);
    await page.getByTestId('crop-x').fill('100');
    await page.getByTestId('crop-y').fill('50');
    await page.getByTestId('crop-width').fill('300');
    await page.getByTestId('crop-height').fill('200');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const file = await downloadedFile(page, testInfo);
    expect(requests).toEqual([]);
    const png = PNG.sync.read(await fs.readFile(file));
    expect(png.width).toBe(300);
    expect(png.height).toBe(200);
  });

  test('image resize, convert and compress produce downloadable outputs', async ({ page }, testInfo) => {
    await page.goto('/image/resize');
    await page.getByTestId('image-resize-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('resize-width').fill('400');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const resizedFile = await downloadedFile(page, testInfo);
    const resized = PNG.sync.read(await fs.readFile(resizedFile));
    expect(resized.width).toBe(400);
    expect(resized.height).toBe(300);

    await page.goto('/image/convert');
    await page.getByTestId('image-convert-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('convert-format').selectOption('image/webp');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const webpFile = await downloadedFile(page, testInfo);
    const webpBytes = await fs.readFile(webpFile);
    expect(webpBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(webpBytes.subarray(8, 12).toString('ascii')).toBe('WEBP');

    await page.goto('/image/compress');
    await page.getByTestId('image-compress-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('compress-size').fill('0.05');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 30_000 });
    const compressedFile = await downloadedFile(page, testInfo);
    const stats = await fs.stat(compressedFile);
    expect(stats.size).toBeGreaterThan(0);
    expect(path.extname(compressedFile).toLowerCase()).toBe('.png');
  });
});
