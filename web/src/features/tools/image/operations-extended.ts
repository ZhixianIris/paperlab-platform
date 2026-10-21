/**
 * Local-only raster image tools. Uses the same validated decoder and canvas
 * limits as the original image module. No network calls or extra dependencies.
 *
 * Privacy note: blur and mosaic are cosmetic, NOT secure redaction. To truly
 * remove pixels in a selected region use 'mask' and export a flattened image.
 */
import {
  baseName, canvasToBlob, decode, extensionFor, prepareCanvas,
  type OutputFormat,
} from './operations';

export type ImageTransform =
  | 'rotate' | 'flip' | 'adjust' | 'watermark' | 'frame'
  | 'round' | 'pixelate' | 'blur' | 'mask' | 'background' | 'replace-background'
  | 'strip';

export interface ImageTransformOptions {
  format: OutputFormat;
  quality: number;
  angle: 90 | 180 | 270;
  direction: 'horizontal' | 'vertical';
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  sepia: number;
  blurRadius: number;
  text: string;
  textSize: number;
  opacity: number;
  color: string;
  background: string;
  position: 'top-left' | 'center' | 'bottom-right';
  border: number;
  cornerRadius: number;
  tolerance: number;
  region: { x: number; y: number; width: number; height: number };
  mosaicSize: number;
}

function colorRgb(input: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(input);
  if (!match) throw new Error('颜色值应为 #RRGGBB');
  const value = match[1];
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16)) as [number, number, number];
}

function selectedRegion(options: ImageTransformOptions, width: number, height: number) {
  const { x, y, width: w, height: h } = options.region;
  if (![x, y, w, h].every((number) => Number.isFinite(number) && number >= 0 && number <= 1) ||
      w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) {
    throw new Error('处理区域必须位于图片内部');
  }
  return {
    x: Math.floor(x * width),
    y: Math.floor(y * height),
    width: Math.max(1, Math.floor(w * width)),
    height: Math.max(1, Math.floor(h * height)),
  };
}

function watermarkPosition(
  position: ImageTransformOptions['position'], width: number, height: number,
  textWidth: number, size: number,
) {
  const margin = Math.max(16, size * .5);
  if (position === 'top-left') return { x: margin, y: margin + size };
  if (position === 'bottom-right') return { x: Math.max(margin, width - textWidth - margin), y: height - margin };
  return { x: (width - textWidth) / 2, y: (height + size * .7) / 2 };
}

export async function transformImage(
  file: File, operation: ImageTransform, options: ImageTransformOptions,
): Promise<File> {
  const decoded = await decode(file);
  try {
    const { width, height, source } = decoded;
    const rotated = operation === 'rotate' && options.angle !== 180;
    const pad = operation === 'frame' ? options.border : 0;
    if (!Number.isInteger(pad) || pad < 0 || pad > 200) throw new Error('边框尺寸必须在 0–200 px');
    const outWidth = (rotated ? height : width) + 2 * pad;
    const outHeight = (rotated ? width : height) + 2 * pad;
    const { canvas, context: ctx } = prepareCanvas(outWidth, outHeight);
    if (options.format === 'image/jpeg' || operation === 'frame' || operation === 'replace-background') {
      ctx.fillStyle = operation === 'frame' ? options.color : options.background;
      ctx.fillRect(0, 0, outWidth, outHeight);
    }

    if (operation === 'rotate') {
      ctx.translate(outWidth / 2, outHeight / 2);
      ctx.rotate(options.angle * Math.PI / 180);
      ctx.drawImage(source, -width / 2, -height / 2);
      ctx.resetTransform();
    } else if (operation === 'flip') {
      ctx.translate(options.direction === 'horizontal' ? width : 0, options.direction === 'vertical' ? height : 0);
      ctx.scale(options.direction === 'horizontal' ? -1 : 1, options.direction === 'vertical' ? -1 : 1);
      ctx.drawImage(source, 0, 0);
      ctx.resetTransform();
    } else if (operation === 'adjust') {
      ctx.filter =
        `brightness(${options.brightness}%) contrast(${options.contrast}%) saturate(${options.saturation}%) grayscale(${options.grayscale}%) sepia(${options.sepia}%) blur(${options.blurRadius}px)`;
      ctx.drawImage(source, 0, 0);
      ctx.filter = 'none';
    } else if (operation === 'round') {
      const radius = options.cornerRadius;
      if (!Number.isFinite(radius) || radius < 0 || radius > Math.min(width, height) / 2) {
        throw new Error('圆角半径不能超过图片短边的一半');
      }
      ctx.beginPath();
      ctx.roundRect(0, 0, width, height, radius);
      ctx.clip();
      ctx.drawImage(source, 0, 0);
    } else if (operation === 'frame') {
      ctx.drawImage(source, pad, pad);
    } else {
      ctx.drawImage(source, 0, 0);
    }

    if (operation === 'watermark') {
      const text = options.text.trim();
      if (!text || text.length > 100) throw new Error('水印文字长度必须为 1–100 字');
      if (!Number.isFinite(options.textSize) || options.textSize < 8 || options.textSize > 160) {
        throw new Error('文字大小必须在 8–160 之间');
      }
      ctx.save();
      ctx.font = `600 ${options.textSize}px sans-serif`;
      ctx.fillStyle = options.color;
      ctx.globalAlpha = Math.max(.05, Math.min(1, options.opacity / 100));
      ctx.textBaseline = 'alphabetic';
      const measured = ctx.measureText(text).width;
      const placement = watermarkPosition(options.position, width, height, measured, options.textSize);
      ctx.fillText(text, placement.x, placement.y, Math.max(5, width - 20));
      ctx.restore();
    }

    if (operation === 'pixelate' || operation === 'blur' || operation === 'mask') {
      const rect = selectedRegion(options, width, height);
      if (operation === 'mask') {
        ctx.fillStyle = options.color;
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      } else if (operation === 'pixelate') {
        const cell = Math.max(2, Math.min(80, Math.floor(options.mosaicSize)));
        const block = prepareCanvas(
          Math.max(1, Math.ceil(rect.width / cell)),
          Math.max(1, Math.ceil(rect.height / cell)),
        );
        block.context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0,
          block.canvas.width, block.canvas.height);
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(block.canvas, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
        block.canvas.width = 0;
        block.canvas.height = 0;
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
        ctx.clip();
        ctx.filter = `blur(${Math.max(1, Math.min(50, options.blurRadius))}px)`;
        ctx.drawImage(source, 0, 0);
        ctx.restore();
      }
    }

    if (operation === 'background') {
      // Single-color background transparency, not semantic AI segmentation.
      const [r, g, b] = colorRgb(options.background);
      if (!Number.isFinite(options.tolerance) || options.tolerance < 0 || options.tolerance > 200) {
        throw new Error('背景色容差应在 0–200 之间');
      }
      const data = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < data.data.length; i += 4) {
        const distance = Math.hypot(data.data[i] - r, data.data[i + 1] - g, data.data[i + 2] - b) / Math.sqrt(3);
        const alpha = Math.max(0, Math.min(1, (distance - options.tolerance) / 20));
        data.data[i + 3] = Math.round(data.data[i + 3] * alpha);
      }
      ctx.putImageData(data, 0, 0);
    }

    let format = options.format;
    if (operation === 'background' || operation === 'round') format = 'image/png';
    if (operation === 'strip' && format === 'image/jpeg') {
      // JPEG naturally clears transparency onto white, not black.
      // The background was filled above.
    }
    const blob = await canvasToBlob(canvas, format, options.quality);
    if (blob.type !== format) throw new Error('浏览器不支持该输出格式');
    canvas.width = 0;
    canvas.height = 0;
    return new File([blob], `${baseName(file.name)}-${operation}.${extensionFor(format)}`, { type: format });
  } finally {
    decoded.close();
  }
}

export type ImageArrangement = 'horizontal' | 'vertical' | 'grid-2' | 'grid-3';
export async function composeImages(
  files: File[], arrangement: ImageArrangement, gap: number, background: string,
): Promise<File> {
  if (files.length < 2 || files.length > 12) throw new Error('请选择 2–12 张图片');
  if (!Number.isInteger(gap) || gap < 0 || gap > 100) throw new Error('间距必须在 0–100 px 之间');
  const decoded: Array<Awaited<ReturnType<typeof decode>>> = [];
  try {
    for (const file of files) decoded.push(await decode(file));
    const columns = arrangement === 'horizontal' ? decoded.length :
      arrangement === 'vertical' ? 1 : arrangement === 'grid-2' ? 2 : 3;
    const rows = Math.ceil(decoded.length / columns);
    const cellWidth = Math.max(...decoded.map((item) => item.width));
    const cellHeight = Math.max(...decoded.map((item) => item.height));
    const width = columns * cellWidth + Math.max(0, columns - 1) * gap;
    const height = rows * cellHeight + Math.max(0, rows - 1) * gap;
    const { canvas, context: ctx } = prepareCanvas(width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    decoded.forEach((item, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const scale = Math.min(cellWidth / item.width, cellHeight / item.height, 1);
      const w = item.width * scale;
      const h = item.height * scale;
      ctx.drawImage(item.source,
        col * (cellWidth + gap) + (cellWidth - w) / 2,
        row * (cellHeight + gap) + (cellHeight - h) / 2,
        w, h);
    });
    const blob = await canvasToBlob(canvas, 'image/png', 95);
    canvas.width = 0;
    canvas.height = 0;
    return new File([blob], 'paperlab-collage.png', { type: 'image/png' });
  } finally {
    for (const item of decoded) item.close();
  }
}
