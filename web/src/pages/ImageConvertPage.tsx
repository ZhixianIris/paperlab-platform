import { useEffect, useMemo, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import { formatLabel, inspectImage, convertImage, type ImageInfo, type OutputFormat, IMAGE_ACCEPT } from '../features/tools/image/operations';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';

const tool = IMAGE_TOOLS[2];

export function ImageConvertPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [format, setFormat] = useState<OutputFormat>('image/webp');
  const [quality, setQuality] = useState(88);
  const [background, setBackground] = useState('#ffffff');
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
      setResult(await convertImage(file, { format, quality, background }));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '转换失败');
    } finally {
      setProcessing(false);
    }
  }

  const related = useMemo(() => IMAGE_TOOLS.filter((item) => item.key !== tool.key), []);

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
          title="选择要转换的图片"
          hint="浏览器本地解码，再按所选格式重新编码。"
          testId="image-convert-drop"
        />
        {url && info ? (
          <div className="image-preview-wrap">
            <img src={url} alt="待转换图片" className="image-preview" />
            <span className="image-preview-meta">{formatLabel(info.type)} → {formatLabel(format)} · {info.width} × {info.height}</span>
          </div>
        ) : null}
      </div>
      <div className="field-grid">
        <label className="field">
          <span>目标格式</span>
          <select value={format} onChange={(event) => { setFormat(event.target.value as OutputFormat); setResult(null); }} data-testid="convert-format">
            <option value="image/png">PNG（无损，支持透明）</option>
            <option value="image/jpeg">JPEG（有损，体积小）</option>
            <option value="image/webp">WebP（现代格式）</option>
          </select>
        </label>
        {format !== 'image/png' ? (
          <label className="field">
            <span>质量 <strong>{quality}%</strong></span>
            <input type="range" min={20} max={100} value={quality} onChange={(event) => { setQuality(Number(event.target.value)); setResult(null); }} />
          </label>
        ) : null}
        {format === 'image/jpeg' ? (
          <label className="field">
            <span>透明区域背景</span>
            <input type="color" value={background} onChange={(event) => { setBackground(event.target.value); setResult(null); }} />
            <small>JPEG 不支持透明，将使用此颜色填充。</small>
          </label>
        ) : null}
      </div>
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!file || !info}>
          转换为 {formatLabel(format)}
        </ToolProcessButton>
        <span className="action-note">一次一张，保留原始尺寸。</span>
      </div>
      {result ? <ResultCard file={result} title="转换完成" detail={`${formatLabel(format)} · ${quality}% 质量`} /> : null}
    </ToolPageShell>
  );
}
