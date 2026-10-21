import type {
  AssistantPlan,
  ExecuteResult,
  PlanStep,
  StepExecution,
  WorkspaceFileMeta,
} from './types';
import { adapterForKey, type ToolAdapter } from './toolAdapters';
import type { FileRegistry } from '../workspace/fileRegistry';

export interface ValidatedPlan {
  plan: AssistantPlan;
  normalizedSteps: PlanStep[];
}

export class PlanValidationError extends Error {
  readonly manualPath?: string;

  constructor(message: string, manualPath?: string) {
    super(message);
    this.name = 'PlanValidationError';
    this.manualPath = manualPath;
  }
}

function outputKindFor(adapter: ToolAdapter, inputMetas: WorkspaceFileMeta[]): WorkspaceFileMeta['kind'] {
  if (adapter.key === 'pdf.images') return 'pdf';
  if (adapter.key === 'pdf.to-text') return 'text';
  if (adapter.key === 'pdf.to-image') return 'image';
  if (adapter.key === 'image.batch') return inputMetas[0]?.kind ?? 'image';
  return adapter.group === 'pdf' ? 'pdf' : 'image';
}

export function validatePlan(
  input: AssistantPlan,
  availableMetas: WorkspaceFileMeta[],
): ValidatedPlan {
  if (!input || input.kind !== 'plan' || !Array.isArray(input.steps)) {
    throw new PlanValidationError('操作计划格式无效');
  }
  if (input.steps.length < 1 || input.steps.length > 8) {
    throw new PlanValidationError('一次最多执行 8 个步骤');
  }
  if (!Array.isArray(input.fileIds) || input.fileIds.length === 0) {
    throw new PlanValidationError('操作计划没有指定文件');
  }
  const byId = new Map(availableMetas.map((meta) => [meta.fileId, meta]));
  for (const fileId of input.fileIds) {
    if (!byId.has(fileId)) throw new PlanValidationError('计划引用了不存在的文件');
  }

  const initial = input.fileIds.map((fileId) => byId.get(fileId) as WorkspaceFileMeta);
  let currentKind = initial[0].kind;
  let currentCount = initial.length;
  const normalizedSteps: PlanStep[] = [];

  for (const step of input.steps) {
    if (!step || typeof step.toolKey !== 'string' || !step.args || typeof step.args !== 'object') {
      throw new PlanValidationError('计划步骤格式无效');
    }
    const adapter = adapterForKey(step.toolKey);
    if (!adapter) throw new PlanValidationError(`不允许的工具：${step.toolKey}`);
    if (adapter.manualOnly || adapter.requiresUserRegion) {
      throw new PlanValidationError(
        `${adapter.title}需要你手动框选区域或补充输入`,
        adapter.manualPath,
      );
    }
    if (!adapter.acceptedKinds.includes(currentKind)) {
      throw new PlanValidationError(`${adapter.title}不能处理当前文件类型`);
    }
    if (adapter.inputCount === 'one' && currentCount !== 1) {
      throw new PlanValidationError(`${adapter.title}一次只能处理一个文件`);
    }
    if (adapter.inputCount === 'two' && currentCount !== 2) {
      throw new PlanValidationError(`${adapter.title}需要两个输入文件`);
    }
    const normalized = adapter.validateArgs(step.args);
    normalizedSteps.push({ toolKey: step.toolKey, args: normalized });
    currentKind = outputKindFor(adapter, initial);
    currentCount = 1;
  }

  return {
    plan: { ...input, steps: normalizedSteps },
    normalizedSteps,
  };
}

interface ExecutionHooks {
  onStep?: (step: StepExecution) => void;
}

export class PlanExecutionError extends Error {
  readonly steps: StepExecution[];
  readonly cause: unknown;

  constructor(message: string, steps: StepExecution[], cause: unknown) {
    super(message);
    this.name = 'PlanExecutionError';
    this.steps = steps;
    this.cause = cause;
  }
}

function asFiles(output: File | File[]): File[] {
  return Array.isArray(output) ? output : [output];
}

async function verifyOutput(file: File): Promise<void> {
  if (!(file instanceof File) || file.size <= 0) throw new Error('工具没有返回有效文件');
  if (file.size > 50 * 1024 * 1024) throw new Error('输出文件超过 50 MB');
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/');
  const isText = file.type.startsWith('text/') || /\.txt$/i.test(file.name);
  if (isPdf) {
    if (String.fromCharCode(...head.slice(0, 5)) !== '%PDF-') throw new Error('输出的 PDF 文件头无效');
  } else if (isImage) {
    const signature = String.fromCharCode(...head);
    if (!/^\x89PNG|^\xff\xd8|^RIFF/.test(signature) && !file.type.match(/^image\/(png|jpeg|webp)$/)) {
      throw new Error('输出的图片格式无效');
    }
  } else if (!isText) {
    throw new Error('输出了不支持的文件类型');
  }
}

export async function executePlan(
  plan: AssistantPlan,
  registry: FileRegistry,
  hooks: ExecutionHooks = {},
): Promise<ExecuteResult> {
  const steps: StepExecution[] = plan.steps.map((step) => ({
    toolKey: step.toolKey,
    title: adapterForKey(step.toolKey)?.title ?? step.toolKey,
    status: 'pending',
    outputFileIds: [],
  }));

  let files = registry.getFiles(plan.fileIds);
  if (files.length === 0) throw new Error('找不到要处理的文件');

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    const adapter = adapterForKey(step.toolKey);
    if (!adapter) throw new Error(`不允许的工具：${step.toolKey}`);
    const stepState = steps[index];
    stepState.status = 'running';
    hooks.onStep?.(stepState);
    try {
      const raw = await adapter.execute(files, step.args);
      const outputs = asFiles(raw);
      if (outputs.length === 0 || outputs.length > 50) throw new Error('工具返回了异常数量的文件');
      for (const output of outputs) await verifyOutput(output);
      const metas: WorkspaceFileMeta[] = [];
      for (const output of outputs) {
        metas.push(await registry.add(output, 'result'));
      }
      files = outputs;
      stepState.status = 'succeeded';
      stepState.outputFileIds = metas.map((meta) => meta.fileId);
      hooks.onStep?.(stepState);
    } catch (error) {
      stepState.status = 'failed';
      stepState.error = error instanceof Error ? error.message : '执行失败';
      hooks.onStep?.(stepState);
      throw new PlanExecutionError(stepState.error, steps, error);
    }
  }

  const metas = files
    .map((file) => registry.allMetas().find((meta) => registry.get(meta.fileId) === file))
    .filter((meta): meta is WorkspaceFileMeta => Boolean(meta));
  return { files, metas, steps };
}
