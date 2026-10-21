// @vitest-environment node
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  extractPdfPages,
  mergePdfs,
  parsePageRanges,
  rotatePdf,
} from './operations';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const standardFontDataUrl = pathToFileURL(path.join(pdfjsRoot, 'standard_fonts/')).href;

async function makePdf(label: string, pages: number): Promise<File> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= pages; index += 1) {
    const page = document.addPage([400, 500]);
    page.drawText(`${label} PAGE ${index}`, {
      x: 40,
      y: 400,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await document.save();
  return new File([bytes as BlobPart], `${label}.pdf`, { type: 'application/pdf' });
}

async function textOf(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  try {
    let result = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      result += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }
    return result;
  } finally {
    await document.destroy();
  }
}

describe('PDF local operations', () => {
  it('parses and validates page ranges', () => {
    expect(parsePageRanges('1,3-5', 6)).toEqual([1, 3, 4, 5]);
    expect(parsePageRanges('', 3)).toEqual([1, 2, 3]);
    expect(() => parsePageRanges('99', 3)).toThrow('没有选中任何有效页面');
    expect(() => parsePageRanges('abc', 3)).toThrow();
  });

  it('merges pages without rasterizing text', async () => {
    const merged = await mergePdfs([await makePdf('ALPHA', 2), await makePdf('BETA', 2)]);
    const document = await PDFDocument.load(await merged.arrayBuffer());
    expect(document.getPageCount()).toBe(4);
    const text = await textOf(merged);
    expect(text).toContain('ALPHA PAGE 1');
    expect(text).toContain('BETA PAGE 2');
  });

  it('extracts requested pages and rotates additively', async () => {
    const source = await makePdf('SOURCE', 3);
    const extracted = await extractPdfPages(source, '2-3');
    const extractedDoc = await PDFDocument.load(await extracted.arrayBuffer());
    expect(extractedDoc.getPageCount()).toBe(2);
    expect(await textOf(extracted)).toContain('SOURCE PAGE 3');

    const rotated = await rotatePdf(source, { angle: 90, allPages: true, range: '' });
    const rotatedDoc = await PDFDocument.load(await rotated.arrayBuffer());
    expect(rotatedDoc.getPage(0).getRotation().angle).toBe(90);
    expect(await textOf(rotated)).toContain('SOURCE PAGE 1');
  });
});
