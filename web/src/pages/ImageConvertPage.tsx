import { useEffect, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import { formatLabel, inspectImage, convertImage, type ImageInfo, type OutputFormat, IMAGE_ACCEPT } from '../features/tools/image/operations';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';

const tool = IMAGE_TOOLS[2];

const FORMAT_OPTIONS: Array<{ value: OutputFormat; label: string; note: string }> = [
  { value: 'image/png', label: 'PNG', note: '透明背景' },
  { value: 'image/jpeg', label: 'JPEG', note: '照片常用' },
  { value: 'image/webp', label: 'WebP', note: '体积更小' },
];

export function ImageConvertPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [format, setFormat] = useState<OutputFormat>('image/webp');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState('');
  const file = files[0] ?? null;
  const url = useObjectUrl(file);

  useEffect(() => {
    if (!file) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    inspectImage(file)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((readError: unknown) => {
        if (!cancelled) setError(readError instanceof Error ? readError.message : '无法读取图片');
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
      setResult(await convertImage(file, { format, quality: 90, background: '#ffffff' }));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '转换失败');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <ToolPageShell tool={tool}>
      {!file ? (
        <FileDrop
          accept={IMAGE_ACCEPT}
          files={files}
          onChange={(next) => {
            setFiles(next);
            setResult(null);
            setError('');
          }}
          title="选择要转换的图片"
          testId="image-convert-drop"
        />
      ) : (
        <>
          <div className="editor-filebar">
            <div>
              <span className="file-kind">IMG</span>
              <strong>{file.name}</strong>
              <span>{info ? `${formatLabel(info.type)} · ${info.width} × ${info.height}` : '读取中…'}</span>
            </div>
            <button type="button" className="text-button" onClick={() => { setFiles([]); setResult(null); }}>
              更换图片
            </button>
          </div>
          {url && info ? (
            <div className="convert-preview">
              <img src={url} alt="待转换图片" />
            </div>
          ) : null}
          <div className="format-picker" role="group" aria-label="目标格式">
            {FORMAT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`format-card ${format === option.value ? 'active' : ''}`}
                onClick={() => { setFormat(option.value); setResult(null); }}
                data-testid={`convert-format-${option.label.toLowerCase()}`}
              >
                <strong>{option.label}</strong>
                <span>{option.note}</span>
              </button>
            ))}
          </div>
          {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
          <div className="action-row">
            <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!info}>
              转为 {formatLabel(format)}
            </ToolProcessButton>
            <span className="action-note">{info ? `${info.width} × ${info.height}` : ''}</span>
          </div>
          {result ? <ResultCard file={result} title="转换完成" detail={`${formatLabel(format)} 格式`} /> : null}
        </>
      )}
    </ToolPageShell>
  );
}
