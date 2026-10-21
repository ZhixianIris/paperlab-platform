import type { PlannerFileMeta, WorkspaceFileMeta } from '../assistant/types';
import { inspectWorkspaceFile, plannerMetadata } from './inspect';

export class FileRegistry {
  private files = new Map<string, File>();
  private metadata = new Map<string, WorkspaceFileMeta>();
  private byObject = new WeakMap<File, string>();

  async add(file: File, source: WorkspaceFileMeta['source'] = 'upload'): Promise<WorkspaceFileMeta> {
    const existing = this.byObject.get(file);
    if (existing) {
      const meta = this.metadata.get(existing);
      if (meta) return meta;
    }
    const meta = await inspectWorkspaceFile(file, source);
    this.files.set(meta.fileId, file);
    this.metadata.set(meta.fileId, meta);
    this.byObject.set(file, meta.fileId);
    return meta;
  }

  get(fileId: string): File | null {
    return this.files.get(fileId) ?? null;
  }

  getMeta(fileId: string): WorkspaceFileMeta | null {
    return this.metadata.get(fileId) ?? null;
  }

  getFiles(fileIds: string[]): File[] {
    return fileIds
      .map((fileId) => this.files.get(fileId))
      .filter((file): file is File => Boolean(file));
  }

  getMetas(fileIds: string[]): WorkspaceFileMeta[] {
    return fileIds
      .map((fileId) => this.metadata.get(fileId))
      .filter((meta): meta is WorkspaceFileMeta => Boolean(meta));
  }

  allMetas(): WorkspaceFileMeta[] {
    return [...this.metadata.values()];
  }

  plannerMetadata(fileIds: string[]): PlannerFileMeta[] {
    return this.getMetas(fileIds).map(plannerMetadata);
  }

  has(fileId: string): boolean {
    return this.files.has(fileId);
  }

  remove(fileId: string): void {
    const file = this.files.get(fileId);
    if (file) this.byObject.delete(file);
    this.files.delete(fileId);
    this.metadata.delete(fileId);
  }
}

export const sessionRegistry = new FileRegistry();
