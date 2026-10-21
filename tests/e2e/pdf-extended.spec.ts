import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { FIXTURES } from './helpers';

async function download(page: Page, testInfo: TestInfo) {
  const waiting = page.waitForEvent('download');
  await page.getByTestId('result-download').first().click();
  const item = await waiting;
  const target = testInfo.outputPath(item.suggestedFilename());
  await item.saveAs(target);
  return target;
}

test.describe('extended PDF tools run in the browser', () => {
  test('delete and rearrange produce real PDF files', async ({ page }, testInfo) => {
    await page.goto('/pdf/delete');
    await page.getByTestId('pdf-delete-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('utility-range').fill('2');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const deleted = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(deleted.getPageCount()).toBe(1);

    await page.goto('/pdf/organize');
    await page.getByTestId('pdf-organize-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('pdf-order').fill('2,1,2');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const organized = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(organized.getPageCount()).toBe(3);
  });

  test('watermark works offline without uploading the document', async ({ page, context }, testInfo) => {
    await page.goto('/pdf/watermark');
    const urls: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) urls.push(request.url());
    });
    await page.getByTestId('pdf-watermark-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('watermark-text').fill('内部使用');
    urls.length = 0;
    await context.setOffline(true);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const watermarked = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(watermarked.getPageCount()).toBe(2);
    expect(urls).toEqual([]);
  });

  test('image to PDF, metadata update and number stamping return valid PDFs', async ({ page }, testInfo) => {
    await page.goto('/pdf/images');
    await page.getByTestId('pdf-images-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const fromImage = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(fromImage.getPageCount()).toBe(1);

    await page.goto('/pdf/metadata');
    await page.getByTestId('pdf-metadata-drop-input').setInputFiles(FIXTURES.betaPdf);
    await page.getByTestId('metadata-title').fill('Document Example');
    await page.getByTestId('process-button').click();
    const metadata = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(metadata.getTitle()).toBe('Document Example');

    await page.goto('/pdf/numbers');
    await page.getByTestId('pdf-numbers-drop-input').setInputFiles(FIXTURES.betaPdf);
    await page.getByTestId('number-start').fill('25');
    await page.getByTestId('process-button').click();
    const numbered = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(numbered.getPageCount()).toBe(2);
  });

  test('extracts text from a PDF with native text and exports PNG', async ({ page }, testInfo) => {
    await page.goto('/pdf/to-text');
    await page.getByTestId('pdf-to-text-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 30_000 });
    const txt = (await fs.readFile(await download(page, testInfo))).toString('utf8');
    expect(txt).toContain('PAPERLAB ALPHA');

    await page.goto('/pdf/to-image');
    await page.getByTestId('pdf-to-image-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('utility-range').fill('1');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toHaveCount(1, { timeout: 30_000 });
    const image = await fs.readFile(await download(page, testInfo));
    expect(Array.from(image.subarray(0, 8))).toEqual([137,80,78,71,13,10,26,10]);
  });

  test('inserts another PDF and produces 2-up print sheets', async ({ page }, testInfo) => {
    await page.goto('/pdf/insert');
    await page.getByTestId('pdf-insert-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('pdf-insert-secondary-input').setInputFiles(FIXTURES.betaPdf);
    await page.getByTestId('blank-after').fill('1');
    await page.getByTestId('insert-source-range').fill('2');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const inserted = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(inserted.getPageCount()).toBe(3);

    await page.goto('/pdf/nup');
    await page.getByTestId('pdf-nup-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible();
    const nup = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(nup.getPageCount()).toBe(1);
  });

  test('background cleanup is explicitly lossy and returns a renderable PDF', async ({ page }, testInfo) => {
    await page.goto('/pdf/background');
    await page.getByTestId('pdf-background-drop-input').setInputFiles(FIXTURES.betaPdf);
    await expect(page.getByRole('note')).toContainText('丢失原生文字层');
    await page.getByTestId('process-button').click();
    await expect(page.getByTestId('result-card')).toBeVisible({ timeout: 40_000 });
    const output = await PDFDocument.load(await fs.readFile(await download(page, testInfo)));
    expect(output.getPageCount()).toBe(2);
  });
});
