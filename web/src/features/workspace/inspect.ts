import { getPdfInfo } from '../tools/pdf/operations';
import { inspectImage, type ImageInfo } from '../tools/image/operations';
import type {
  PlannerFileMeta,
  WorkspaceFileKind,
  WorkspaceFileMeta,
} from '../assistant/types';

export const MAX_WORKSPACE_FILE_BYTES = 50 * 1024 * 1024;

export function createFileId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `file-${suffix}`;
}

export function fileKind(file: File): WorkspaceFileKind {
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(file.name)) return 'image';
  if (file.type === 'text/plain' || /\.txt$/i.test(file.name)) return 'text';
  return 'pdf';
}

export function isPdf(file: File): boolean {
  return fileKind(file) === 'pdf';
}

export function isImage(file: File): boolean {
  return fileKind(file) === 'image';
}

async function pdfHasText(file: File): Promise<{ pageCount: number; hasTextLayer: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  let document: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']> | null = null;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      disableFontFace: true,
      isEvalSupported: false,
    }).promise;
    let hasTextLayer = false;
    for (let pageNumber = 1; pageNumber <= Math.min(3, document.numPages); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      if (content.items.some((item) => 'str' in item && item.str.trim().length > 0)) {
        hasTextLayer = true;
      }
      page.cleanup();
      if (hasTextLayer) break;
    }
    return { pageCount: document.numPages, hasTextLayer };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/password|encrypt/i.test(message)) {
      throw new Error('该 PDF 已加密，请先移除密码后再使用');
    }
    throw new Error('无法读取该 PDF，文件可能已损坏或格式不受支持');
  } finally {
    if (document) await document.destroy().catch(() => undefined);
  }
}

export async function inspectWorkspaceFile(
  file: File,
  source: WorkspaceFileMeta['source'] = 'upload',
): Promise<WorkspaceFileMeta> {
  if (!(file instanceof File)) throw new Error('文件对象无效');
  if (file.size <= 0) throw new Error('文件为空');
  if (file.size > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error('单个文件不能超过 50 MB');
  }
  const kind = fileKind(file);
  const base: WorkspaceFileMeta = {
    fileId: createFileId(),
    kind,
    name: file.name || '未命名文件',
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    source,
    createdAt: Date.now(),
  };

  if (kind === 'pdf') {
    const info = await getPdfInfo(file);
    let hasTextLayer: boolean | undefined;
    if (navigator.onLine !== false) {
      try {
        const textInfo = await pdfHasText(file);
        if (info.pageCount !== textInfo.pageCount) {
          throw new Error('PDF 页数校验失败，请重新选择文件');
        }
        hasTextLayer = textInfo.hasTextLayer;
      } catch (error) {
        // Text-layer detection is optional for local transforms. Do not fail an
        // offline upload because the PDF.js worker chunk was not cached yet.
        if (error instanceof Error && /页数校验失败/.test(error.message)) throw error;
        hasTextLayer = undefined;
      }
    }
    return {
      ...base,
      pageCount: info.pageCount,
      ...(hasTextLayer !== undefined ? { hasTextLayer } : {}),
    };
  }

  if (kind === 'image') {
    const info: ImageInfo = await inspectImage(file);
    return {
      ...base,
      mimeType: info.type || base.mimeType,
      width: info.width,
      height: info.height,
      sizeBytes: info.size,
    };
  }

  return base;
}

export function plannerMetadata(meta: WorkspaceFileMeta): PlannerFileMeta {
  return {
    fileId: meta.fileId,
    kind: meta.kind,
    sizeBytes: meta.sizeBytes,
    ...(meta.pageCount !== undefined ? { pageCount: meta.pageCount } : {}),
    ...(meta.width !== undefined ? { width: meta.width } : {}),
    ...(meta.height !== undefined ? { height: meta.height } : {}),
    ...(meta.hasTextLayer !== undefined ? { hasTextLayer: meta.hasTextLayer } : {}),
  };
}

export function describeFile(meta: WorkspaceFileMeta): string {
  if (meta.kind === 'pdf') {
    const text = meta.hasTextLayer === true ? '含文字层' : meta.hasTextLayer === false ? '无文字层' : '文字层未检测';
    return `PDF · ${meta.pageCount ?? 0} 页 · ${text}`;
  }
  if (meta.kind === 'image') {
    return `图片 · ${meta.width ?? 0} × ${meta.height ?? 0}`;
  }
  return '文本文件';
}
