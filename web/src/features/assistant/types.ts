export type WorkspaceFileKind = 'pdf' | 'image' | 'text';

export interface WorkspaceFileMeta {
  fileId: string;
  kind: WorkspaceFileKind;
  name: string;
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  width?: number;
  height?: number;
  hasTextLayer?: boolean;
  source: 'upload' | 'result';
  createdAt: number;
}

export interface PlannerFileMeta {
  fileId: string;
  kind: WorkspaceFileKind;
  sizeBytes: number;
  pageCount?: number;
  width?: number;
  height?: number;
  hasTextLayer?: boolean;
}

export interface PlanStep {
  toolKey: string;
  args: Record<string, unknown>;
}

export interface AssistantPlan {
  kind: 'plan';
  source: 'local' | 'cloud';
  fileIds: string[];
  steps: PlanStep[];
  requiresConfirmation: boolean;
  reason: string;
  message?: string;
}

export type PlanOutcome =
  | AssistantPlan
  | { kind: 'needs_clarification'; message: string; manualPath?: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'requires_content_consent'; message: string };

export interface StepExecution {
  toolKey: string;
  title: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  outputFileIds: string[];
  error?: string;
}

export interface ExecuteResult {
  files: File[];
  metas: WorkspaceFileMeta[];
  steps: StepExecution[];
}
