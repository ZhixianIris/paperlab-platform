import type { WorkspaceFileKind } from './types';
import {
  mergePdfs,
  extractPdfPages,
  rotatePdf,
} from '../tools/pdf/operations';
import {
  deletePdfPages,
  reorderPdfPages,
  insertBlankPages,
  addPageNumbers,
  watermarkPdf,
  cropPdf,
  editPdfMetadata,
  imagesToPdf,
  stampPdf,
  flattenPdfForms,
  insertPdfPages,
  splitPdfByPage,
  resizePdfPages,
  nupPdf,
  fillPdfForm,
} from '../tools/pdf/operations-extended';
import { exportPdfImages, extractPdfText, rasterPdf } from '../tools/pdf/render';
import {
  cropImage,
  resizeImage,
  convertImage,
  compressImage,
  type OutputFormat,
} from '../tools/image/operations';
import {
  transformImage,
  composeImages,
  type ImageTransform,
  type ImageTransformOptions,
  type ImageArrangement,
} from '../tools/image/operations-extended';
import { ALL_TOOLS } from '../../lib/tools';
import { toolLabel } from '../../lib/format';

export interface ToolAdapter {
  key: string;
  title: string;
  group: 'pdf' | 'image';
  acceptedKinds: WorkspaceFileKind[];
  inputCount: 'one' | 'multiple' | 'two';
  outputKind: 'file' | 'files';
  requiresUserRegion: boolean;
  manualOnly: boolean;
  lossy: boolean;
  preservesNativePdfText: boolean;
  requiresConfirmation: boolean;
  needsCloud: false;
  manualPath: string;
  validateArgs: (args: Record<string, unknown>) => Record<string, unknown>;
  execute: (files: File[], args: Record<string, unknown>) => Promise<File | File[]>;
}

const IMAGE_DEFAULTS: ImageTransformOptions = {
  format: 'image/png',
  quality: 90,
  angle: 90,
  direction: 'horizontal',
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  sepia: 0,
  blurRadius: 0,
  text: 'PaperLab',
  textSize: 32,
  opacity: 30,
  color: '#111111',
  background: '#ffffff',
  position: 'bottom-right',
  border: 24,
  cornerRadius: 30,
  tolerance: 28,
  mosaicSize: 16,
  region: { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
};

type Args = Record<string, unknown>;
const FORMATS = new Set<OutputFormat>(['image/png', 'image/jpeg', 'image/webp']);
const PATH_BY_KEY = new Map(ALL_TOOLS.map((tool) => [tool.key, tool.path]));

function fails(message: string): never {
  throw new Error(message);
}

function object(args: Args): Args {
  if (!args || typeof args !== 'object' || Array.isArray(args)) fails('计划参数必须是对象');
  return args;
}

function only(args: Args, allowed: string[]): Args {
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length) fails(`计划包含不支持的参数：${unknown.join(', ')}`);
  return args;
}

function text(args: Args, key: string, fallback?: string, max = 200): string {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string') fails(`${key} 必须是文本`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) fails(`${key} 长度无效`);
  if (/^(?:https?|file|javascript):/i.test(trimmed) || trimmed.includes('\u0000')) {
    fails(`${key} 包含不允许的内容`);
  }
  return trimmed;
}

function optionalText(args: Args, key: string, max = 200): string {
  if (args[key] === undefined || args[key] === null || args[key] === '') return '';
  return text(args, key, '', max);
}

function number(args: Args, key: string, min: number, max: number, fallback?: number): number {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fails(`${key} 必须是 ${min}–${max} 的数字`);
  }
  return value;
}

function integer(args: Args, key: string, min: number, max: number, fallback?: number): number {
  const value = number(args, key, min, max, fallback);
  if (!Number.isInteger(value)) fails(`${key} 必须是整数`);
  return value;
}

function boolean(args: Args, key: string, fallback = false): boolean {
  const value = args[key] ?? fallback;
  if (typeof value !== 'boolean') fails(`${key} 必须是布尔值`);
  return value;
}

function oneOf<T extends string | number>(args: Args, key: string, values: readonly T[], fallback?: T): T {
  const value = (args[key] ?? fallback) as T;
  if (!values.includes(value)) fails(`${key} 取值无效`);
  return value;
}

function range(args: Args, key = 'range', fallback = ''): string {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string' || value.length > 200) fails('页码范围格式无效');
  if (value && !/^[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*$/.test(value)) {
    fails('页码范围必须使用 1,3-5 形式');
  }
  return value;
}

function order(args: Args): string {
  const value = text(args, 'order', '', 250);
  if (!/^[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*$/.test(value)) {
    fails('页面顺序必须使用 3,1-2,2 形式');
  }
  return value;
}

function format(args: Args, fallback: OutputFormat = 'image/png'): OutputFormat {
  const value = oneOf(args, 'format', ['image/png', 'image/jpeg', 'image/webp'] as const, fallback);
  if (!FORMATS.has(value)) fails('图片格式无效');
  return value;
}

function color(args: Args, key: string, fallback: string): string {
  const value = (args[key] ?? fallback) as string;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fails(`${key} 必须是 #RRGGBB`);
  return value;
}

function region(args: Args): ImageTransformOptions['region'] {
  const value = args.region;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fails('需要区域参数');
  const source = value as Record<string, unknown>;
  const keys = ['x', 'y', 'width', 'height'];
  if (Object.keys(source).some((key) => !keys.includes(key))) fails('区域参数包含未知字段');
  const output = {} as ImageTransformOptions['region'];
  for (const key of keys) {
    const part = source[key];
    if (typeof part !== 'number' || !Number.isFinite(part) || part < 0 || part > 1) {
      fails('区域参数必须是 0–1 之间的数字');
    }
    output[key as keyof typeof output] = part;
  }
  if (output.width <= 0 || output.height <= 0 || output.x + output.width > 1.0001 || output.y + output.height > 1.0001) {
    fails('区域必须位于图片内部');
  }
  return output;
}

function imageOptions(args: Args, overrides: Partial<ImageTransformOptions> = {}): ImageTransformOptions {
  object(args);
  return {
    ...IMAGE_DEFAULTS,
    ...(args.format !== undefined ? { format: format(args) } : {}),
    ...(args.quality !== undefined ? { quality: number(args, 'quality', 30, 100, 90) } : {}),
    ...(args.angle !== undefined ? { angle: oneOf(args, 'angle', [90, 180, 270] as const, 90) } : {}),
    ...(args.direction !== undefined ? { direction: oneOf(args, 'direction', ['horizontal', 'vertical'] as const, 'horizontal') } : {}),
    ...(args.brightness !== undefined ? { brightness: number(args, 'brightness', 0, 200, 100) } : {}),
    ...(args.contrast !== undefined ? { contrast: number(args, 'contrast', 0, 200, 100) } : {}),
    ...(args.saturation !== undefined ? { saturation: number(args, 'saturation', 0, 200, 100) } : {}),
    ...(args.grayscale !== undefined ? { grayscale: number(args, 'grayscale', 0, 100, 0) } : {}),
    ...(args.sepia !== undefined ? { sepia: number(args, 'sepia', 0, 100, 0) } : {}),
    ...(args.blurRadius !== undefined ? { blurRadius: number(args, 'blurRadius', 0, 50, 0) } : {}),
    ...(args.text !== undefined ? { text: text(args, 'text', 'PaperLab', 100) } : {}),
    ...(args.textSize !== undefined ? { textSize: number(args, 'textSize', 8, 160, 32) } : {}),
    ...(args.opacity !== undefined ? { opacity: number(args, 'opacity', 5, 100, 30) } : {}),
    ...(args.color !== undefined ? { color: color(args, 'color', '#111111') } : {}),
    ...(args.background !== undefined ? { background: color(args, 'background', '#ffffff') } : {}),
    ...(args.position !== undefined ? { position: oneOf(args, 'position', ['top-left', 'center', 'bottom-right'] as const, 'bottom-right') } : {}),
    ...(args.border !== undefined ? { border: integer(args, 'border', 0, 200, 24) } : {}),
    ...(args.cornerRadius !== undefined ? { cornerRadius: integer(args, 'cornerRadius', 0, 400, 30) } : {}),
    ...(args.tolerance !== undefined ? { tolerance: number(args, 'tolerance', 0, 200, 28) } : {}),
    ...(args.mosaicSize !== undefined ? { mosaicSize: integer(args, 'mosaicSize', 2, 80, 16) } : {}),
    ...(args.region !== undefined ? { region: region(args) } : {}),
    ...overrides,
  };
}

function single(files: File[]): File {
  if (files.length !== 1) fails('此操作需要且只能有一个输入文件');
  return files[0];
}

function requirePdf(files: File[]): File[] {
  if (files.some((file) => !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf')) {
    fails('此操作需要 PDF 文件');
  }
  return files;
}

function requireImage(files: File[]): File[] {
  if (files.some((file) => !file.type.startsWith('image/'))) fails('此操作需要图片文件');
  return files;
}

function baseAdapter(
  key: string,
  group: 'pdf' | 'image',
  options: Partial<Omit<ToolAdapter, 'key' | 'title' | 'group' | 'needsCloud'>> = {},
): ToolAdapter {
  const path = PATH_BY_KEY.get(key) ?? (group === 'pdf' ? '/pdf' : '/image');
  return {
    key,
    title: toolLabel(key),
    group,
    acceptedKinds: [group],
    inputCount: 'one',
    outputKind: 'file',
    requiresUserRegion: false,
    manualOnly: false,
    lossy: false,
    preservesNativePdfText: true,
    requiresConfirmation: false,
    needsCloud: false,
    manualPath: path,
    validateArgs: (args) => object(args),
    execute: async (files) => single(files),
    ...options,
  };
}

function pdfAdapter(
  key: string,
  options: Partial<Omit<ToolAdapter, 'key' | 'title' | 'group' | 'needsCloud'>>,
): ToolAdapter {
  return baseAdapter(key, 'pdf', options);
}

function imageAdapter(
  key: string,
  options: Partial<Omit<ToolAdapter, 'key' | 'title' | 'group' | 'needsCloud'>>,
): ToolAdapter {
  return baseAdapter(key, 'image', options);
}

function transformTool(key: ImageTransform, options: Partial<ToolAdapter> = {}): ToolAdapter {
  return imageAdapter(`image.${key}`, {
    validateArgs: (args) => {
      object(args);
      if (['pixelate', 'blur', 'mask'].includes(key)) region(args);
      if (key === 'watermark') text(args, 'text');
      return args;
    },
    execute: async (files, args) => transformImage(single(files), key, imageOptions(args)),
    ...options,
  });
}

export const TOOL_ADAPTERS: ToolAdapter[] = [
  pdfAdapter('pdf.merge', {
    inputCount: 'multiple',
    acceptedKinds: ['pdf'],
    validateArgs: (args) => only(object(args), []),
    execute: async (files) => mergePdfs(requirePdf(files)),
    requiresConfirmation: false,
  }),
  pdfAdapter('pdf.split', {
    validateArgs: (args) => {
      only(object(args), ['range']);
      return { range: range(args) };
    },
    execute: async (files, args) => extractPdfPages(single(files), range(args)),
  }),
  pdfAdapter('pdf.rotate', {
    validateArgs: (args) => {
      object(args);
      only(args, ['angle', 'allPages', 'range']);
      return {
        angle: oneOf(args, 'angle', [90, 180, 270] as const),
        allPages: boolean(args, 'allPages', false),
        range: range(args),
      };
    },
    execute: async (files, args) => rotatePdf(single(files), {
      angle: oneOf(args, 'angle', [90, 180, 270] as const),
      allPages: boolean(args, 'allPages', false),
      range: range(args),
    }),
  }),
  pdfAdapter('pdf.delete', {
    validateArgs: (args) => {
      only(object(args), ['range']);
      return { range: range(args) };
    },
    execute: async (files, args) => deletePdfPages(single(files), range(args)),
  }),
  pdfAdapter('pdf.organize', {
    validateArgs: (args) => {
      object(args);
      only(args, ['order']);
      return { order: order(args) };
    },
    execute: async (files, args) => reorderPdfPages(single(files), order(args)),
  }),
  pdfAdapter('pdf.blanks', {
    validateArgs: (args) => {
      object(args);
      only(args, ['afterPage', 'count']);
      return {
        afterPage: integer(args, 'afterPage', 0, 10000, 0),
        count: integer(args, 'count', 1, 20, 1),
      };
    },
    execute: async (files, args) => insertBlankPages(
      single(files),
      integer(args, 'afterPage', 0, 10000, 0),
      integer(args, 'count', 1, 20, 1),
    ),
  }),
  pdfAdapter('pdf.numbers', {
    validateArgs: (args) => {
      object(args);
      only(args, ['start', 'position', 'range']);
      return {
        start: integer(args, 'start', 0, 999999, 1),
        position: oneOf(args, 'position', ['bottom-left', 'bottom-center', 'bottom-right', 'top-center'] as const, 'bottom-center'),
        range: range(args),
      };
    },
    execute: async (files, args) => addPageNumbers(single(files), {
      start: integer(args, 'start', 0, 999999, 1),
      position: oneOf(args, 'position', ['bottom-left', 'bottom-center', 'bottom-right', 'top-center'] as const, 'bottom-center'),
      range: range(args),
    }),
  }),
  pdfAdapter('pdf.watermark', {
    requiresConfirmation: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['text', 'opacity', 'range']);
      return {
        text: text(args, 'text', undefined, 80),
        opacity: number(args, 'opacity', 0.05, 1, 0.24),
        range: range(args),
      };
    },
    execute: async (files, args) => watermarkPdf(
      single(files), text(args, 'text', undefined, 80),
      number(args, 'opacity', 0.05, 1, 0.24), range(args),
    ),
  }),
  pdfAdapter('pdf.crop', {
    validateArgs: (args) => {
      object(args);
      only(args, ['margin', 'range']);
      return { margin: number(args, 'margin', 0, 100, 8), range: range(args) };
    },
    execute: async (files, args) => cropPdf(single(files), number(args, 'margin', 0, 100, 8), range(args)),
    requiresConfirmation: true,
  }),
  pdfAdapter('pdf.metadata', {
    validateArgs: (args) => {
      object(args);
      only(args, ['title', 'author', 'subject', 'keywords', 'clear']);
      return {
        title: optionalText(args, 'title', 200),
        author: optionalText(args, 'author', 120),
        subject: optionalText(args, 'subject', 200),
        keywords: optionalText(args, 'keywords', 300),
        clear: boolean(args, 'clear', false),
      };
    },
    execute: async (files, args) => editPdfMetadata(single(files), {
      title: optionalText(args, 'title', 200),
      author: optionalText(args, 'author', 120),
      subject: optionalText(args, 'subject', 200),
      keywords: optionalText(args, 'keywords', 300),
      clear: boolean(args, 'clear', false),
    }),
  }),
  pdfAdapter('pdf.images', {
    acceptedKinds: ['image'],
    inputCount: 'multiple',
    validateArgs: (args) => {
      object(args);
      only(args, ['paper']);
      return { paper: oneOf(args, 'paper', ['a4', 'original'] as const, 'a4') };
    },
    execute: async (files, args) => imagesToPdf(
      requireImage(files),
      oneOf(args, 'paper', ['a4', 'original'] as const, 'a4'),
    ),
    preservesNativePdfText: false,
  }),
  pdfAdapter('pdf.to-image', {
    outputKind: 'files',
    validateArgs: (args) => {
      object(args);
      only(args, ['range', 'format', 'scale']);
      return {
        range: range(args),
        format: oneOf(args, 'format', ['png', 'jpeg'] as const, 'png'),
        scale: number(args, 'scale', 0.5, 3, 1.5),
      };
    },
    execute: async (files, args) => exportPdfImages(
      single(files), range(args),
      oneOf(args, 'format', ['png', 'jpeg'] as const, 'png'),
      number(args, 'scale', 0.5, 3, 1.5),
    ),
    lossy: true,
    requiresConfirmation: true,
  }),
  pdfAdapter('pdf.to-text', {
    validateArgs: (args) => {
      only(object(args), ['range']);
      return { range: range(args) };
    },
    execute: async (files, args) => extractPdfText(single(files), range(args)),
    lossy: true,
  }),
  pdfAdapter('pdf.compress', {
    lossy: true,
    preservesNativePdfText: false,
    requiresConfirmation: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['quality', 'scale', 'threshold']);
      return {
        quality: number(args, 'quality', 0.3, 0.98, 0.75),
        scale: number(args, 'scale', 0.5, 3, 1.5),
        threshold: number(args, 'threshold', 50, 245, 190),
      };
    },
    execute: async (files, args) => rasterPdf(single(files), 'compress', {
      quality: number(args, 'quality', 0.3, 0.98, 0.75),
      scale: number(args, 'scale', 0.5, 3, 1.5),
      threshold: number(args, 'threshold', 50, 245, 190),
    }),
  }),
  pdfAdapter('pdf.grayscale', {
    lossy: true,
    preservesNativePdfText: false,
    requiresConfirmation: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['quality', 'scale', 'threshold']);
      return {
        quality: number(args, 'quality', 0.3, 0.98, 0.75),
        scale: number(args, 'scale', 0.5, 3, 1.5),
        threshold: number(args, 'threshold', 50, 245, 190),
      };
    },
    execute: async (files, args) => rasterPdf(single(files), 'grayscale', {
      quality: number(args, 'quality', 0.3, 0.98, 0.75),
      scale: number(args, 'scale', 0.5, 3, 1.5),
      threshold: number(args, 'threshold', 50, 245, 190),
    }),
  }),
  pdfAdapter('pdf.background', {
    lossy: true,
    preservesNativePdfText: false,
    requiresConfirmation: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['quality', 'scale', 'threshold']);
      return {
        quality: number(args, 'quality', 0.3, 0.98, 0.75),
        scale: number(args, 'scale', 0.5, 3, 1.5),
        threshold: number(args, 'threshold', 50, 245, 190),
      };
    },
    execute: async (files, args) => rasterPdf(single(files), 'background', {
      quality: number(args, 'quality', 0.3, 0.98, 0.75),
      scale: number(args, 'scale', 0.5, 3, 1.5),
      threshold: number(args, 'threshold', 50, 245, 190),
    }),
  }),
  pdfAdapter('pdf.stamp', {
    inputCount: 'two',
    acceptedKinds: ['pdf', 'image'],
    manualOnly: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['range', 'widthPercent', 'position']);
      return {
        range: range(args),
        widthPercent: number(args, 'widthPercent', 5, 80, 20),
        position: oneOf(args, 'position', ['center', 'top-right', 'bottom-right'] as const, 'bottom-right'),
      };
    },
    execute: async (files, args) => {
      if (files.length !== 2) fails('需要一份 PDF 和一张印章图片');
      return stampPdf(requirePdf([files[0]])[0], requireImage([files[1]])[0], range(args),
        number(args, 'widthPercent', 5, 80, 20),
        oneOf(args, 'position', ['center', 'top-right', 'bottom-right'] as const, 'bottom-right'));
    },
  }),
  pdfAdapter('pdf.flatten', {
    validateArgs: (args) => only(object(args), []),
    execute: async (files) => flattenPdfForms(single(files)),
    lossy: true,
    requiresConfirmation: true,
  }),
  pdfAdapter('pdf.insert', {
    inputCount: 'two',
    manualOnly: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['afterPage', 'range']);
      return { afterPage: integer(args, 'afterPage', 0, 10000, 1), range: range(args) };
    },
    execute: async (files, args) => {
      if (files.length !== 2) fails('需要两份 PDF');
      return insertPdfPages(requirePdf([files[0]])[0], requirePdf([files[1]])[0],
        integer(args, 'afterPage', 0, 10000, 1), range(args));
    },
  }),
  pdfAdapter('pdf.split-pages', {
    outputKind: 'files',
    validateArgs: (args) => {
      only(object(args), ['range']);
      return { range: range(args) };
    },
    execute: async (files, args) => splitPdfByPage(single(files), range(args)),
  }),
  pdfAdapter('pdf.resize-pages', {
    validateArgs: (args) => {
      object(args);
      only(args, ['paper', 'orientation']);
      return {
        paper: oneOf(args, 'paper', ['a4', 'a3', 'letter'] as const, 'a4'),
        orientation: oneOf(args, 'orientation', ['portrait', 'landscape'] as const, 'portrait'),
      };
    },
    execute: async (files, args) => resizePdfPages(single(files),
      oneOf(args, 'paper', ['a4', 'a3', 'letter'] as const, 'a4'),
      oneOf(args, 'orientation', ['portrait', 'landscape'] as const, 'portrait')),
  }),
  pdfAdapter('pdf.nup', {
    validateArgs: (args) => {
      object(args);
      only(args, ['layout']);
      return { layout: oneOf(args, 'layout', [2, 4] as const, 2) };
    },
    execute: async (files, args) => nupPdf(single(files), oneOf(args, 'layout', [2, 4] as const, 2)),
    lossy: true,
    requiresConfirmation: true,
  }),
  pdfAdapter('pdf.fill', {
    manualOnly: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['values']);
      if (!args.values || typeof args.values !== 'object' || Array.isArray(args.values)) fails('需要表单字段值');
      const values = args.values as Record<string, unknown>;
      if (Object.keys(values).length > 100) fails('表单字段过多');
      for (const value of Object.values(values)) {
        if (!['string', 'boolean'].includes(typeof value)) fails('表单字段值无效');
        if (typeof value === 'string' && value.length > 1000) fails('表单字段值过长');
      }
      return { values };
    },
    execute: async (files, args) => fillPdfForm(single(files), args.values as Record<string, string | boolean>),
    lossy: true,
  }),
  imageAdapter('image.crop', {
    requiresUserRegion: true,
    manualOnly: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['x', 'y', 'width', 'height', 'format', 'quality']);
      const width = integer(args, 'width', 1, 30000);
      const height = integer(args, 'height', 1, 30000);
      if (integer(args, 'x', 0, 30000) + width > 30000 || integer(args, 'y', 0, 30000) + height > 30000) {
        fails('裁剪区域超出限制');
      }
      return { x: integer(args, 'x', 0, 30000), y: integer(args, 'y', 0, 30000), width, height, format: format(args), quality: number(args, 'quality', 30, 100, 92) };
    },
    execute: async (files, args) => cropImage(single(files), {
      x: integer(args, 'x', 0, 30000), y: integer(args, 'y', 0, 30000),
      width: integer(args, 'width', 1, 30000), height: integer(args, 'height', 1, 30000),
      format: format(args), quality: number(args, 'quality', 30, 100, 92),
    }),
  }),
  imageAdapter('image.resize', {
    validateArgs: (args) => {
      object(args);
      only(args, ['mode', 'width', 'height', 'percent', 'keepAspect', 'format', 'quality']);
      return {
        mode: oneOf(args, 'mode', ['pixels', 'percent'] as const, 'percent'),
        width: integer(args, 'width', 0, 20000, 0),
        height: integer(args, 'height', 0, 20000, 0),
        percent: number(args, 'percent', 1, 500, 75),
        keepAspect: boolean(args, 'keepAspect', true),
        format: format(args), quality: number(args, 'quality', 30, 100, 90),
      };
    },
    execute: async (files, args) => resizeImage(single(files), {
      mode: oneOf(args, 'mode', ['pixels', 'percent'] as const, 'percent'),
      width: integer(args, 'width', 0, 20000, 0), height: integer(args, 'height', 0, 20000, 0),
      percent: number(args, 'percent', 1, 500, 75), keepAspect: boolean(args, 'keepAspect', true),
      format: format(args), quality: number(args, 'quality', 30, 100, 90),
    }),
  }),
  imageAdapter('image.convert', {
    validateArgs: (args) => {
      object(args);
      only(args, ['format', 'quality', 'background']);
      return { format: format(args), quality: number(args, 'quality', 30, 100, 90), background: color(args, 'background', '#ffffff') };
    },
    execute: async (files, args) => convertImage(single(files), {
      format: format(args), quality: number(args, 'quality', 30, 100, 90),
      background: color(args, 'background', '#ffffff'),
    }),
    lossy: true,
  }),
  imageAdapter('image.compress', {
    lossy: true,
    requiresConfirmation: true,
    validateArgs: (args) => {
      object(args);
      only(args, ['quality', 'maxSizeMB', 'maxDimension']);
      return {
        quality: number(args, 'quality', 30, 100, 70),
        maxSizeMB: number(args, 'maxSizeMB', 0.05, 50, 0.8),
        maxDimension: integer(args, 'maxDimension', 256, 10000, 2400),
      };
    },
    execute: async (files, args) => compressImage(single(files), {
      quality: number(args, 'quality', 30, 100, 70),
      maxSizeMB: number(args, 'maxSizeMB', 0.05, 50, 0.8),
      maxDimension: integer(args, 'maxDimension', 256, 10000, 2400),
    }),
  }),
  transformTool('rotate', {
    validateArgs: (args) => {
      object(args);
      only(args, ['angle', 'format', 'quality']);
      return { angle: oneOf(args, 'angle', [90, 180, 270] as const), format: format(args), quality: number(args, 'quality', 30, 100, 90) };
    },
  }),
  transformTool('flip', {
    validateArgs: (args) => {
      object(args);
      only(args, ['direction', 'format', 'quality']);
      return { direction: oneOf(args, 'direction', ['horizontal', 'vertical'] as const), format: format(args), quality: number(args, 'quality', 30, 100, 90) };
    },
  }),
  transformTool('adjust'),
  transformTool('watermark'),
  transformTool('frame'),
  transformTool('round'),
  transformTool('pixelate', { requiresUserRegion: true, manualOnly: true }),
  transformTool('blur', { requiresUserRegion: true, manualOnly: true }),
  transformTool('mask', { requiresUserRegion: true, manualOnly: true }),
  transformTool('background', { lossy: true, requiresConfirmation: true }),
  transformTool('replace-background'),
  transformTool('strip', { lossy: true }),
  imageAdapter('image.collage', {
    inputCount: 'multiple',
    acceptedKinds: ['image'],
    validateArgs: (args) => {
      object(args);
      only(args, ['arrangement', 'gap', 'background']);
      return {
        arrangement: oneOf(args, 'arrangement', ['horizontal', 'vertical', 'grid-2', 'grid-3'] as const, 'grid-2'),
        gap: integer(args, 'gap', 0, 100, 12),
        background: color(args, 'background', '#ffffff'),
      };
    },
    execute: async (files, args) => composeImages(
      requireImage(files),
      oneOf(args, 'arrangement', ['horizontal', 'vertical', 'grid-2', 'grid-3'] as const, 'grid-2') as ImageArrangement,
      integer(args, 'gap', 0, 100, 12), color(args, 'background', '#ffffff'),
    ),
  }),
  imageAdapter('image.batch', {
    inputCount: 'multiple',
    outputKind: 'files',
    acceptedKinds: ['image'],
    validateArgs: (args) => {
      object(args);
      only(args, ['mode', 'format', 'quality', 'percent']);
      return {
        mode: oneOf(args, 'mode', ['convert', 'compress', 'resize'] as const, 'convert'),
        format: format(args), quality: number(args, 'quality', 30, 100, 85),
        percent: number(args, 'percent', 1, 500, 50),
      };
    },
    execute: async (files, args) => {
      const inputs = requireImage(files);
      if (inputs.length > 20) fails('批量处理每次最多 20 张图片');
      const mode = oneOf(args, 'mode', ['convert', 'compress', 'resize'] as const, 'convert');
      const outputs: File[] = [];
      for (const file of inputs) {
        if (mode === 'convert') outputs.push(await convertImage(file, { format: format(args), quality: number(args, 'quality', 30, 100, 85), background: '#ffffff' }));
        else if (mode === 'compress') outputs.push(await compressImage(file, { quality: number(args, 'quality', 30, 100, 85), maxSizeMB: 0.8, maxDimension: 2400 }));
        else outputs.push(await resizeImage(file, { mode: 'percent', width: 0, height: 0, percent: number(args, 'percent', 1, 500, 50), keepAspect: true, format: format(args), quality: number(args, 'quality', 30, 100, 85) }));
      }
      return outputs;
    },
  }),
];

export const TOOL_ADAPTER_MAP = new Map(TOOL_ADAPTERS.map((adapter) => [adapter.key, adapter]));

export function adapterForKey(key: string): ToolAdapter | null {
  return TOOL_ADAPTER_MAP.get(key) ?? null;
}
