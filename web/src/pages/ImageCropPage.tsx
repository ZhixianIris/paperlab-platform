import { useEffect, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import {
  cropImage,
  formatLabel,
  inspectImage,
  type ImageInfo,
  type OutputFormat,
  IMAGE_ACCEPT,
} from '../features/tools/image/operations';
import { CropEditor, type CropRect } from '../features/tools/image/CropEditor';
import { BeforeAfter } from '../features/tools/image/BeforeAfter';

const tool = IMAGE_TOOLS[0];

function initialCrop(info: ImageInfo): CropRect {
  return {
    x: Math.round(info.width * 0.1),
    y: Math.round(info.height * 0.1),
    width: Math.round(info.width * 0.8),
    height: Math.round(info.height * 0.8),
  };
}

export function ImageCropPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [format, setFormat] = useState<OutputFormat>('image/png');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState('');
  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setInfo(null);
      setCrop(null);
      return;
    }
    let cancelled = false;
    inspectImage(file)
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setCrop(initialCrop(next));
        setFormat(next.type === 'image/jpeg' ? 'image/jpeg' : next.type === 'image/webp' ? 'image/webp' : 'image/png');
      })
      .catch((readError: unknown) => {
        if (!cancelled) setError(readError instanceof Error ? readError.message : '无法读取图片');
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  async function process() {
    if (!file || !crop) return;
    setError('');
    setResult(null);
    setProcessing(true);
    try {
      setResult(
        await cropImage(file, {
          x: crop.x,
          y: crop.y,
          width: crop.width,
          height: crop.height,
          format,
          quality: 92,
        }),
      );
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '裁剪失败');
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
          title="选择一张图片"
          testId="image-crop-drop"
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
          {info && crop ? (
            <CropEditor
              file={file}
              info={info}
              value={crop}
              onChange={(next) => {
                setCrop(next);
                setResult(null);
              }}
              onReset={() => {
                setCrop(initialCrop(info));
                setResult(null);
              }}
            />
          ) : null}
          <div className="visual-options">
            <span className="visual-options-label">导出格式</span>
            <div className="format-switch" role="group" aria-label="导出格式">
              {(['image/png', 'image/jpeg', 'image/webp'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={format === value ? 'active' : ''}
                  onClick={() => { setFormat(value); setResult(null); }}
                >
                  {formatLabel(value)}
                </button>
              ))}
            </div>
          </div>
          {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
          <div className="action-row">
            <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!crop}>
              裁剪并下载
            </ToolProcessButton>
            <span className="action-note">拖动即可调整，无需输入数值。</span>
          </div>
          {result ? (
            <>
              <BeforeAfter before={file} after={result} beforeLabel="原图" afterLabel="裁剪结果" />
              <ResultCard file={result} title="裁剪完成" detail={`${crop?.width} × ${crop?.height} 像素`} />
            </>
          ) : null}
        </>
      )}
      {!file && error ? <p className="form-error" role="alert">{error}</p> : null}
    </ToolPageShell>
  );
}
