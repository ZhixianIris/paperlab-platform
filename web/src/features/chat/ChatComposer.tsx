import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ArrowIcon, FileIcon, ImageIcon, PlusIcon } from '../../components/Icons';
import { formatBytes } from '../../lib/format';
import type { WorkspaceFileMeta } from '../assistant/types';

export interface ComposerFile {
  file: File;
  meta: WorkspaceFileMeta;
}

export function ChatComposer({
  input,
  onInput,
  attachments,
  onFiles,
  onRemove,
  onSend,
  busy,
  canSend,
  contextLabel,
  hint,
  testId = 'ai',
}: {
  input: string;
  onInput: (value: string) => void;
  attachments: ComposerFile[];
  onFiles: (files: File[]) => void;
  onRemove: (fileId: string) => void;
  onSend: () => void;
  busy: boolean;
  canSend: boolean;
  contextLabel?: string;
  hint?: string;
  testId?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 4);
    if (list.length) onFiles(list);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSend && !busy) onSend();
    }
  }

  return (
    <div
      className={`chat-composer ${dragging ? 'is-dragging' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {attachments.length > 0 ? (
        <div className="composer-attachments">
          {attachments.map(({ file, meta }) => (
            <div className="composer-attachment file-row" key={meta.fileId} data-testid="ai-attachment">
              <span className="composer-file-icon">
                {meta.kind === 'pdf' ? <FileIcon size={18} /> : <ImageIcon size={18} />}
              </span>
              <div>
                <strong>{meta.name}</strong>
                <small>{formatBytes(file.size)} · {meta.kind === 'pdf' ? `${meta.pageCount ?? 0} 页` : '图片'}</small>
              </div>
              <button type="button" className="composer-remove" aria-label={`移除 ${meta.name}`} onClick={() => onRemove(meta.fileId)}>×</button>
            </div>
          ))}
        </div>
      ) : null}
      {contextLabel ? <div className="composer-context">当前上下文：{contextLabel}</div> : null}
      <div className="composer-row">
        <button
          type="button"
          className="composer-attach"
          aria-label="添加 PDF 或图片"
          onClick={() => inputRef.current?.click()}
          data-testid="ai-attach"
        >
          <PlusIcon size={21} />
        </button>
        <textarea
          value={input}
          onChange={(event) => onInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="询问 PaperLab，或描述要处理的文件"
          rows={1}
          data-testid="ai-command"
          disabled={busy}
        />
        <button
          type="button"
          className="composer-send"
          aria-label="发送"
          onClick={onSend}
          disabled={busy || !canSend}
          data-testid="ai-command-send"
        >
          {busy ? <span className="spinner" /> : <ArrowIcon size={19} />}
        </button>
      </div>
      {hint ? <div className="composer-hint">{hint}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
        multiple
        className="visually-hidden"
        data-testid={`${testId}-drop-input`}
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}
