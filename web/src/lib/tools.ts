export interface ToolMeta {
  key: string;
  path: string;
  title: string;
  short: string;
  description: string;
  group: 'pdf' | 'image';
  icon: 'file' | 'scissors' | 'rotate' | 'crop' | 'resize' | 'convert' | 'compress' | 'sparkles';
}

export const PDF_TOOLS: ToolMeta[] = [
  {
    key: 'pdf.merge',
    path: '/pdf/merge',
    title: 'PDF 合并',
    short: '把多个 PDF 按顺序合成一份',
    description: '拖入多个 PDF，调整顺序，在浏览器内合并。原文字层与矢量内容保持不变。',
    group: 'pdf',
    icon: 'file',
  },
  {
    key: 'pdf.split',
    path: '/pdf/split',
    title: 'PDF 拆分',
    short: '提取指定页码为新 PDF',
    description: '选择页码或范围（例如 1,3-5），生成一份只包含这些页的新 PDF。',
    group: 'pdf',
    icon: 'scissors',
  },
  {
    key: 'pdf.rotate',
    path: '/pdf/rotate',
    title: 'PDF 旋转',
    short: '按页旋转并保持原内容',
    description: '旋转全部页面或指定页面，直接修改页面旋转角度，不把页面转成图片。',
    group: 'pdf',
    icon: 'rotate',
  },
];

export const IMAGE_TOOLS: ToolMeta[] = [
  {
    key: 'image.crop',
    path: '/image/crop',
    title: '图片裁剪',
    short: '按像素精确裁出画面',
    description: '输入裁剪区域，实时查看覆盖框，输出 PNG、JPEG 或 WebP。',
    group: 'image',
    icon: 'crop',
  },
  {
    key: 'image.resize',
    path: '/image/resize',
    title: '图片缩放',
    short: '按像素或百分比调整尺寸',
    description: '保持比例或指定宽高，使用浏览器高质量缩放后导出。',
    group: 'image',
    icon: 'resize',
  },
  {
    key: 'image.convert',
    path: '/image/convert',
    title: '格式转换',
    short: 'PNG / JPEG / WebP 互转',
    description: '本地解码并重新编码，可选质量与 JPEG 背景色。',
    group: 'image',
    icon: 'convert',
  },
  {
    key: 'image.compress',
    path: '/image/compress',
    title: '图片压缩',
    short: '在清晰度与体积间取平衡',
    description: '用浏览器内 Web Worker 压缩，实时对比压缩前后体积。',
    group: 'image',
    icon: 'compress',
  },
];

export const ALL_TOOLS = [...PDF_TOOLS, ...IMAGE_TOOLS];
