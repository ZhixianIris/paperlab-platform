import { test, expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { FIXTURES, USERS, loginAs, resetData } from './helpers';

const standardFontDataUrl = `${pathToFileURL(
  path.resolve('node_modules/pdfjs-dist/standard_fonts'),
).href}/`;

async function downloadCurrent(page: Page, testInfo: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await page.getByTestId('ai-file-download').first().click();
  const download = await pending;
  const target = testInfo.outputPath(name);
  await download.saveAs(target);
  return target;
}

async function textOfPdf(file: string): Promise<string> {
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
    let output = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      output += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }
    return output;
  } finally {
    await document.destroy();
  }
}

test.describe('natural-language local workspace', () => {
  test('E01 offline delete page 2 then rotate remaining pages preserves 4 pages and the text layer', async ({ page, context }, testInfo) => {
    await page.goto('/ai');
    await expect(page.getByRole('heading', { name: '文件工作台' })).toBeVisible();
    const httpRequests: string[] = [];
    page.on('request', (request) => {
      if (/^https?:/.test(request.url())) httpRequests.push(request.url());
    });
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.fivePagePdf);
    await expect(page.locator('.file-row')).toHaveCount(1);
    await page.getByTestId('ai-command').fill('删除第 2 页，再旋转剩余页面 90 度');
    await page.getByTestId('ai-command-send').click();
    await expect(page.getByTestId('ai-plan-card')).toBeVisible();
    await expect(page.getByTestId('ai-plan-card')).toContainText('本机计划');
    await expect(page.getByTestId('ai-plan-card')).toContainText('PDF 删除页面');
    await expect(page.getByTestId('ai-plan-card')).toContainText('PDF 旋转');
    await page.getByTestId('ai-plan-execute').click();
    await expect(page.getByTestId('ai-stage')).toContainText('结果可预览', { timeout: 30_000 });

    const target = await downloadCurrent(page, testInfo, 'workspace-offline-result.pdf');
    const document = await PDFDocument.load(await fs.readFile(target));
    expect(document.getPageCount()).toBe(4);
    for (const page of document.getPages()) {
      expect(page.getRotation().angle).toBe(90);
    }
    expect(await textOfPdf(target)).toContain('PAPERLAB FIVE');
    expect(httpRequests).toEqual([]);
    await fs.writeFile(
      testInfo.outputPath('workspace-offline-network.json'),
      JSON.stringify({ operation: 'pdf.delete+pdf.rotate', offline: true, externalHttpRequests: httpRequests }, null, 2),
    );
    await page.screenshot({ path: testInfo.outputPath('workspace-offline-result.png') });
  });

  test('E02 merge two PDFs then add numbers starting at 3', async ({ page }, testInfo) => {
    await page.goto('/ai');
    await page.getByTestId('ai-drop-input').setInputFiles([FIXTURES.alphaPdf, FIXTURES.betaPdf]);
    await expect(page.locator('.file-row')).toHaveCount(2);
    await page.getByTestId('ai-command').fill('按顺序合并，并从第 3 页开始加页码');
    await page.getByTestId('ai-command-send').click();
    await expect(page.getByTestId('ai-plan-card')).toBeVisible();
    await page.getByTestId('ai-plan-execute').click();
    await expect(page.getByTestId('ai-stage')).toContainText('结果可预览', { timeout: 30_000 });
    const target = await downloadCurrent(page, testInfo, 'workspace-merge-numbered.pdf');
    const document = await PDFDocument.load(await fs.readFile(target));
    expect(document.getPageCount()).toBe(4);
    const text = await textOfPdf(target);
    expect(text).toContain('PAPERLAB ALPHA');
    expect(text).toContain('PAPERLAB BETA');
    expect(text).toContain('3');
    expect(text).toContain('4');
  });

  test('E03 image watermark then compression produces visible pixels without a server', async ({ page }, testInfo) => {
    await page.goto('/ai');
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.image);
    await expect(page.locator('.file-row')).toHaveCount(1);
    await page.getByTestId('ai-command').fill('右下角加白色半透明 PaperLab 水印后压缩');
    await page.getByTestId('ai-command-send').click();
    await expect(page.getByTestId('ai-plan-card')).toBeVisible();
    await expect(page.getByTestId('ai-plan-card')).toContainText('图片文字水印');
    await expect(page.getByTestId('ai-plan-card')).toContainText('图片压缩');
    await page.getByTestId('ai-plan-execute').click();
    await expect(page.getByTestId('ai-stage')).toContainText('结果可预览', { timeout: 30_000 });
    const target = await downloadCurrent(page, testInfo, 'workspace-watermarked.png');
    expect(path.extname(target).toLowerCase()).toBe('.png');
    const png = PNG.sync.read(await fs.readFile(target));
    expect(png.width).toBe(800);
    expect(png.height).toBe(600);
    const original = PNG.sync.read(await fs.readFile(FIXTURES.image));
    let changedPixels = 0;
    for (let y = 420; y < 600; y += 1) {
      for (let x = 500; x < 800; x += 1) {
        const index = (y * png.width + x) * 4;
        const difference = Math.abs(png.data[index] - original.data[index])
          + Math.abs(png.data[index + 1] - original.data[index + 1])
          + Math.abs(png.data[index + 2] - original.data[index + 2]);
        if (difference > 25) changedPixels += 1;
      }
    }
    expect(changedPixels).toBeGreaterThan(10);
  });

  test('E04 ambiguous instruction asks for clarification and does not execute', async ({ page }) => {
    await page.goto('/ai');
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('ai-command').fill('帮我处理一下这个文件');
    await page.getByTestId('ai-command-send').click();
    await expect(page.locator('.chat-messages').getByText(/还不能确定|需要补充|不清楚/)).toBeVisible();
    await expect(page.getByTestId('ai-plan-card')).toHaveCount(0);
    await expect(page.getByTestId('ai-plan-execute')).toHaveCount(0);
  });

  test('E08 save/restore/clear a local draft', async ({ page }) => {
    await page.goto('/ai');
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.image);
    await expect(page.locator('.file-row')).toHaveCount(1);
    await page.getByTestId('ai-save-draft').click();
    await expect(page.getByTestId('ai-draft-list')).toBeVisible();
    await expect(page.getByTestId('ai-draft-list')).toContainText('sample-image.png');

    await page.reload();
    await expect(page.getByTestId('ai-draft-list')).toBeVisible();
    await page.getByTestId('ai-restore-draft').first().click();
    await expect(page.locator('.file-row')).toHaveCount(1);
    await page.getByTestId('ai-clear-drafts').click();
    await expect(page.getByTestId('ai-draft-list')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('ai-draft-list')).toHaveCount(0);
  });

  test('E06 cloud planning sends only prompt and metadata and then executes in the browser', async ({ page, request }, testInfo) => {
    await resetData(request);
    await loginAs(page, USERS.alice, '/ai?tenant=alpha');
    await expect(page.getByRole('heading', { name: '文件工作台' })).toBeVisible();
    const planBodies: string[] = [];
    page.on('request', (incoming) => {
      if (incoming.url().includes('/platform-api') && incoming.postData()?.includes('"ai.plan"')) {
        planBodies.push(incoming.postData() || '');
      }
    });
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.fivePagePdf);
    await expect(page.locator('.file-row')).toHaveCount(1);
    await page.getByTestId('ai-command').fill('把第2页拿掉，再把余下页面顺时针转90度');
    await page.getByTestId('ai-command-send').click();
    await expect(page.getByTestId('ai-plan-card')).toBeVisible();
    await expect(page.getByTestId('ai-plan-card')).toContainText('云端规划');
    expect(planBodies).toHaveLength(1);
    const planBody = planBodies[0];
    expect(planBody).toContain('pageCount');
    expect(planBody).not.toContain('%PDF');
    expect(planBody).not.toContain('data:application');
    expect(planBody).not.toContain('base64');
    expect(planBody).not.toContain('sample-five.pdf');
    await fs.writeFile(
      testInfo.outputPath('ai-plan-request.json'),
      JSON.stringify({ note: 'Only prompt and file metadata; no file bytes', body: JSON.parse(planBody) }, null, 2),
    );
    await page.getByTestId('ai-plan-execute').click();
    await expect(page.getByTestId('ai-stage')).toContainText('结果可预览', { timeout: 30_000 });
    const target = await downloadCurrent(page, testInfo, 'workspace-cloud-result.pdf');
    const document = await PDFDocument.load(await fs.readFile(target));
    expect(document.getPageCount()).toBe(4);
  });

  test('E07 cloud planner failure leaves local commands usable', async ({ page, request }) => {
    await resetData(request);
    await loginAs(page, USERS.alice, '/ai?tenant=alpha');
    await page.route('**/platform-api', async (route) => {
      const body = route.request().postData() || '';
      if (body.includes('"ai.plan"')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: { code: 'planner_unavailable', message: '云端规划暂时不可用' } }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.image);
    await page.getByTestId('ai-command').fill('帮我审美一下这张图');
    await page.getByTestId('ai-command-send').click();
    await expect(page.locator('.chat-messages')).toContainText('云端规划暂时不可用');
    await expect(page.getByTestId('ai-plan-card')).toHaveCount(0);

    await page.getByTestId('ai-command').fill('压缩图片');
    await page.getByTestId('ai-command-send').click();
    await expect(page.getByTestId('ai-plan-card')).toBeVisible();
    await page.getByTestId('ai-plan-execute').click();
    await expect(page.getByTestId('ai-stage')).toContainText('结果可预览', { timeout: 30_000 });
  });

  test('E09 lossy PDF operation shows confirmation and rasterization warning', async ({ page }) => {
    await page.goto('/ai');
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('ai-command').fill('转灰度');
    await page.getByTestId('ai-command-send').click();
    await expect(page.getByTestId('ai-plan-card')).toBeVisible();
    await expect(page.getByTestId('ai-plan-card')).toContainText('有损');
    await expect(page.getByTestId('ai-plan-card')).toContainText('栅格化');
    await expect(page.getByTestId('ai-plan-execute')).toBeVisible();
  });

  test('E05 browser rejects a malicious cloud plan even if the server contract regresses', async ({ page, request }) => {
    await resetData(request);
    await loginAs(page, USERS.alice, '/ai?tenant=alpha');
    await page.route('**/platform-api', async (route) => {
      const body = route.request().postDataJSON();
      if (body?.action === 'ai.plan') {
        const fileIds = body.payload.files.map((file: { fileId: string }) => file.fileId);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: true,
            data: {
              kind: 'plan',
              source: 'cloud',
              fileIds,
              steps: [{ toolKey: 'system.exec', args: { command: 'rm -rf /' } }],
              requiresConfirmation: true,
              reason: 'malicious test plan',
            },
          }),
        });
        return;
      }
      await route.continue();
    });
    await page.getByTestId('ai-drop-input').setInputFiles(FIXTURES.alphaPdf);
    await page.getByTestId('ai-command').fill('把第2页拿掉');
    await page.getByTestId('ai-command-send').click();
    await expect(page.locator('.chat-messages')).toContainText('不允许的工具');
    await expect(page.getByTestId('ai-plan-card')).toHaveCount(0);
    await expect(page.getByTestId('ai-plan-execute')).toHaveCount(0);
  });
});
