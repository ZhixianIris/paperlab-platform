import type { AssistantPlan, PlanStep } from './types';
import { adapterForKey } from './toolAdapters';

export function describeStep(step: PlanStep): string {
  const args = step.args;
  switch (step.toolKey) {
    case 'pdf.delete': return `删除第 ${args.range} 页`;
    case 'pdf.rotate': return `${args.allPages ? '全部页面' : `第 ${args.range || '−'} 页`}旋转 ${args.angle}°`;
    case 'pdf.numbers': return `从 ${args.start ?? 1} 开始添加页码`;
    case 'pdf.watermark': return `添加水印“${String(args.text ?? '').slice(0, 24)}”`;
    case 'pdf.merge': return '按选择顺序合并';
    case 'pdf.organize': return `重排为 ${args.order}`;
    case 'pdf.to-text': return '提取原生文字层';
    case 'pdf.to-image': return '导出页面为图片';
    case 'pdf.compress': return '栅格化并压缩页面';
    case 'pdf.grayscale': return '栅格化为灰度页面';
    case 'pdf.background': return '栅格化并清理浅色背景';
    case 'image.rotate': return `旋转 ${args.angle}°`;
    case 'image.flip': return args.direction === 'vertical' ? '垂直翻转' : '水平翻转';
    case 'image.compress': return '压缩图片';
    case 'image.convert': return `转换为 ${String(args.format ?? '').replace('image/', '').toUpperCase()}`;
    case 'image.watermark': return `添加水印“${String(args.text ?? '').slice(0, 24)}”`;
    case 'image.crop': return '裁剪图片';
    case 'image.collage': return '拼接图片';
    case 'image.batch': return '批量处理图片';
    default: {
      const entries = Object.entries(args);
      if (entries.length === 0) return '使用默认参数';
      return entries
        .slice(0, 3)
        .map(([key, value]) => `${key}=${typeof value === 'object' ? '…' : String(value)}`)
        .join(' · ');
    }
  }
}

export function planWarnings(plan: AssistantPlan): string[] {
  const warnings: string[] = [];
  const hasLossy = plan.steps.some((step) => adapterForKey(step.toolKey)?.lossy);
  const hasRaster = plan.steps.some((step) => !adapterForKey(step.toolKey)?.preservesNativePdfText);
  if (hasLossy) warnings.push('包含有损处理，请先预览结果');
  if (hasRaster) warnings.push('部分步骤会栅格化页面，原生文字层可能丢失');
  if (plan.source === 'cloud') warnings.push('云端仅接收指令和文件信息，执行仍在本机');
  return warnings;
}

export function planStepTitle(step: PlanStep): string {
  return adapterForKey(step.toolKey)?.title ?? step.toolKey;
}
