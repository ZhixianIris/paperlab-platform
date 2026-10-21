// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PNG } from 'pngjs';
import {
  parsePageOrder, deletePdfPages, reorderPdfPages, insertBlankPages,
  addPageNumbers, cropPdf, editPdfMetadata, imagesToPdf, flattenPdfForms,
  stampPdf,
} from './operations-extended';

async function fixture(pages = 3): Promise<File> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n += 1) {
    const page = pdf.addPage([400, 500]);
    page.drawText(`EXAMPLE PAGE ${n}`, { x: 30, y: 400, size: 18, font, color: rgb(0, 0, 0) });
  }
  return new File([await pdf.save() as BlobPart], 'example.pdf', { type: 'application/pdf' });
}

function samplePng(): File {
  const png = new PNG({ width: 50, height: 30 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 200; png.data[i + 1] = 30; png.data[i + 2] = 30; png.data[i + 3] = 255;
  }
  return new File([PNG.sync.write(png)], 'stamp.png', { type: 'image/png' });
}

describe('local PDF utilities', () => {
  it('preserves user-selected ordering and permits duplicate pages', () => {
    expect(parsePageOrder('3,1-2,2', 3)).toEqual([3, 1, 2, 2]);
    expect(parsePageOrder('3-1', 3)).toEqual([3, 2, 1]);
    expect(() => parsePageOrder('0,1', 3)).toThrow();
    expect(() => parsePageOrder('2,100', 3)).toThrow();
    expect(() => parsePageOrder('', 3)).toThrow();
  });

  it('deletes selected pages without rasterizing and rejects deleting everything', async () => {
    const source = await fixture();
    const cleaned = await deletePdfPages(source, '2');
    expect((await PDFDocument.load(await cleaned.arrayBuffer())).getPageCount()).toBe(2);
    await expect(deletePdfPages(source, '1-3')).rejects.toThrow('不能删除全部');
    await expect(deletePdfPages(source, '')).rejects.toThrow('请输入');
  });

  it('reorders and duplicates while preserving original PDF pages', async () => {
    const organized = await reorderPdfPages(await fixture(), '3,1,3');
    const document = await PDFDocument.load(await organized.arrayBuffer());
    expect(document.getPageCount()).toBe(3);
    expect(document.getPage(1).getSize()).toEqual({ width: 400, height: 500 });
  });

  it('inserts blank pages at the exact position and rejects invalid quantities', async () => {
    const output = await insertBlankPages(await fixture(), 1, 2);
    const doc = await PDFDocument.load(await output.arrayBuffer());
    expect(doc.getPageCount()).toBe(5);
    expect(doc.getPage(1).getWidth()).toBe(400);
    await expect(insertBlankPages(await fixture(), 0, 21)).rejects.toThrow();
  });

  it('adds native page numbers, crops visible bounds and edits document attributes', async () => {
    const numbered = await addPageNumbers(await fixture(), {
      start: 8, position: 'bottom-center', range: '2-3',
    });
    expect((await PDFDocument.load(await numbered.arrayBuffer())).getPageCount()).toBe(3);
    const crop = await cropPdf(await fixture(), 10, '2');
    const pdf = await PDFDocument.load(await crop.arrayBuffer());
    expect(pdf.getPage(1).getCropBox().width).toBeLessThan(pdf.getPage(1).getWidth());
    expect(pdf.getPage(0).getCropBox().width).toBeCloseTo(400);
    const updated = await editPdfMetadata(await fixture(), {
      title: 'Revised', author: 'PaperLab', subject: 'QA', keywords: 'one,two', clear: false,
    });
    const parsed = await PDFDocument.load(await updated.arrayBuffer());
    expect(parsed.getTitle()).toBe('Revised');
    expect(parsed.getAuthor()).toBe('PaperLab');
  });

  it('embeds images locally as PDF pages or visible stamps', async () => {
    const png = samplePng();
    const images = await imagesToPdf([png, png], 'a4');
    const document = await PDFDocument.load(await images.arrayBuffer());
    expect(document.getPageCount()).toBe(2);
    expect(document.getPage(0).getSize().width).toBeGreaterThan(0);
    const stamped = await stampPdf(await fixture(), png, '1-2', 20, 'bottom-right');
    expect((await PDFDocument.load(await stamped.arrayBuffer())).getPageCount()).toBe(3);
  });

  it('flattens AcroForm fields rather than silently claiming other annotations are supported', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([400, 500]);
    const field = pdf.getForm().createTextField('fullName');
    field.setText('PaperLab');
    field.addToPage(pdf.getPage(0));
    const source = new File([await pdf.save() as BlobPart], 'form.pdf', { type: 'application/pdf' });
    const flattened = await flattenPdfForms(source);
    const result = await PDFDocument.load(await flattened.arrayBuffer());
    expect(result.getForm().getFields()).toHaveLength(0);
    await expect(flattenPdfForms(await fixture())).rejects.toThrow('没有可扁平化');
  });
});
