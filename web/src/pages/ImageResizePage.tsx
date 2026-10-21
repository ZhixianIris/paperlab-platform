import { useEffect, useMemo, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import { formatLabel, inspectImage, resizeImage, type ImageInfo, type OutputFormat, IMAGE_ACCEPT } from '../features/tools/image/operations';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';

const tool = IMAGE_TOOLS[1];

export function ImageResizePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [mode, setMode] = useState<'pixels' | 'percent'>('pixels');
  const [width, setWidth] = useState(1000);
  const [height, setHeight] = useState(1000);
  const [percent, setPercent] = useState(50);
  const [keepAspect, setKeepAspect] = useState(true);
  const [format, setFormat] = useState<OutputFormat>('image/png');
  const [quality, setQuality] = useState(90);
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
        if (cancelled) return;
        setInfo(next);
        setWidth(next.width);
        setHeight(next.height);
        setFormat(next.type === 'image/jpeg' ? 'image/jpeg' : next.type === 'image/webp' ? 'image/webp' : 'image/png');
      })
      .catch((readError: unknown) => {
        if (!cancelled) setError(readError instanceof Error ? readError.message : '无法读取图片');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  function changeWidth(value: number) {
    const next = Math.max(1, Math.round(value) || 1);
    setWidth(next);
    if (info && keepAspect) setHeight(Math.max(1, Math.round((next / info.width) * info.height)));
    setResult(null);
  }

  function changeHeight(value: number) {
    const next = Math.max(1, Math.round(value) || 1);
    setHeight(next);
    if (info && keepAspect) setWidth(Math.max(1, Math.round((next / info.height) * info.width)));
    setResult(null);
  }

  async function process() {
    if (!file) return;
    setError('');
    setResult(null);
    setProcessing(true);
    try {
      setResult(
        await resizeImage(file, {
          mode,
          width,
          height,
          percent,
          keepAspect,
          format,
          quality,
        }),
      );
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '缩放失败');
    } finally {
      setProcessing(false);
    }
  }

  const related = useMemo(() => IMAGE_TOOLS.filter((item) => item.key !== tool.key), []);
  const estimatedWidth = mode === 'percent' && info ? Math.round((info.width * percent) / 100) : width;
  const estimatedHeight = mode === 'percent' && info ? Math.round((info.height * percent) / 100) : height;

  return (
    <ToolPageShell tool={tool} related={related}>
      <div className="workbench-section">
        <FileDrop
          accept={IMAGE_ACCEPT}
          files={files}
          onChange={(next) => {
            setFiles(next);
            setResult(null);
            setError('');
          }}
          title="选择一张图片"
          hint="支持 PNG、JPEG、WebP；最大 50 MB。"
          testId="image-resize-drop"
        />
        {url && info ? (
          <div className="image-preview-wrap">
            <img src={url} alt="待缩放图片" className="image-preview" />
            <span className="image-preview-meta">{info.width} × {info.height} · {formatLabel(info.type)}</span>
          </div>
        ) : null}
      </div>
      <div className="field-grid">
        <div className="field">
          <span>调整方式</span>
          <div className="segmented" role="group" aria-label="调整方式">
            <button type="button" className={mode === 'pixels' ? 'active' : ''} onClick={() => { setMode('pixels'); setResult(null); }}>按像素</button>
            <button type="button" className={mode === 'percent' ? 'active' : ''} onClick={() => { setMode('percent'); setResult(null); }}>按百分比</button>
          </div>
        </div>
        {mode === 'pixels' ? (
          <>
            <label className="field">
              <span>宽度（px）</span>
              <input type="number" min={1} max={12000} value={width} onChange={(event) => changeWidth(Number(event.target.value))} data-testid="resize-width" />
            </label>
            <label className="field">
              <span>高度（px）</span>
              <input type="number" min={1} max={12000} value={height} disabled={keepAspect} onChange={(event) => changeHeight(Number(event.target.value))} data-testid="resize-height" />
            </label>
          </>
        ) : (
          <label className="field">
            <span>缩放比例 <strong>{percent}%</strong></span>
            <input type="range" min={1} max={200} value={percent} onChange={(event) => { setPercent(Number(event.target.value)); setResult(null); }} data-testid="resize-percent" />
          </label>
        )}
        <label className="checkbox-field">
          <input type="checkbox" checked={keepAspect} onChange={(event) => { setKeepAspect(event.target.checked); setResult(null); }} />
          <span>保持宽高比</span>
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>输出格式</span>
          <select value={format} onChange={(event) => { setFormat(event.target.value as OutputFormat); setResult(null); }}>
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPEG</option>
            <option value="image/webp">WebP</option>
          </select>
        </label>
        {format !== 'image/png' ? (
          <label className="field">
            <span>质量 <strong>{quality}%</strong></span>
            <input type="range" min={20} max={100} value={quality} onChange={(event) => { setQuality(Number(event.target.value)); setResult(null); }} />
          </label>
        ) : null}
      </div>
      {info ? <p className="size-estimate">输出约 {estimatedWidth} × {estimatedHeight} 像素</p> : null}
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!file || !info}>
          缩放图片
        </ToolProcessButton>
        <span className="action-note">使用高质量插值，不改变原始文件。</span>
      </div>
      {result ? <ResultCard file={result} title="缩放完成" detail={`输出 ${estimatedWidth} × ${estimatedHeight} 像素`} /> : null}
    </ToolPageShell>
  );
}
