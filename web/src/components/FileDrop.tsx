import { useMemo, useRef, useState, type DragEvent } from 'react';
import { FileIcon, ImageIcon, TrashIcon } from './Icons';
import { formatBytes } from '../lib/format';

interface FileDropProps {
  accept: string;
  multiple?: boolean;
  files: File[];
  onChange: (files: File[]) => void;
  title: string;
  testId?: string;
}

export function FileDrop({ accept, multiple = false, files, onChange, title, testId }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const acceptList = useMemo(
    () => accept.split(',').map((item) => item.trim().toLowerCase()),
    [accept],
  );

  function accepted(file: File): boolean {
    if (!file.type) return true;
    return acceptList.some((token) =>
      token.endsWith('/*') ? file.type.startsWith(token.slice(0, -1)) : file.type === token,
    );
  }

  function addFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming).filter(accepted);
    if (multiple) {
      const names = new Set(files.map((file) => `${file.name}:${file.size}`));
      onChange([...files, ...list.filter((file) => !names.has(`${file.name}:${file.size}`))]);
    } else {
      onChange(list.slice(0, 1));
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) addFiles(event.dataTransfer.files);
  }

  return (
    <div>
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid={testId ?? 'file-drop'}
        aria-label={title}
      >
        <div className="dropzone-icon" aria-hidden="true">
          {accept.includes('pdf') ? <FileIcon size={30} /> : <ImageIcon size={30} />}
        </div>
        <strong>{title}</strong>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="visually-hidden"
        data-testid={`${testId ?? 'file-drop'}-input`}
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = '';
        }}
      />
      {files.length > 0 ? (
        <ul className="file-list" aria-label="已选文件">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${index}`} className="file-row">
              <span className="file-kind">{file.type === 'application/pdf' ? 'PDF' : 'IMG'}</span>
              <span className="file-name" title={file.name}>{file.name}</span>
              <span className="file-size">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除 ${file.name}`}
                onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}
              >
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
