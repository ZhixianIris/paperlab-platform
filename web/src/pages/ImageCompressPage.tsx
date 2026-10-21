import { useEffect, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import { formatBytes } from '../lib/format';
import { inspectImage, compressImage, type ImageInfo, IMAGE_ACCEPT } from '../features/tools/image/operations';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';
import { BeforeAfter } from '../features/tools/image/BeforeAfter';

const tool = IMAGE_TOOLS[3];

const PRESETS = [
  { id: 'small', label: '轻量', note: '优先更小体积', maxSizeMB: 0.35, quality: 60, maxDimension: 1800 },
  { id: 'balanced', label: '均衡', note: '清晰与体积平衡', maxSizeMB: 1, quality: 78, maxDimension: 2800 },
  { id: 'quality', label: '清晰', note: '尽量保留细节', maxSizeMB: 3, quality: 92, maxDimension: 4096 },
] as const;

type PresetId = (typeof PRESETS)[number]['id'];

export function ImageCompressPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [presetId, setPresetId] = useState<PresetId>('balanced');
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
    const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[1];
    setError('');
    setResult(null);
    setSaving(null);
    setProcessing(true);
    try {
      const output = await compressImage(file, preset);
      setResult(output);
      setSaving(Math.max(0, Math.round((1 - output.size / file.size) * 100)));
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '压缩失败');
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
          title="选择要压缩的图片"
          testId="image-compress-drop"
        />
      ) : (
        <>
          <div className="editor-filebar">
            <div>
              <span className="file-kind">IMG</span>
              <strong>{file.name}</strong>
              <span>{info ? `${formatBytes(info.size)} · ${info.width} × ${info.height}` : '读取中…'}</span>
            </div>
            <button type="button" className="text-button" onClick={() => { setFiles([]); setResult(null); }}>
              更换图片
            </button>
          </div>
          {url && info ? (
            <div className="convert-preview">
              <img src={url} alt="待压缩图片" />
            </div>
          ) : null}
          <div className="preset-grid" role="group" aria-label="压缩强度">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`preset-card ${presetId === preset.id ? 'active' : ''}`}
                onClick={() => { setPresetId(preset.id); setResult(null); }}
                data-testid={`compress-preset-${preset.id}`}
              >
                <strong>{preset.label}</strong>
                <span>{preset.note}</span>
              </button>
            ))}
          </div>
          {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
          <div className="action-row">
            <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!info}>
              压缩图片
            </ToolProcessButton>
            <span className="action-note">{info ? formatBytes(info.size) : ''}</span>
          </div>
          {result ? (
            <>
              <BeforeAfter before={file} after={result} beforeLabel="原图" afterLabel="压缩后" />
              <ResultCard
                file={result}
                title="压缩完成"
                detail={`${formatBytes(file.size)} → ${formatBytes(result.size)}${saving !== null ? ` · 减少约 ${saving}%` : ''}`}
              />
            </>
          ) : null}
        </>
      )}
    </ToolPageShell>
  );
}
