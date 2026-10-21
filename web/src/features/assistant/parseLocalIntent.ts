import type {
  AssistantPlan,
  PlanOutcome,
  PlanStep,
  WorkspaceFileKind,
  WorkspaceFileMeta,
} from './types';

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};

function chineseNumber(value: string): number | null {
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (text === '十') return 10;
  const ten = text.indexOf('十');
  if (ten >= 0) {
    const left = ten === 0 ? 1 : CN_DIGITS[text.slice(0, ten)];
    const right = ten === text.length - 1 ? 0 : CN_DIGITS[text.slice(ten + 1)];
    if (left === undefined || right === undefined) return null;
    return left * 10 + right;
  }
  if (text.length === 1 && CN_DIGITS[text] !== undefined) return CN_DIGITS[text];
  return null;
}

function pageRange(raw: string): string | null {
  const normalized = raw
    .replace(/[、，]/g, ',')
    .replace(/\s+/g, '')
    .replace(/第/g, '')
    .replace(/页/g, '');
  const tokens = normalized.split(',').filter(Boolean);
  if (!tokens.length) return null;
  const output: string[] = [];
  for (const token of tokens) {
    const parts = token.split('-');
    if (parts.length > 2) return null;
    const numbers = parts.map(chineseNumber);
    if (numbers.some((number) => number === null || !Number.isInteger(number) || number < 1)) {
      return null;
    }
    output.push(numbers.join('-'));
  }
  return output.join(',');
}

function splitClauses(prompt: string): string[] {
  return prompt
    .replace(/[。！？!?]/g, '，')
    .replace(/并(?=(?:旋转|删除|添加|加|压缩|提取|转|合并|把|将))/g, '；')
    .split(/(?:；|;|，\s*(?=(?:再|然后|并|并且|最后|接着|把|将|给|从|再给))|，\s*(?=后)|(?<=水印)\s*后)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function kindOf(metas: WorkspaceFileMeta[]): WorkspaceFileKind {
  if (metas.length === 0) return 'pdf';
  return metas[0].kind;
}

function allSameKind(metas: WorkspaceFileMeta[]): boolean {
  return metas.every((meta) => meta.kind === metas[0]?.kind);
}

function clarify(message: string, manualPath?: string): PlanOutcome {
  return { kind: 'needs_clarification', message, ...(manualPath ? { manualPath } : {}) };
}

function localPlan(
  prompt: string,
  metas: WorkspaceFileMeta[],
  steps: PlanStep[],
): AssistantPlan {
  return {
    kind: 'plan',
    source: 'local',
    fileIds: metas.map((meta) => meta.fileId),
    steps,
    requiresConfirmation: true,
    reason: prompt,
    message: '已根据指令生成操作计划。确认后全部在当前浏览器内执行。',
  };
}

function extractAfter(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  return match?.[1]?.trim().replace(/^["“”'‘’]|["“”'‘’]$/g, '') || '';
}

function watermarkText(text: string): string {
  const after = extractAfter(text, /水印(?:内容|文字)?(?:为|是|[:：])?\s*(.+)$/);
  if (after) return after;
  const before = /(?:加|添加)(?:一个|个)?\s*(?:右下角|左上角|居中|白色|半透明|黑色|红色|\s)*([A-Za-z0-9\u4e00-\u9fa5_.-]{1,40})\s*水印/.exec(text);
  return before?.[1]?.trim() || '';
}

function parseAngle(text: string): number | null {
  const match = /(90|180|270|九十|一百八十|二百七十)\s*(?:度|°)?/.exec(text);
  if (!match) return null;
  const value = chineseNumber(match[1]);
  if (value !== 90 && value !== 180 && value !== 270) return null;
  if (/逆时针|向左/.test(text)) return value === 90 ? 270 : value === 270 ? 90 : 180;
  return value;
}

function pdfStepForClause(
  clause: string,
  metas: WorkspaceFileMeta[],
): PlanStep | PlanOutcome | null {
  const pdfMetas = metas.filter((meta) => meta.kind === 'pdf');
  const imageMetas = metas.filter((meta) => meta.kind === 'image');
  const normalized = clause.replace(/\s+/g, ' ');

  if (/(?:合并|合为|合成)/.test(normalized)) {
    if (pdfMetas.length < 2) return clarify('合并需要至少两份 PDF，请再添加一份。');
    if (imageMetas.length) return clarify('合并 PDF 时请不要同时选择图片。');
    return { toolKey: 'pdf.merge', args: {} };
  }
  if (/(?:图片|png|jpe?g).*(?:转|生成).*pdf|(?:合并|合成).*图片/i.test(normalized) && imageMetas.length > 0) {
    return { toolKey: 'pdf.images', args: { paper: 'a4' } };
  }
  if (/(?:删除|去掉|移除)/.test(normalized)) {
    const match = /(?:删除|去掉|移除)\s*(?:第)?\s*([0-9一二三四五六七八九十、,，\-\s]+?)\s*页/.exec(normalized);
    if (!match) return clarify('要删除哪一页？请告诉我页码，例如“删除第 2 页”。');
    const range = pageRange(match[1]);
    if (!range) return clarify('页码格式无法确认，请使用“2”或“2,4-5”这样的格式。');
    return { toolKey: 'pdf.delete', args: { range } };
  }
  if (/旋转|转\s*(?:90|180|270|九十|一百八十|二百七十)/.test(normalized)) {
    const angle = parseAngle(normalized);
    if (!angle) return clarify('要旋转多少度？目前支持 90°、180° 或 270°。');
    const selected = /(?:第|页码?)\s*([0-9一二三四五六七八九十、,，\-\s]+?)\s*页/.exec(normalized);
    const selectedRange = selected ? pageRange(selected[1]) : null;
    return {
      toolKey: 'pdf.rotate',
      args: {
        angle,
        allPages: !selectedRange || /全部|所有|剩余|每一?页|整份/.test(normalized),
        range: selectedRange || '',
      },
    };
  }
  if (/(?:重排|顺序|排序)/.test(normalized)) {
    const match = /(?:顺序|排序|重排)(?:改为|为|按|成)?\s*([0-9,，、\-\s]+)/.exec(normalized);
    if (!match) return clarify('请给出目标页序，例如“重排为 3,1-2”。');
    const order = pageRange(match[1]);
    if (!order) return clarify('页序格式无法确认，请使用“3,1-2”这样的格式。');
    return { toolKey: 'pdf.organize', args: { order } };
  }
  if (/页码/.test(normalized)) {
    const startMatch = /从\s*第?\s*(\d+)\s*页?\s*开始/.exec(normalized);
    return {
      toolKey: 'pdf.numbers',
      args: {
        start: startMatch ? Number(startMatch[1]) : 1,
        position: 'bottom-center',
        range: '',
      },
    };
  }
  if (/水印/.test(normalized)) {
    const content = watermarkText(normalized);
    if (!content) return clarify('水印要写什么内容？例如“加水印：内部资料”。');
    return { toolKey: 'pdf.watermark', args: { text: content, opacity: /半透明/.test(normalized) ? 0.35 : 0.24, range: '' } };
  }
  if (/(?:提取|导出).*(?:文字|文本)|(?:文字|文本).*(?:提取|导出)|转\s*(?:为|成)?\s*txt/i.test(normalized)) {
    return { toolKey: 'pdf.to-text', args: { range: '' } };
  }
  if (/灰度/.test(normalized)) {
    return { toolKey: 'pdf.grayscale', args: { quality: 0.75, scale: 1.5, threshold: 190 } };
  }
  if (/压缩/.test(normalized)) {
    return { toolKey: 'pdf.compress', args: { quality: 0.7, scale: 1.25, threshold: 190 } };
  }
  if (/(?:转|导出).*(?:图片|png|jpe?g)/i.test(normalized)) {
    return { toolKey: 'pdf.to-image', args: { range: '', format: 'png', scale: 1.5 } };
  }
  return null;
}

function imageStepForClause(
  clause: string,
  metas: WorkspaceFileMeta[],
): PlanStep | PlanOutcome | null {
  const normalized = clause.replace(/\s+/g, ' ');
  const other = metas.filter((meta) => meta.kind !== 'image');
  if (other.length) return clarify('图片操作只能选择图片文件。');

  if (/(?:转|生成|保存|合并|合成|做成).*pdf/i.test(normalized)) {
    return { toolKey: 'pdf.images', args: { paper: 'a4' } };
  }
  if (/(?:裁剪|裁出)/.test(normalized)) {
    return clarify('裁剪需要用鼠标框选区域，请打开图片裁剪工具。', '/image/crop');
  }
  if (/(?:遮挡|打码|马赛克|局部模糊)/.test(normalized)) {
    const path = /马赛克/.test(normalized) ? '/image/pixelate' : /模糊/.test(normalized) ? '/image/blur' : '/image/mask';
    return clarify('这个操作需要你先在图片上框选区域，请打开对应的图片工具。', path);
  }
  if (/旋转/.test(normalized)) {
    const angle = parseAngle(normalized);
    if (!angle) return clarify('图片要旋转多少度？目前支持 90°、180° 或 270°。');
    return { toolKey: 'image.rotate', args: { angle, format: 'image/png', quality: 90 } };
  }
  if (/(?:镜像|翻转)/.test(normalized)) {
    return {
      toolKey: 'image.flip',
      args: { direction: /垂直|上下/.test(normalized) ? 'vertical' : 'horizontal', format: 'image/png', quality: 90 },
    };
  }
  if (/水印/.test(normalized)) {
    const content = watermarkText(normalized);
    if (!content) return clarify('水印要写什么内容？例如“右下角加 PaperLab 水印”。');
    return {
      toolKey: 'image.watermark',
      args: {
        text: content,
        textSize: 42,
        opacity: /半透明/.test(normalized) ? 35 : 100,
        color: /白色|白/.test(normalized) ? '#ffffff' : '#111111',
        position: /右下/.test(normalized) ? 'bottom-right' : /居中/.test(normalized) ? 'center' : 'top-left',
        format: 'image/png',
        quality: 90,
      },
    };
  }
  const formatMatch = /(?:转|导出|保存).*(?:为|成)?\s*(png|jpe?g|webp)/i.exec(normalized);
  if (formatMatch) {
    const format = formatMatch[1].toLowerCase() === 'jpg' || formatMatch[1].toLowerCase() === 'jpeg'
      ? 'image/jpeg' : formatMatch[1].toLowerCase() === 'webp' ? 'image/webp' : 'image/png';
    return { toolKey: 'image.convert', args: { format, quality: 90, background: '#ffffff' } };
  }
  if (/压缩/.test(normalized)) {
    return { toolKey: 'image.compress', args: { quality: 72, maxSizeMB: 0.8, maxDimension: 2400 } };
  }
  if (/(?:缩放|调整.*尺寸|放大|缩小)/.test(normalized)) {
    const percentMatch = /(\d{1,3})\s*%/.exec(normalized);
    return { toolKey: 'image.resize', args: { mode: 'percent', width: 0, height: 0, percent: percentMatch ? Number(percentMatch[1]) : 75, keepAspect: true, format: 'image/png', quality: 90 } };
  }
  if (/(?:拼接|拼图)/.test(normalized)) {
    if (metas.length < 2) return clarify('拼接至少需要两张图片，请再添加一张。');
    return { toolKey: 'image.collage', args: { arrangement: 'grid-2', gap: 12, background: '#ffffff' } };
  }
  if (/清除.*元数据|去.*exif|元数据/.test(normalized)) {
    return { toolKey: 'image.strip', args: { format: 'image/png', quality: 90 } };
  }
  return null;
}

export function parseLocalIntent(prompt: string, metas: WorkspaceFileMeta[]): PlanOutcome {
  const trimmed = prompt.trim();
  if (!trimmed) return clarify('请描述你想对文件做什么。');
  if (metas.length === 0) return clarify('请先上传一个 PDF 或图片。');
  if (!allSameKind(metas)) return clarify('一次只能处理同一种类型的文件，请先只保留 PDF 或图片。');
  const kind = kindOf(metas);
  const clauses = splitClauses(trimmed);
  const steps: PlanStep[] = [];

  for (const clause of clauses) {
    const parsed = kind === 'pdf'
      ? pdfStepForClause(clause, metas)
      : kind === 'image'
        ? imageStepForClause(clause, metas)
        : null;
    if (!parsed) {
      if (kind === 'text') return { kind: 'unsupported', message: '文本文件目前只能下载，不能继续编辑。' };
      return clarify('我还不能确定这条指令。可以换成“删除第 2 页并旋转 90 度”“压缩图片”或“提取文字”。');
    }
    if ('kind' in parsed) return parsed;
    steps.push(parsed);
  }

  if (!steps.length) return clarify('请描述你想对文件做什么。');
  const hasMultiFileStep = steps.some((step) => ['pdf.merge', 'pdf.images', 'image.collage'].includes(step.toolKey));
  if (metas.length > 1 && !hasMultiFileStep) {
    return clarify('你上传了多个文件。请明确要合并/拼接，或一次只保留一个文件。');
  }
  return localPlan(trimmed, metas, steps);
}
