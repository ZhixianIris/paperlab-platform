import { PDFDocument } from 'pdf-lib';
import { baseName, parsePageRanges } from './operations';

type OutputFormat = 'png' | 'jpeg';

async function openDocument(file: File) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new Error('无法渲染 PDF：文件可能损坏、加密或格式不受支持');
  }
}

async function pageCanvas(page: import('pdfjs-dist').PDFPageProxy, requestedScale: number): Promise<HTMLCanvasElement> {
  const initial = page.getViewport({ scale: requestedScale });
  const pixels = initial.width * initial.height;
  const actualScale = pixels > 14_000_000 ? requestedScale * Math.sqrt(14_000_000 / pixels) : requestedScale;
  const viewport = page.getViewport({ scale: actualScale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('浏览器不支持 Canvas 处理');
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

async function canvasBlob(canvas: HTMLCanvasElement, format: OutputFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法编码页面图像')),
      format === 'png' ? 'image/png' : 'image/jpeg', quality));
}

export async function exportPdfImages(
  file: File, range: string, format: OutputFormat, scale: number,
): Promise<File[]> {
  if (scale < .5 || scale > 3 || !Number.isFinite(scale)) throw new Error('清晰度倍率无效');
  const pdf = await openDocument(file);
  try {
    const selected = parsePageRanges(range, pdf.numPages);
    if (selected.length > 30) throw new Error('每次最多导出 30 页图片，避免浏览器内存不足');
    const result: File[] = [];
    for (const index of selected) {
      const page = await pdf.getPage(index);
      const canvas = await pageCanvas(page, scale);
      const blob = await canvasBlob(canvas, format, .88);
      result.push(new File([blob],
        `${baseName(file.name)}-page-${String(index).padStart(3, '0')}.${format === 'png' ? 'png' : 'jpg'}`,
        { type: blob.type }));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    return result;
  } finally {
    await pdf.destroy();
  }
}

export async function extractPdfText(file: File, range: string): Promise<File> {
  const pdf = await openDocument(file);
  try {
    const selected = parsePageRanges(range, pdf.numPages);
    const chunks: string[] = [];
    for (const index of selected) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      chunks.push(`--- 第 ${index} 页 ---\n${text.trim()}`);
      page.cleanup();
    }
    if (!chunks.some((chunk) => /--- 第 \d+ 页 ---\s+\S/.test(chunk))) {
      throw new Error('该 PDF 没有可提取的文字层；扫描文件需要先 OCR');
    }
    return new File(['\uFEFF', chunks.join('\n\n')], `${baseName(file.name)}.txt`, {
      type: 'text/plain;charset=utf-8',
    });
  } finally {
    await pdf.destroy();
  }
}

export async function rasterPdf(
  file: File,
  kind: 'compress' | 'grayscale' | 'background',
  options: { quality: number; scale: number; threshold: number },
): Promise<File> {
  const { quality, scale, threshold } = options;
  if (!Number.isFinite(quality) || quality < .3 || quality > .98 ||
      !Number.isFinite(scale) || scale < .5 || scale > 3 ||
      !Number.isFinite(threshold) || threshold < 50 || threshold > 245) {
    throw new Error('输出参数超出允许范围');
  }
  const source = await openDocument(file);
  try {
    if (source.numPages > 80) throw new Error('一次最多处理 80 页；请先拆分大文档');
    const output = await PDFDocument.create();
    for (let index = 1; index <= source.numPages; index += 1) {
      const page = await source.getPage(index);
      const canvas = await pageCanvas(page, scale);
      if (kind !== 'compress') {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('浏览器不支持图像处理');
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const gray = Math.round(.299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2]);
          // Background cleanup is deliberately conservative: light pixels become white,
          // dark foreground remains grayscale. Complex overlapping backgrounds need review.
          const value = kind === 'background' && gray >= threshold ? 255 : gray;
          px[i] = value; px[i + 1] = value; px[i + 2] = value;
        }
        ctx.putImageData(data, 0, 0);
      }
      const jpeg = new Uint8Array(await (await canvasBlob(canvas, 'jpeg', quality)).arrayBuffer());
      const embedded = await output.embedJpg(jpeg);
      const size = page.getViewport({ scale: 1 });
      const target = output.addPage([size.width, size.height]);
      target.drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
    const filename = kind === 'compress' ? 'compressed' : kind === 'grayscale' ? 'grayscale' : 'clean-background';
    return new File([await output.save() as BlobPart], `${baseName(file.name)}-${filename}.pdf`, {
      type: 'application/pdf',
    });
  } finally {
    await source.destroy();
  }
}
