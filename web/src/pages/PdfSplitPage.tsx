import { useEffect, useMemo, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { PdfPreview } from '../components/PdfPreview';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { PDF_TOOLS } from '../lib/tools';
import { extractPdfPages, getPdfInfo, type PdfInfo } from '../features/tools/pdf/operations';

const tool = PDF_TOOLS[1];

export function PdfSplitPage() {
  const [files, setFiles] = useState<File[]>([]);
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
        if (cancelled) return;
        setInfo(next);
        setRange((current) => (current === '1' ? `1-${next.pageCount}` : current));
      })
      .catch((infoError: unknown) => {
        if (!cancelled) {
          setInfo(null);
          setError(infoError instanceof Error ? infoError.message : '无法读取 PDF');
        }
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
      setResult(await extractPdfPages(file, range));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '拆分失败');
    } finally {
      setProcessing(false);
    }
  }

  const related = useMemo(() => PDF_TOOLS.filter((item) => item.key !== tool.key), []);

  return (
    <ToolPageShell tool={tool} related={related}>
      <div className="workbench-section">
        <FileDrop
          accept="application/pdf,.pdf"
          files={files}
          onChange={(next) => {
            setFiles(next);
            setResult(null);
            setError('');
          }}
          title="选择要拆分的 PDF"
          hint="上传后只在本机解析页数。"
          testId="pdf-split-drop"
        />
        {file ? <PdfPreview file={file} /> : null}
      </div>
      <div className="field-grid">
        <label className="field">
          <span>要保留的页码</span>
          <input
            type="text"
            value={range}
            onChange={(event) => {
              setRange(event.target.value);
              setResult(null);
            }}
            placeholder="例如 1,3-5"
            data-testid="page-range"
          />
          <small>使用逗号分隔页码，短横线表示范围。{info ? ` 当前共 ${info.pageCount} 页。` : ''}</small>
        </label>
        <div className="field static-note">
          <span>输出</span>
          <strong>一份新 PDF</strong>
          <small>未选中的页面会被移除，选中页的原始文字与矢量内容保留。</small>
        </div>
      </div>
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!file}>
          提取页面
        </ToolProcessButton>
        <span className="action-note">{info ? `共 ${info.pageCount} 页` : '等待选择文件'}</span>
      </div>
      {result ? <ResultCard file={result} title="拆分完成" /> : null}
    </ToolPageShell>
  );
}
