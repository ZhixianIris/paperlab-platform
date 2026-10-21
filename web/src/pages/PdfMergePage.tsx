import { useEffect, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { ArrowIcon, TrashIcon } from '../components/Icons';
import { PDF_TOOLS } from '../lib/tools';
import { formatBytes } from '../lib/format';
import { getPdfInfo, mergePdfs } from '../features/tools/pdf/operations';

const tool = PDF_TOOLS[0];

export function PdfMergePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (files.length === 0) {
      setPageCounts({});
      return;
    }
    Promise.all(files.map((file) => getPdfInfo(file)))
      .then((infos) => {
        if (cancelled) return;
        setPageCounts(
          Object.fromEntries(infos.map((info, index) => [`${files[index].name}:${files[index].size}`, info.pageCount])),
        );
      })
      .catch((infoError: unknown) => {
        if (!cancelled) setError(infoError instanceof Error ? infoError.message : '无法读取 PDF');
      });
    return () => {
      cancelled = true;
    };
  }, [files]);

  async function process() {
    setError('');
    setResult(null);
    if (files.length < 2) {
      setError('至少选择两个 PDF 文件');
      return;
    }
    if (files.length > 20) {
      setError('一次最多合并 20 个 PDF');
      return;
    }
    setProcessing(true);
    try {
      setResult(await mergePdfs(files));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '合并失败');
    } finally {
      setProcessing(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...files];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
    setResult(null);
  }


  return (
    <ToolPageShell tool={tool}>
      <div className="workbench-section">
        <FileDrop
          accept="application/pdf,.pdf"
          multiple
          files={files}
          onChange={(next) => {
            setFiles(next);
            setResult(null);
            setError('');
          }}
          title="拖入 PDF，或点击选择"
          testId="pdf-merge-drop"
        />
        {files.length > 1 ? (
          <div className="reorder-list" data-testid="merge-order">
            {files.map((file, index) => {
              const key = `${file.name}:${file.size}`;
              return (
                <div className="reorder-row" key={key}>
                  <span className="order-index">{String(index + 1).padStart(2, '0')}</span>
                  <div className="reorder-main">
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)}{pageCounts[key] ? ` · ${pageCounts[key]} 页` : ''}</span>
                  </div>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`上移 ${file.name}`}
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    data-testid={`move-up-${index}`}
                  >
                    <ArrowIcon size={15} className="arrow-up" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`下移 ${file.name}`}
                    onClick={() => move(index, 1)}
                    disabled={index === files.length - 1}
                  >
                    <ArrowIcon size={15} className="arrow-down" />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`删除 ${file.name}`}
                    onClick={() => setFiles(files.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={files.length < 2}>
          合并 {files.length || ''} 个 PDF
        </ToolProcessButton>
      </div>
      {result ? <ResultCard file={result} title="PDF 已合并" /> : null}
    </ToolPageShell>
  );
}
