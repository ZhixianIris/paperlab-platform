import type { WorkspaceFileMeta } from '../assistant/types';

const DB_NAME = 'paperlab-workspace';
const DB_VERSION = 1;
const STORE = 'drafts';
const ROOT_DIR = 'paperlab-drafts';

export interface StoredDraftFile {
  name: string;
  type: string;
  size: number;
  path: string;
  fileId: string;
}

export interface DraftRecord {
  id: string;
  ownerKey: string;
  tenantKey: string;
  title: string;
  stage: string;
  messages: unknown[];
  files: StoredDraftFile[];
  originalName: string;
  createdAt: number;
  updatedAt: number;
}

export interface SaveDraftInput {
  ownerKey: string;
  tenantKey: string;
  title: string;
  stage: string;
  messages: unknown[];
  files: File[];
  metas: WorkspaceFileMeta[];
  draftId?: string;
}

function segment(value: string): string {
  return encodeURIComponent(value || 'default').replace(/%/g, '_');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持本机草稿存储'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('scope', ['ownerKey', 'tenantKey'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机草稿数据库'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = run(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('本机草稿操作失败'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(new Error('本机草稿事务失败'));
    };
  }));
}

export function storageSupported(): boolean {
  return Boolean(
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    'getDirectory' in navigator.storage &&
    typeof indexedDB !== 'undefined',
  );
}

async function draftsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error('当前浏览器不支持本机草稿存储');
  }
  return navigator.storage.getDirectory();
}

async function scopeDirectory(
  ownerKey: string,
  tenantKey: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const root = await draftsRoot();
  const drafts = await root.getDirectoryHandle(ROOT_DIR, { create });
  const owner = await drafts.getDirectoryHandle(segment(ownerKey), { create });
  return owner.getDirectoryHandle(segment(tenantKey), { create });
}

async function draftDirectory(
  ownerKey: string,
  tenantKey: string,
  draftId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const scope = await scopeDirectory(ownerKey, tenantKey, create);
  return scope.getDirectoryHandle(segment(draftId), { create });
}

async function writeFileToDirectory(
  directory: FileSystemDirectoryHandle,
  path: string,
  blob: Blob,
): Promise<void> {
  const handle = await directory.getFileHandle(path, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

async function readFileFromDirectory(
  directory: FileSystemDirectoryHandle,
  path: string,
): Promise<File> {
  const handle = await directory.getFileHandle(path);
  return handle.getFile();
}

async function removeDraftDirectory(
  ownerKey: string,
  tenantKey: string,
  draftId: string,
): Promise<void> {
  try {
    const scope = await scopeDirectory(ownerKey, tenantKey, false);
    await scope.removeEntry(segment(draftId), { recursive: true });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return;
    if (error instanceof Error && /not found/i.test(error.message)) return;
    throw error;
  }
}

async function quotaAllows(bytes: number): Promise<void> {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate();
  if (!estimate.quota || !estimate.usage) return;
  const free = estimate.quota - estimate.usage;
  if (free < bytes + 2 * 1024 * 1024) {
    throw new Error('本机存储空间不足，请先下载重要结果或清空草稿');
  }
}

export async function saveDraft(input: SaveDraftInput): Promise<DraftRecord> {
  if (!storageSupported()) throw new Error('当前浏览器不支持本机草稿存储');
  if (input.files.length !== input.metas.length) throw new Error('草稿文件状态不一致');
  const required = input.files.reduce((sum, file) => sum + file.size, 0);
  await quotaAllows(required);

  const id = input.draftId || (globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`);
  const now = Date.now();
  if (input.draftId) {
    await removeDraftDirectory(input.ownerKey, input.tenantKey, id);
  }
  const directory = await draftDirectory(input.ownerKey, input.tenantKey, id, true);
  const storedFiles: StoredDraftFile[] = [];
  for (let index = 0; index < input.files.length; index += 1) {
    const file = input.files[index];
    const meta = input.metas[index];
    const path = `file-${String(index).padStart(3, '0')}.bin`;
    await writeFileToDirectory(directory, path, file);
    storedFiles.push({
      name: file.name,
      type: file.type,
      size: file.size,
      path,
      fileId: meta.fileId,
    });
  }

  const record: DraftRecord = {
    id,
    ownerKey: input.ownerKey,
    tenantKey: input.tenantKey,
    title: input.title,
    stage: input.stage,
    messages: input.messages,
    files: storedFiles,
    originalName: input.files[0]?.name || '',
    createdAt: now,
    updatedAt: now,
  };
  await withStore('readwrite', (store) => store.put(record));
  return record;
}

export async function listDrafts(ownerKey: string, tenantKey: string): Promise<DraftRecord[]> {
  if (!storageSupported()) return [];
  const records = await withStore<DraftRecord[]>('readonly', (store) => store.getAll());
  return records
    .filter((record) => record.ownerKey === ownerKey && record.tenantKey === tenantKey)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function loadDraftFiles(record: DraftRecord): Promise<File[]> {
  const directory = await draftDirectory(record.ownerKey, record.tenantKey, record.id, false);
  const files: File[] = [];
  for (const stored of record.files) {
    const file = await readFileFromDirectory(directory, stored.path);
    files.push(new File([file], stored.name, { type: stored.type || file.type }));
  }
  return files;
}

export async function deleteDraft(record: DraftRecord): Promise<void> {
  await removeDraftDirectory(record.ownerKey, record.tenantKey, record.id);
  await withStore('readwrite', (store) => store.delete(record.id));
}

export async function clearDrafts(ownerKey: string, tenantKey: string): Promise<void> {
  const drafts = await listDrafts(ownerKey, tenantKey);
  for (const draft of drafts) {
    await removeDraftDirectory(ownerKey, tenantKey, draft.id);
    await withStore('readwrite', (store) => store.delete(draft.id));
  }
}
