import { useEffect, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { PdfPreview } from '../components/PdfPreview';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { PDF_TOOLS } from '../lib/tools';
import { getPdfInfo, rotatePdf, type PdfInfo } from '../features/tools/pdf/operations';

const tool = PDF_TOOLS[2];

export function PdfRotatePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [allPages, setAllPages] = useState(true);
  const [range, setRange] = useState('1');
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState('');
  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    getPdfInfo(file)
      .then((next) => {
        if (!cancelled) {
          setInfo(next);
          setRange((current) => (current === '1' ? `1-${next.pageCount}` : current));
        }
      })
      .catch((infoError: unknown) => {
        if (!cancelled) setError(infoError instanceof Error ? infoError.message : '无法读取 PDF');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  async function process() {
    if (!file) return;
    setError('');
    setResult(null);
    setProcessing(true);
    try {
      setResult(await rotatePdf(file, { angle, allPages, range }));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '旋转失败');
    } finally {
      setProcessing(false);
    }
  }


  return (
    <ToolPageShell tool={tool}>
      <div className="workbench-section">
        <FileDrop
          accept="application/pdf,.pdf"
          files={files}
          onChange={(next) => {
            setFiles(next);
            setResult(null);
            setError('');
          }}
          title="选择要旋转的 PDF"
          testId="pdf-rotate-drop"
        />
        {file ? <PdfPreview file={file} /> : null}
      </div>
      <div className="field-grid">
        <div className="field">
          <span>旋转角度</span>
          <div className="segmented" role="group" aria-label="旋转角度">
            {([90, 180, 270] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={angle === value ? 'active' : ''}
                onClick={() => {
                  setAngle(value);
                  setResult(null);
                }}
              >
                {value}°
              </button>
            ))}
          </div>
          <small>在原旋转角度上累加，支持已经旋转过的文件。</small>
        </div>
        <label className="field">
          <span>应用范围</span>
          <select
            value={allPages ? 'all' : 'range'}
            onChange={(event) => {
              setAllPages(event.target.value === 'all');
              setResult(null);
            }}
            data-testid="rotate-scope"
          >
            <option value="all">全部页面</option>
            <option value="range">指定页面</option>
          </select>
          {!allPages ? (
            <input
              type="text"
              value={range}
              onChange={(event) => {
                setRange(event.target.value);
                setResult(null);
              }}
              placeholder="例如 1,3-5"
              data-testid="rotate-range"
            />
          ) : null}
          <small>{info ? `当前共 ${info.pageCount} 页` : '等待选择文件'}</small>
        </label>
      </div>
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!file}>
          旋转 PDF
        </ToolProcessButton>
      </div>
      {result ? <ResultCard file={result} title="旋转完成" /> : null}
    </ToolPageShell>
  );
}
