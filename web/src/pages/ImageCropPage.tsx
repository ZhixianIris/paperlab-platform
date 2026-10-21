import { useEffect, useMemo, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import { formatLabel, inspectImage, cropImage, type ImageInfo, type OutputFormat, IMAGE_ACCEPT } from '../features/tools/image/operations';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';

const tool = IMAGE_TOOLS[0];

export function ImageCropPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [width, setWidth] = useState(100);
  const [height, setHeight] = useState(100);
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
        setX(0);
        setY(0);
        setWidth(Math.max(1, Math.round(next.width * 0.8)));
        setHeight(Math.max(1, Math.round(next.height * 0.8)));
      })
      .catch((readError: unknown) => {
        if (!cancelled) setError(readError instanceof Error ? readError.message : '无法读取图片');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  function updateX(value: number) {
    setX(Math.max(0, Math.min(Math.round(value) || 0, (info?.width ?? 1) - 1)));
    setResult(null);
  }

  function updateY(value: number) {
    setY(Math.max(0, Math.min(Math.round(value) || 0, (info?.height ?? 1) - 1)));
    setResult(null);
  }

  function updateWidth(value: number) {
    setWidth(Math.max(1, Math.min(Math.round(value) || 1, (info?.width ?? 1) - x)));
    setResult(null);
  }

  function updateHeight(value: number) {
    setHeight(Math.max(1, Math.min(Math.round(value) || 1, (info?.height ?? 1) - y)));
    setResult(null);
  }

  async function process() {
    if (!file) return;
    setError('');
    setResult(null);
    setProcessing(true);
    try {
      setResult(await cropImage(file, { x, y, width, height, format, quality }));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '裁剪失败');
    } finally {
      setProcessing(false);
    }
  }

  const related = useMemo(() => IMAGE_TOOLS.filter((item) => item.key !== tool.key), []);
  const box = info
    ? {
        left: `${(x / info.width) * 100}%`,
        top: `${(y / info.height) * 100}%`,
        width: `${(width / info.width) * 100}%`,
        height: `${(height / info.height) * 100}%`,
      }
    : undefined;

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
          testId="image-crop-drop"
        />
        {url && info ? (
          <div className="crop-stage">
            <img src={url} alt="待裁剪图片" />
            <div className="crop-overlay" style={box} />
            <span className="crop-size-label">{width} × {height}</span>
          </div>
        ) : null}
        {info ? <p className="muted">原始尺寸 {info.width} × {info.height} · {formatLabel(info.type)}</p> : null}
      </div>
      <div className="field-grid field-grid-4">
        <label className="field">
          <span>X 坐标</span>
          <input type="number" min={0} max={info ? info.width - 1 : undefined} value={x} onChange={(event) => updateX(Number(event.target.value))} data-testid="crop-x" />
        </label>
        <label className="field">
          <span>Y 坐标</span>
          <input type="number" min={0} max={info ? info.height - 1 : undefined} value={y} onChange={(event) => updateY(Number(event.target.value))} data-testid="crop-y" />
        </label>
        <label className="field">
          <span>宽度</span>
          <input type="number" min={1} max={info ? info.width - x : undefined} value={width} onChange={(event) => updateWidth(Number(event.target.value))} data-testid="crop-width" />
        </label>
        <label className="field">
          <span>高度</span>
          <input type="number" min={1} max={info ? info.height - y : undefined} value={height} onChange={(event) => updateHeight(Number(event.target.value))} data-testid="crop-height" />
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
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!file || !info}>
          裁剪图片
        </ToolProcessButton>
        <span className="action-note">坐标以原图像素为单位。</span>
      </div>
      {result ? <ResultCard file={result} title="裁剪完成" detail={`输出 ${width} × ${height} 像素`} /> : null}
    </ToolPageShell>
  );
}
