import { degrees, PDFDocument, rgb, StandardFonts, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import { baseName, loadPdf, parsePageRanges } from './operations';

function asFile(bytes: Uint8Array, name: string): File {
  return new File([bytes as BlobPart], name, { type: 'application/pdf' });
}

export function parsePageOrder(input: string, totalPages: number): number[] {
  if (!input.trim()) throw new Error('请输入页面的新顺序');
  const order: number[] = [];
  for (const token of input.split(',')) {
    const part = token.trim();
    if (!part) throw new Error('页面顺序中不能包含空白项');
    const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(part);
    if (!match) throw new Error('页面顺序格式错误，请使用 3,1-2,2');
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
        first > totalPages || last > totalPages) {
      throw new Error('页面顺序包含超出范围的页码');
    }
    const step = first <= last ? 1 : -1;
    for (let n = first; ; n += step) {
      order.push(n);
      if (order.length > 500) throw new Error('一次最多整理 500 页');
      if (n === last) break;
    }
  }
  return order;
}

export async function deletePdfPages(file: File, range: string): Promise<File> {
  const pdf = await loadPdf(file);
  if (!range.trim()) throw new Error('请输入要删除的页码');
  const selected = parsePageRanges(range, pdf.getPageCount());
  if (selected.length >= pdf.getPageCount()) throw new Error('不能删除全部页面');
  for (const number of [...selected].reverse()) pdf.removePage(number - 1);
  return asFile(await pdf.save(), `${baseName(file.name)}-deleted.pdf`);
}

export async function reorderPdfPages(file: File, order: string): Promise<File> {
  const source = await loadPdf(file);
  const selected = parsePageOrder(order, source.getPageCount());
  const pdf = await PDFDocument.create();
  const pages = await pdf.copyPages(source, selected.map((page) => page - 1));
  pages.forEach((page) => pdf.addPage(page));
  return asFile(await pdf.save(), `${baseName(file.name)}-organized.pdf`);
}

export async function insertBlankPages(file: File, afterPage: number, count: number): Promise<File> {
  const pdf = await loadPdf(file);
  const total = pdf.getPageCount();
  if (!Number.isInteger(afterPage) || afterPage < 0 || afterPage > total ||
      !Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('插入位置或数量无效（一次最多 20 页）');
  }
  const sample = pdf.getPage(Math.max(0, Math.min(total - 1, afterPage - 1)));
  const size = sample.getSize();
  for (let i = 0; i < count; i += 1) pdf.insertPage(afterPage + i, [size.width, size.height]);
  return asFile(await pdf.save(), `${baseName(file.name)}-with-blanks.pdf`);
}

export async function addPageNumbers(
  file: File, options: { start: number; position: 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-center'; range: string },
): Promise<File> {
  const pdf = await loadPdf(file);
  if (!Number.isInteger(options.start) || options.start < 0 || options.start > 999999) {
    throw new Error('起始页码无效');
  }
  const pages = parsePageRanges(options.range, pdf.getPageCount());
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pages.forEach((number, index) => {
    const page = pdf.getPage(number - 1);
    const { width, height } = page.getSize();
    const label = String(options.start + index);
    const textWidth = font.widthOfTextAtSize(label, 11);
    const x = options.position === 'bottom-left' ? 28 :
      options.position === 'bottom-right' ? width - textWidth - 28 :
      (width - textWidth) / 2;
    const y = options.position === 'top-center' ? height - 28 : 24;
    page.drawText(label, { x, y, font, size: 11, color: rgb(0.22, 0.22, 0.22) });
  });
  return asFile(await pdf.save(), `${baseName(file.name)}-numbered.pdf`);
}

async function textWatermarkPng(text: string): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas');
  ctx.font = 'bold 76px sans-serif';
  canvas.width = Math.min(2400, Math.ceil(ctx.measureText(text).width) + 80);
  canvas.height = 140;
  ctx.font = 'bold 76px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#777777';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 40);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('无法生成水印')), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function watermarkPdf(
  file: File, text: string, opacity: number, range: string,
): Promise<File> {
  const content = text.trim();
  if (!content || content.length > 80) throw new Error('水印文字需要在 1–80 字之间');
  if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) throw new Error('透明度必须为 0.05–1');
  const pdf = await loadPdf(file);
  const image = await pdf.embedPng(await textWatermarkPng(content));
  for (const number of parsePageRanges(range, pdf.getPageCount())) {
    const page = pdf.getPage(number - 1);
    const { width, height } = page.getSize();
    const imageWidth = Math.min(width * 0.8, 400);
    const imageHeight = imageWidth * image.height / image.width;
    const angle = 35 * Math.PI / 180;
    page.drawImage(image, {
      x: width / 2 - imageWidth * Math.cos(angle) / 2 + imageHeight * Math.sin(angle) / 2,
      y: height / 2 - imageWidth * Math.sin(angle) / 2 - imageHeight * Math.cos(angle) / 2,
      width: imageWidth,
      height: imageHeight,
      rotate: degrees(35),
      opacity,
    });
  }
  return asFile(await pdf.save(), `${baseName(file.name)}-watermarked.pdf`);
}

export async function cropPdf(file: File, marginMm: number, range: string): Promise<File> {
  if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 100) {
    throw new Error('裁剪边距必须在 0–100 毫米之间');
  }
  const pdf = await loadPdf(file);
  const margin = marginMm * 72 / 25.4;
  for (const number of parsePageRanges(range, pdf.getPageCount())) {
    const page = pdf.getPage(number - 1);
    const { width, height } = page.getSize();
    if (margin * 2 >= Math.min(width, height)) throw new Error('裁剪边距超过页面尺寸');
    page.setCropBox(margin, margin, width - margin * 2, height - margin * 2);
  }
  return asFile(await pdf.save(), `${baseName(file.name)}-cropped.pdf`);
}

export async function editPdfMetadata(
  file: File, info: { title: string; author: string; subject: string; keywords: string; clear: boolean },
): Promise<File> {
  const pdf = await loadPdf(file);
  const title = info.clear ? '' : info.title;
  const author = info.clear ? '' : info.author;
  const subject = info.clear ? '' : info.subject;
  const keywords = info.clear ? [] : info.keywords.split(/[,，]/).map((value) => value.trim()).filter(Boolean);
  pdf.setTitle(title);
  pdf.setAuthor(author);
  pdf.setSubject(subject);
  pdf.setKeywords(keywords);
  if (info.clear) { pdf.setCreator(''); pdf.setProducer(''); }
  return asFile(await pdf.save(), `${baseName(file.name)}-metadata.pdf`);
}

async function embedRasterImage(pdf: PDFDocument, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  if (isPng) return pdf.embedPng(bytes);
  if (isJpeg) return pdf.embedJpg(bytes);
  throw new Error('仅支持 PNG、JPEG 图片；其他格式请先用图片工作台转换');
}

export async function imagesToPdf(files: File[], paper: 'a4' | 'original'): Promise<File> {
  if (!files.length || files.length > 100) throw new Error('请选择 1–100 张图片');
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const image = await embedRasterImage(pdf, file);
    const landscape = image.width > image.height;
    const [pageWidth, pageHeight] = paper === 'a4'
      ? (landscape ? [841.89, 595.28] : [595.28, 841.89])
      : [Math.min(14400, image.width * .75), Math.min(14400, image.height * .75)];
    const page = pdf.addPage([pageWidth, pageHeight]);
    const margin = paper === 'a4' ? 24 : 0;
    const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, { x: (pageWidth - w) / 2, y: (pageHeight - h) / 2, width: w, height: h });
  }
  return asFile(await pdf.save(), 'paperlab-images.pdf');
}

export async function stampPdf(
  file: File, stamp: File, range: string, widthPercent: number,
  position: 'center' | 'top-right' | 'bottom-right',
): Promise<File> {
  if (widthPercent < 5 || widthPercent > 80 || !Number.isFinite(widthPercent)) {
    throw new Error('图片宽度应在页面的 5%–80% 之间');
  }
  const pdf = await loadPdf(file);
  const image = await embedRasterImage(pdf, stamp);
  for (const number of parsePageRanges(range, pdf.getPageCount())) {
    const page = pdf.getPage(number - 1);
    const { width, height } = page.getSize();
    const w = width * widthPercent / 100;
    const h = w * image.height / image.width;
    if (h > height - 30) throw new Error('图片太高，请缩小印章宽度');
    const x = position === 'center' ? (width - w) / 2 : width - w - 18;
    const y = position === 'top-right' ? height - h - 18 : position === 'center' ? (height - h) / 2 : 18;
    page.drawImage(image, { x, y, width: w, height: h });
  }
  return asFile(await pdf.save(), `${baseName(file.name)}-stamped.pdf`);
}

export async function flattenPdfForms(file: File): Promise<File> {
  const pdf = await loadPdf(file);
  const form = pdf.getForm();
  if (form.getFields().length === 0) throw new Error('此 PDF 没有可扁平化的 AcroForm 表单字段');
  form.flatten();
  return asFile(await pdf.save(), `${baseName(file.name)}-flattened.pdf`);
}


export async function insertPdfPages(file: File, addition: File, afterPage: number, range: string): Promise<File> {
  const pdf = await loadPdf(file);
  const source = await loadPdf(addition);
  if (!Number.isInteger(afterPage) || afterPage < 0 || afterPage > pdf.getPageCount()) {
    throw new Error('插入位置无效');
  }
  const selected = parsePageRanges(range, source.getPageCount());
  if (selected.length > 100) throw new Error('一次最多插入 100 页');
  const copied = await pdf.copyPages(source, selected.map((number) => number - 1));
  copied.forEach((page, index) => pdf.insertPage(afterPage + index, page));
  return asFile(await pdf.save(), `${baseName(file.name)}-inserted.pdf`);
}

export async function splitPdfByPage(file: File, range: string): Promise<File[]> {
  const source = await loadPdf(file);
  const selected = parsePageRanges(range, source.getPageCount());
  if (selected.length > 50) throw new Error('每次最多拆分 50 个单页文件');
  const result: File[] = [];
  for (const number of selected) {
    const pdf = await PDFDocument.create();
    const [page] = await pdf.copyPages(source, [number - 1]);
    pdf.addPage(page);
    result.push(asFile(await pdf.save(),
      `${baseName(file.name)}-page-${String(number).padStart(3, '0')}.pdf`));
  }
  return result;
}

export async function resizePdfPages(
  file: File, paper: 'a4' | 'a3' | 'letter', orientation: 'portrait' | 'landscape',
): Promise<File> {
  const dimensions = paper === 'a3' ? [841.89, 1190.55] :
    paper === 'letter' ? [612, 792] : [595.28, 841.89];
  const [width, height] = orientation === 'landscape' ? [dimensions[1], dimensions[0]] : dimensions;
  const pdf = await loadPdf(file);
  for (const page of pdf.getPages()) {
    const old = page.getSize();
    const scale = Math.min(width / old.width, height / old.height);
    const dx = (width - old.width * scale) / 2;
    const dy = (height - old.height * scale) / 2;
    page.scaleContent(scale, scale);
    page.scaleAnnotations(scale, scale);
    page.translateContent(dx, dy);
    page.setSize(width, height);
  }
  return asFile(await pdf.save(), `${baseName(file.name)}-${paper}-resized.pdf`);
}

export async function nupPdf(file: File, layout: 2 | 4): Promise<File> {
  if (layout !== 2 && layout !== 4) throw new Error('仅支持 2 合 1 或 4 合 1');
  const source = await loadPdf(file);
  const output = await PDFDocument.create();
  // embedPdf defaults to page 1 only; pass all page indices explicitly.
  const pages = await output.embedPdf(new Uint8Array(await file.arrayBuffer()), source.getPageIndices());
  const cols = 2;
  const rows = layout === 2 ? 1 : 2;
  const width = layout === 2 ? 841.89 : 595.28;
  const height = layout === 2 ? 595.28 : 841.89;
  const margin = 22;
  const gap = 10;
  const cellWidth = (width - 2 * margin - gap * (cols - 1)) / cols;
  const cellHeight = (height - 2 * margin - gap * (rows - 1)) / rows;
  for (let i = 0; i < pages.length; i += layout) {
    const sheet = output.addPage([width, height]);
    for (let slot = 0; slot < layout && i + slot < pages.length; slot += 1) {
      const src = pages[i + slot];
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const scale = Math.min(cellWidth / src.width, cellHeight / src.height);
      const w = src.width * scale;
      const h = src.height * scale;
      const x = margin + col * (cellWidth + gap) + (cellWidth - w) / 2;
      const y = height - margin - (row + 1) * cellHeight - row * gap + (cellHeight - h) / 2;
      sheet.drawPage(src, { x, y, width: w, height: h });
    }
  }
  return asFile(await output.save(), `${baseName(file.name)}-${layout}up.pdf`);
}


export interface PdfFormField {
  name: string;
  type: 'text' | 'checkbox' | 'choice' | 'unsupported';
  value: string | boolean;
  options: string[];
}

export async function inspectPdfForm(file: File): Promise<PdfFormField[]> {
  const pdf = await loadPdf(file);
  return pdf.getForm().getFields().map((field) => {
    const name = field.getName();
    if (field instanceof PDFTextField) {
      return { name, type: 'text' as const, value: field.getText() || '', options: [] };
    }
    if (field instanceof PDFCheckBox) {
      return { name, type: 'checkbox' as const, value: field.isChecked(), options: [] };
    }
    if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
      const selected = field.getSelected();
      return {
        name, type: 'choice' as const,
        value: Array.isArray(selected) ? selected[0] || '' : selected || '',
        options: field.getOptions(),
      };
    }
    return { name, type: 'unsupported' as const, value: '', options: [] };
  });
}

export async function fillPdfForm(file: File, values: Record<string, string | boolean>): Promise<File> {
  const pdf = await loadPdf(file);
  const fields = pdf.getForm().getFields();
  if (!fields.length) throw new Error('没有检测到可填写的 AcroForm 字段');
  let changes = 0;
  for (const field of fields) {
    const name = field.getName();
    if (!Object.prototype.hasOwnProperty.call(values, name)) continue;
    const value = values[name];
    if (field instanceof PDFTextField && typeof value === 'string') {
      field.setText(value.slice(0, 1000));
      changes += 1;
    } else if (field instanceof PDFCheckBox && typeof value === 'boolean') {
      if (value) field.check(); else field.uncheck();
      changes += 1;
    } else if ((field instanceof PDFDropdown || field instanceof PDFRadioGroup) &&
               typeof value === 'string' && value && field.getOptions().includes(value)) {
      field.select(value);
      changes += 1;
    }
  }
  if (!changes) throw new Error('没有找到可填写或可修改的字段');
  try {
    return asFile(await pdf.save(), `${baseName(file.name)}-filled.pdf`);
  } catch (error) {
    if (/WinAnsi|encode|encoding|unicode/i.test(error instanceof Error ? error.message : '')) {
      throw new Error('此表单默认字体无法显示某些字符（如中文）；需要支持该字符集的自定义嵌入字体');
    }
    throw error;
  }
}
