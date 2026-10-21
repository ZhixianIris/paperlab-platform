import type { WorkspaceFileMeta } from '../assistant/types';

export interface WorkspaceCheckpoint {
  id: string;
  label: string;
  files: File[];
  metas: WorkspaceFileMeta[];
  createdAt: number;
}

export function pushCheckpoint(
  stack: WorkspaceCheckpoint[],
  label: string,
  files: File[],
  metas: WorkspaceFileMeta[],
): WorkspaceCheckpoint[] {
  const checkpoint: WorkspaceCheckpoint = {
    id: globalThis.crypto?.randomUUID?.() ?? `checkpoint-${Date.now()}`,
    label,
    files: [...files],
    metas: metas.map((meta) => ({ ...meta })),
    createdAt: Date.now(),
  };
  return [...stack, checkpoint].slice(-2);
}

export function popCheckpoint(
  stack: WorkspaceCheckpoint[],
): { checkpoint: WorkspaceCheckpoint; rest: WorkspaceCheckpoint[] } | null {
  if (stack.length === 0) return null;
  const checkpoint = stack[stack.length - 1];
  return { checkpoint, rest: stack.slice(0, -1) };
}
