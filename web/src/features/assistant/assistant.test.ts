// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ALL_TOOLS } from '../../lib/tools';
import { parseLocalIntent } from './parseLocalIntent';
import { TOOL_ADAPTERS } from './toolAdapters';
import { validatePlan, PlanValidationError } from './planExecutor';
import type { WorkspaceFileMeta } from './types';

function meta(overrides: Partial<WorkspaceFileMeta> = {}): WorkspaceFileMeta {
  return {
    fileId: 'file-11111111-1111-4111-8111-111111111111',
    kind: 'pdf',
    name: 'example.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    pageCount: 5,
    hasTextLayer: true,
    source: 'upload',
    createdAt: 1,
    ...overrides,
  };
}

describe('assistant tool registry and local parser', () => {
  it('binds every one of the 41 existing file tools without duplicating algorithms', () => {
    expect(ALL_TOOLS).toHaveLength(41);
    expect(TOOL_ADAPTERS).toHaveLength(41);
    expect(new Set(TOOL_ADAPTERS.map((adapter) => adapter.key)).size).toBe(41);
    expect(new Set(TOOL_ADAPTERS.map((adapter) => adapter.key))).toEqual(
      new Set(ALL_TOOLS.map((tool) => tool.key)),
    );
    expect(TOOL_ADAPTERS.every((adapter) => adapter.needsCloud === false)).toBe(true);
    expect(TOOL_ADAPTERS.filter((adapter) => adapter.manualOnly).map((adapter) => adapter.key))
      .toEqual(expect.arrayContaining(['image.crop', 'image.mask', 'pdf.fill']));
  });

  it('parses the offline delete-then-rotate journey into two local steps', () => {
    const outcome = parseLocalIntent('删除第 2 页，再旋转剩余页面 90 度', [meta()]);
    expect(outcome.kind).toBe('plan');
    if (outcome.kind !== 'plan') return;
    expect(outcome.source).toBe('local');
    expect(outcome.steps.map((step) => step.toolKey)).toEqual(['pdf.delete', 'pdf.rotate']);
    expect(outcome.steps[0].args.range).toBe('2');
    expect(outcome.steps[1].args.allPages).toBe(true);
    expect(validatePlan(outcome, [meta()]).plan.steps).toHaveLength(2);
  });

  it('parses merge plus page numbering across two files', () => {
    const files = [
      meta({ fileId: 'file-11111111-1111-4111-8111-111111111111' }),
      meta({ fileId: 'file-22222222-2222-4222-8222-222222222222', name: 'second.pdf' }),
    ];
    const outcome = parseLocalIntent('按顺序合并，并从第 3 页开始加页码', files);
    expect(outcome.kind).toBe('plan');
    if (outcome.kind !== 'plan') return;
    expect(outcome.steps.map((step) => step.toolKey)).toEqual(['pdf.merge', 'pdf.numbers']);
    expect(outcome.steps[1].args.start).toBe(3);
  });

  it('parses image watermark then compression with explicit text', () => {
    const files = [meta({
      kind: 'image',
      name: 'photo.png',
      mimeType: 'image/png',
      pageCount: undefined,
      hasTextLayer: undefined,
      width: 800,
      height: 600,
    })];
    const outcome = parseLocalIntent('右下角加白色半透明 PaperLab 水印后压缩', files);
    expect(outcome.kind).toBe('plan');
    if (outcome.kind !== 'plan') return;
    expect(outcome.steps.map((step) => step.toolKey)).toEqual(['image.watermark', 'image.compress']);
    expect(outcome.steps[0].args.text).toBe('PaperLab');
    expect(outcome.steps[0].args.color).toBe('#ffffff');
  });

  it('does not guess for ambiguous or interactive requests', () => {
    const ambiguous = parseLocalIntent('帮我处理一下这个文件', [meta()]);
    expect(ambiguous.kind).toBe('needs_clarification');
    const region = parseLocalIntent('把图片打码', [meta({ kind: 'image' })]);
    expect(region.kind).toBe('needs_clarification');
    if (region.kind !== 'needs_clarification') return;
    expect(region.manualPath).toBe('/image/mask');
  });

  it('rejects an interactive tool or invalid plan before execution', () => {
    const files = [meta({ kind: 'image' })];
    expect(() => validatePlan({
      kind: 'plan',
      source: 'cloud',
      fileIds: [files[0].fileId],
      steps: [{ toolKey: 'image.crop', args: {} }],
      requiresConfirmation: true,
      reason: 'crop',
    }, files)).toThrow(PlanValidationError);

    expect(() => validatePlan({
      kind: 'plan',
      source: 'cloud',
      fileIds: [files[0].fileId],
      steps: [{ toolKey: 'image.compress', args: { quality: 999 } }],
      requiresConfirmation: true,
      reason: 'bad args',
    }, files)).toThrow();
  });
});
