/**
 * Canvas image operations inspired by OmniTools' MIT-licensed resize/crop and
 * converter services (commit dda3a240772459035eb38b14c5c7d94e81626116).
 * All decoding, drawing, encoding and compression happen in the browser.
 */
import imageCompression from 'browser-image-compression';

export type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ImageInfo {
  width: number;
  height: number;
  type: string;
  size: number;
}

const MAX_PIXELS = 40_000_000;
const MAX_BYTES = 50 * 1024 * 1024;

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';

export function formatLabel(type: string): string {
  switch (type) {
    case 'image/png':
      return 'PNG';
    case 'image/jpeg':
      return 'JPEG';
    case 'image/webp':
      return 'WebP';
    default:
      return type.replace('image/', '').toUpperCase();
  }
}

export function extensionFor(type: string): string {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return 'png';
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || 'image';
}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (file.size > MAX_BYTES) throw new Error('图片不能超过 50 MB');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('仅支持 PNG、JPEG、WebP 图片');
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > MAX_PIXELS) {
        bitmap.close();
        throw new Error('图片像素过大，请先缩小后再处理');
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('像素过大')) throw error;
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片解码失败，请更换文件'));
      element.src = url;
    });
    if (image.naturalWidth * image.naturalHeight > MAX_PIXELS) {
      throw new Error('图片像素过大，请先缩小后再处理');
    }
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {},
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function inspectImage(file: File): Promise<ImageInfo> {
  const decoded = await decode(file);
  try {
    return {
      width: decoded.width,
      height: decoded.height,
      type: file.type,
      size: file.size,
    };
  } finally {
    decoded.close();
  }
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: OutputFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('浏览器无法编码该图片格式'));
      },
      type,
      Math.min(1, Math.max(0.05, quality / 100)),
    );
  });
}

function prepareCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  if (width < 1 || height < 1) throw new Error('输出尺寸必须大于 0');
  if (width * height > MAX_PIXELS) throw new Error('输出像素过大，请减小尺寸');
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('当前浏览器不支持 Canvas');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

function fillBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: OutputFormat,
  background: string,
): void {
  if (type !== 'image/jpeg') return;
  context.fillStyle = background || '#ffffff';
  context.fillRect(0, 0, width, height);
}

export interface CropOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  format: OutputFormat;
  quality: number;
}

export async function cropImage(file: File, options: CropOptions): Promise<File> {
  const decoded = await decode(file);
  try {
    const x = Math.max(0, Math.min(options.x, decoded.width - 1));
    const y = Math.max(0, Math.min(options.y, decoded.height - 1));
    const width = Math.max(1, Math.min(options.width, decoded.width - x));
    const height = Math.max(1, Math.min(options.height, decoded.height - y));
    const { canvas, context } = prepareCanvas(width, height);
    fillBackground(context, width, height, options.format, '#ffffff');
    context.drawImage(decoded.source, x, y, width, height, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, options.format, options.quality);
    return new File([blob], `${baseName(file.name)}-crop.${extensionFor(options.format)}`, {
      type: options.format,
    });
  } finally {
    decoded.close();
  }
}

export interface ResizeOptions {
  mode: 'pixels' | 'percent';
  width: number;
  height: number;
  percent: number;
  keepAspect: boolean;
  format: OutputFormat;
  quality: number;
}

export async function resizeImage(file: File, options: ResizeOptions): Promise<File> {
  const decoded = await decode(file);
  try {
    let width: number;
    let height: number;
    if (options.mode === 'percent') {
      const scale = Math.max(1, Math.min(500, options.percent)) / 100;
      width = Math.round(decoded.width * scale);
      height = Math.round(decoded.height * scale);
    } else if (options.keepAspect) {
      if (options.width > 0) {
        width = options.width;
        height = Math.round((options.width / decoded.width) * decoded.height);
      } else {
        height = options.height;
        width = Math.round((options.height / decoded.height) * decoded.width);
      }
    } else {
      width = options.width;
      height = options.height;
    }
    const { canvas, context } = prepareCanvas(width, height);
    fillBackground(context, width, height, options.format, '#ffffff');
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, options.format, options.quality);
    return new File([blob], `${baseName(file.name)}-${width}x${height}.${extensionFor(options.format)}`, {
      type: options.format,
    });
  } finally {
    decoded.close();
  }
}

export interface ConvertOptions {
  format: OutputFormat;
  quality: number;
  background: string;
}

export async function convertImage(file: File, options: ConvertOptions): Promise<File> {
  const decoded = await decode(file);
  try {
    const { canvas, context } = prepareCanvas(decoded.width, decoded.height);
    fillBackground(context, decoded.width, decoded.height, options.format, options.background);
    context.drawImage(decoded.source, 0, 0);
    const blob = await canvasToBlob(canvas, options.format, options.quality);
    return new File([blob], `${baseName(file.name)}.${extensionFor(options.format)}`, {
      type: options.format,
    });
  } finally {
    decoded.close();
  }
}

export interface CompressOptions {
  maxSizeMB: number;
  quality: number;
  maxDimension: number;
}

export async function compressImage(file: File, options: CompressOptions): Promise<File> {
  const compressed = await imageCompression(file, {
    maxSizeMB: Math.max(0.05, options.maxSizeMB),
    maxWidthOrHeight: Math.max(256, options.maxDimension || 4096),
    useWebWorker: true,
    initialQuality: Math.min(1, Math.max(0.05, options.quality / 100)),
    fileType: file.type,
    preserveExif: true,
  });
  const type = (file.type || compressed.type) as OutputFormat;
  return new File([compressed], `${baseName(file.name)}-compressed.${extensionFor(type)}`, {
    type,
  });
}
