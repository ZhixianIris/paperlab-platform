import { useEffect, useState } from 'react';
import { downloadFile } from '../lib/download';
import { formatBytes } from '../lib/format';
import { DownloadIcon } from './Icons';

interface ResultCardProps {
  file: File;
  title?: string;
  detail?: string;
}

export function ResultCard({ file, title = '处理完成', detail }: ResultCardProps) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <section className="result-card" data-testid="result-card" aria-live="polite">
      <div className="result-head">
        <div>
          <span className="eyebrow">RESULT</span>
          <h3>{title}</h3>
          <p>{detail || '文件已在浏览器内生成，未上传到服务器。'}</p>
        </div>
        <span className="success-badge">已完成</span>
      </div>
      <div className="result-body">
        {preview ? (
          <img src={preview} alt="处理结果预览" className="result-image" />
        ) : (
          <div className="result-file-icon" aria-hidden="true">PDF</div>
        )}
        <div className="result-meta">
          <strong>{file.name}</strong>
          <span>{formatBytes(file.size)}</span>
          <span>{file.type || 'application/octet-stream'}</span>
        </div>
      </div>
      <button
        type="button"
        className="button button-accent"
        onClick={() => downloadFile(file)}
        data-testid="result-download"
      >
        <DownloadIcon size={18} /> 下载文件
      </button>
    </section>
  );
}
