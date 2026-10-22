import { useEffect, useState } from 'react';
import { BeforeAfter } from '../tools/image/BeforeAfter';
import { useObjectUrl } from '../tools/image/useObjectUrl';
import { downloadFile } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { PdfPreview } from '../../components/PdfPreview';
import { DownloadIcon, FileIcon, XIcon } from '../../components/Icons';
import { describeFile } from '../workspace/inspect';
import type { WorkspaceFileMeta } from '../assistant/types';

export interface PreviewTarget {
  file: File;
  meta: WorkspaceFileMeta;
  originalFile: File | null;
  showCompare: boolean;
}

export function FilePreviewDrawer({
  target,
  onClose,
}: {
  target: PreviewTarget | null;
  onClose: () => void;
}) {
  if (!target) return null;
  return <PreviewContent target={target} onClose={onClose} />;
}

function PreviewContent({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const { file, meta, originalFile, showCompare } = target;
  const imageUrl = useObjectUrl(file.type.startsWith('image/') ? file : null);
  const [pdfSide, setPdfSide] = useState<'result' | 'original'>('result');

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const canCompare = showCompare && Boolean(originalFile) && originalFile !== file;
  return (
    <div className="file-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="file-preview-drawer" data-testid="ai-preview" role="dialog" aria-label="文件预览">
        <div className="file-preview-head">
          <div>
            <span className="file-preview-kicker">文件预览</span>
            <strong>{meta.name}</strong>
            <small>{describeFile(meta)} · {formatBytes(file.size)}</small>
          </div>
          <div className="file-preview-head-actions">
            <button type="button" className="button button-ghost button-small" onClick={() => downloadFile(file)} data-testid="ai-preview-download">
              <DownloadIcon size={14} /> 下载
            </button>
            <button type="button" className="icon-button" aria-label="关闭预览" onClick={onClose} data-testid="ai-preview-close"><XIcon size={17} /></button>
          </div>
        </div>
        <div className="file-preview-body">
          {isPdf ? (
            <>
              {canCompare ? (
                <div className="preview-side-switch">
                  <button type="button" className={pdfSide === 'result' ? 'active' : ''} onClick={() => setPdfSide('result')}>结果</button>
                  <button type="button" className={pdfSide === 'original' ? 'active' : ''} onClick={() => setPdfSide('original')}>原文件</button>
                </div>
              ) : null}
              <PdfPreview file={pdfSide === 'original' && originalFile ? originalFile : file} />
            </>
          ) : file.type.startsWith('image/') && imageUrl ? (
            canCompare && originalFile ? (
              <BeforeAfter before={originalFile} after={file} beforeLabel="原图" afterLabel="当前结果" />
            ) : (
              <div className="workspace-image-preview"><img src={imageUrl} alt={meta.name} /></div>
            )
          ) : (
            <div className="workspace-text-preview"><FileIcon size={28} /><p>{meta.name}</p><small>{formatBytes(file.size)}</small></div>
          )}
        </div>
      </aside>
    </div>
  );
}
