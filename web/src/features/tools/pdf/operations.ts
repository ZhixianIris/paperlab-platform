/**
 * PDF operations adapted from OmniTools (MIT, commit dda3a240772459035eb38b14c5c7d94e81626116).
 * Original files: src/pages/tools/pdf/{merge-pdf,split-pdf,rotate-pdf}/service.ts.
 * Changes: typed errors, page-range validation, additive rotation, stable file names.
 * Operations stay in the browser; pdf-lib copies page content and never rasterizes
 * it, so native text layers are preserved.
 */
import { degrees, PDFDocument } from 'pdf-lib';

export interface PdfInfo {
  pageCount: number;
  title: string | null;
}

export function parsePageRanges(input: string, totalPages: number): number[] {
  const value = input.trim();
  if (!value) return Array.from({ length: totalPages }, (_, index) => index + 1);

  const pages = new Set<number>();
  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes('-')) {
      const [rawStart, rawEnd] = part.split('-');
      const start = Number.parseInt(rawStart, 10);
      const end = Number.parseInt(rawEnd, 10);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        throw new Error(`页码范围“${part}”格式不正确`);
      }
      const from = Math.max(1, Math.min(start, end));
      const to = Math.min(totalPages, Math.max(start, end));
      for (let page = from; page <= to; page += 1) pages.add(page);
    } else {
      const page = Number.parseInt(part, 10);
      if (!Number.isFinite(page) || String(page) !== part) {
        throw new Error(`页码“${part}”格式不正确`);
      }
      if (page >= 1 && page <= totalPages) pages.add(page);
    }
  }
  if (pages.size === 0) throw new Error('没有选中任何有效页面');
  return [...pages].sort((left, right) => left - right);
}

export async function loadPdf(file: File) {
  try {
    const bytes = await file.arrayBuffer();
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/encrypt/i.test(message)) {
      throw new Error('该 PDF 已加密，请先移除密码后再处理');
    }
    throw new Error('无法读取该 PDF，文件可能已损坏或受密码保护');
  }
}

export async function getPdfInfo(file: File): Promise<PdfInfo> {
  const document = await loadPdf(file);
  return {
    pageCount: document.getPageCount(),
    title: document.getTitle() || null,
  };
}

export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || 'document';
}

export async function mergePdfs(files: File[]): Promise<File> {
  if (files.length < 2) throw new Error('至少选择两个 PDF 文件');
  const merged = await PDFDocument.create();
  for (const file of files) {
    const source = await loadPdf(file);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  const bytes = await merged.save();
  return new File([bytes as BlobPart], `paperlab-merged-${files.length}.pdf`, {
    type: 'application/pdf',
  });
}

export async function extractPdfPages(file: File, range: string): Promise<File> {
  const source = await loadPdf(file);
  const totalPages = source.getPageCount();
  const selected = parsePageRanges(range, totalPages);
  const output = await PDFDocument.create();
  const pages = await output.copyPages(
    source,
    selected.map((page) => page - 1),
  );
  pages.forEach((page) => output.addPage(page));
  const bytes = await output.save();
  return new File([bytes as BlobPart], `${baseName(file.name)}-pages-${selected.join('-')}.pdf`, {
    type: 'application/pdf',
  });
}

export interface RotateOptions {
  angle: 90 | 180 | 270;
  allPages: boolean;
  range: string;
}

export async function rotatePdf(file: File, options: RotateOptions): Promise<File> {
  const document = await loadPdf(file);
  const totalPages = document.getPageCount();
  const selected = options.allPages
    ? Array.from({ length: totalPages }, (_, index) => index + 1)
    : parsePageRanges(options.range, totalPages);
  for (const pageNumber of selected) {
    const page = document.getPage(pageNumber - 1);
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + options.angle) % 360));
  }
  const bytes = await document.save();
  return new File([bytes as BlobPart], `${baseName(file.name)}-rotated-${options.angle}.pdf`, {
    type: 'application/pdf',
  });
}
