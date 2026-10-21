import { useEffect, useMemo, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import { formatBytes } from '../lib/format';
import { inspectImage, compressImage, type ImageInfo, IMAGE_ACCEPT } from '../features/tools/image/operations';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';

const tool = IMAGE_TOOLS[3];

export function ImageCompressPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [maxSizeMB, setMaxSizeMB] = useState(1);
  const [quality, setQuality] = useState(80);
  const [maxDimension, setMaxDimension] = useState(4096);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
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
    setSaving(null);
    setProcessing(true);
    try {
      const output = await compressImage(file, { maxSizeMB, quality, maxDimension });
      setResult(output);
      setSaving(Math.max(0, Math.round((1 - output.size / file.size) * 100)));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '压缩失败');
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
            setSaving(null);
          }}
          title="选择要压缩的图片"
          hint="压缩在浏览器内用 Web Worker 完成，不上传文件。"
          testId="image-compress-drop"
        />
        {url && info ? (
          <div className="image-preview-wrap">
            <img src={url} alt="待压缩图片" className="image-preview" />
            <span className="image-preview-meta">{info.width} × {info.height} · {formatBytes(info.size)}</span>
          </div>
        ) : null}
      </div>
      <div className="field-grid">
        <label className="field">
          <span>目标体积（MB）</span>
          <input type="number" min={0.05} max={20} step={0.05} value={maxSizeMB} onChange={(event) => { setMaxSizeMB(Number(event.target.value) || 0.05); setResult(null); }} data-testid="compress-size" />
          <small>算法会在不超过目标体积的前提下尽量保留清晰度。</small>
        </label>
        <label className="field">
          <span>初始质量 <strong>{quality}%</strong></span>
          <input type="range" min={20} max={100} value={quality} onChange={(event) => { setQuality(Number(event.target.value)); setResult(null); }} />
        </label>
        <label className="field">
          <span>最大边长（px）</span>
          <input type="number" min={256} max={8192} value={maxDimension} onChange={(event) => { setMaxDimension(Number(event.target.value) || 4096); setResult(null); }} />
          <small>仅当原图超过此边长时才会缩小。</small>
        </label>
      </div>
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!file || !info}>
          压缩图片
        </ToolProcessButton>
        <span className="action-note">保持原格式；透明通道按浏览器编码器处理。</span>
      </div>
      {result ? (
        <ResultCard
          file={result}
          title="压缩完成"
          detail={`${formatBytes(file?.size ?? 0)} → ${formatBytes(result.size)}${saving !== null ? ` · 减少约 ${saving}%` : ''}`}
        />
      ) : null}
    </ToolPageShell>
  );
}
