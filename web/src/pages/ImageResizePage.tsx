import { useEffect, useState } from 'react';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { IMAGE_TOOLS } from '../lib/tools';
import {
  formatLabel,
  inspectImage,
  resizeImage,
  type ImageInfo,
  type OutputFormat,
  IMAGE_ACCEPT,
} from '../features/tools/image/operations';
import { ResizeEditor, type ResizeSize } from '../features/tools/image/ResizeEditor';

const tool = IMAGE_TOOLS[1];

export function ImageResizePage() {
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [size, setSize] = useState<ResizeSize | null>(null);
  const [format, setFormat] = useState<OutputFormat>('image/png');
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<File | null>(null);
  const [error, setError] = useState('');
  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setInfo(null);
      setSize(null);
      return;
    }
    let cancelled = false;
    inspectImage(file)
      .then((next) => {
        if (cancelled) return;
        setInfo(next);
        setSize({ width: next.width, height: next.height });
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
    if (!file || !size) return;
    setError('');
    setResult(null);
    setProcessing(true);
    try {
      setResult(
        await resizeImage(file, {
          mode: 'pixels',
          width: size.width,
          height: size.height,
          percent: 100,
          keepAspect: true,
          format,
          quality: 92,
        }),
      );
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : '缩放失败');
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
          hint="拖入或点击选择"
          testId="image-resize-drop"
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
          {info ? (
            <ResizeEditor
              file={file}
              info={info}
              onChange={(next) => {
                setSize(next);
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
            <ToolProcessButton processing={processing} onClick={() => void process()} disabled={!size}>
              导出图片
            </ToolProcessButton>
            <span className="action-note">{size ? `${size.width} × ${size.height}` : ''}</span>
          </div>
          {result ? <ResultCard file={result} title="尺寸已调整" detail={`${size?.width} × ${size?.height} 像素`} /> : null}
        </>
      )}
    </ToolPageShell>
  );
}
