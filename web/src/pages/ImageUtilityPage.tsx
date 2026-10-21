import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useParams } from 'react-router-dom';
import { FileDrop } from '../components/FileDrop';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { BeforeAfter } from '../features/tools/image/BeforeAfter';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';
import { NotFoundPage } from './NotFoundPage';
import { IMAGE_TOOLS } from '../lib/tools';
import { IMAGE_ACCEPT, compressImage, convertImage, inspectImage, resizeImage,
  type ImageInfo, type OutputFormat } from '../features/tools/image/operations';
import {
  composeImages, transformImage,
  type ImageArrangement, type ImageTransform, type ImageTransformOptions,
} from '../features/tools/image/operations-extended';

const DEFAULTS: ImageTransformOptions = {
  format: 'image/png', quality: 90, angle: 90, direction: 'horizontal',
  brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0,
  blurRadius: 0, text: 'PaperLab', textSize: 32, opacity: 30,
  color: '#111111', background: '#ffffff', position: 'bottom-right',
  border: 24, cornerRadius: 30, tolerance: 28, mosaicSize: 16,
  region: { x: .2, y: .2, width: .5, height: .5 },
};

const FORMATS: Array<{ mime: OutputFormat; name: string }> = [
  { mime: 'image/png', name: 'PNG' },
  { mime: 'image/jpeg', name: 'JPEG' },
  { mime: 'image/webp', name: 'WebP' },
];

type RegionMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function ValueSlider({ label, value, min, max, step = 1, onChange, suffix = '' }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (value: number) => void; suffix?: string;
}) {
  return (
    <label className="field">
      <span>{label}: {value}{suffix}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(event) => onChange(Number(event.target.value))} aria-label={label} />
    </label>
  );
}

export function ImageUtilityPage() {
  const { utility } = useParams();
  const tool = IMAGE_TOOLS.find((item) => item.path === `/image/${utility}`);
  const key = tool?.key.replace('image.', '') ?? '';
  const [files, setFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<ImageInfo | null>(null);
  const [options, setOptions] = useState<ImageTransformOptions>(DEFAULTS);
  const [arrangement, setArrangement] = useState<ImageArrangement>('grid-2');
  const [gap, setGap] = useState(12);
  const [batchMode, setBatchMode] = useState<'convert' | 'compress' | 'resize'>('convert');
  const [batchPercent, setBatchPercent] = useState(50);
  const [results, setResults] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [regionDragging, setRegionDragging] = useState(false);
  const previewRef = useRef<HTMLImageElement>(null);
  const regionDragRef = useRef<{
    mode: RegionMode;
    startX: number;
    startY: number;
    startRegion: ImageTransformOptions['region'];
    displayWidth: number;
    displayHeight: number;
  } | null>(null);
  const isMultiple = key === 'collage' || key === 'batch';
  const file = files[0] ?? null;
  const url = useObjectUrl(file);

  useEffect(() => {
    setFiles([]);
    setResults([]);
    setInfo(null);
    setError('');
    setOptions({ ...DEFAULTS, blurRadius: utility === 'blur' ? 8 : 0 });
  }, [utility]);

  useEffect(() => {
    if (!file) { setInfo(null); return; }
    let cancelled = false;
    inspectImage(file).then((data) => { if (!cancelled) setInfo(data); })
      .catch((reason: unknown) => {
        if (!cancelled) { setInfo(null); setError(reason instanceof Error ? reason.message : '图片读取失败'); }
      });
    return () => { cancelled = true; };
  }, [file]);

  function update<K extends keyof ImageTransformOptions>(field: K, value: ImageTransformOptions[K]) {
    setOptions((current) => ({ ...current, [field]: value }));
    setResults([]);
  }

  function beginRegionDrag(mode: RegionMode, event: ReactPointerEvent<HTMLElement>) {
    const image = previewRef.current;
    if (!image) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = image.getBoundingClientRect();
    regionDragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRegion: { ...options.region },
      displayWidth: rect.width,
      displayHeight: rect.height,
    };
    setRegionDragging(true);
  }

  useEffect(() => {
    if (!regionDragging) return;
    function onMove(event: PointerEvent) {
      const drag = regionDragRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.startX) / Math.max(1, drag.displayWidth);
      const dy = (event.clientY - drag.startY) / Math.max(1, drag.displayHeight);
      const start = drag.startRegion;
      const min = 0.03;
      let { x, y, width, height } = start;

      if (drag.mode === 'move') {
        x = clamp01(start.x + dx);
        y = clamp01(start.y + dy);
        x = Math.min(x, 1 - width);
        y = Math.min(y, 1 - height);
      } else {
        if (drag.mode.includes('w')) {
          const right = start.x + start.width;
          x = Math.min(Math.max(start.x + dx, 0), right - min);
          width = right - x;
        }
        if (drag.mode.includes('e')) {
          width = Math.min(Math.max(start.width + dx, min), 1 - start.x);
        }
        if (drag.mode.includes('n')) {
          const bottom = start.y + start.height;
          y = Math.min(Math.max(start.y + dy, 0), bottom - min);
          height = bottom - y;
        }
        if (drag.mode.includes('s')) {
          height = Math.min(Math.max(start.height + dy, min), 1 - start.y);
        }
      }

      setOptions((current) => ({ ...current, region: { x, y, width, height } }));
      setResults([]);
    }
    function onUp() {
      regionDragRef.current = null;
      setRegionDragging(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [regionDragging]);

  async function process() {
    if (files.length === 0) return;
    setResults([]);
    setError('');
    setProcessing(true);
    try {
      if (isMultiple) {
        if (key === 'collage') {
          setResults([await composeImages(files, arrangement, gap, options.background)]);
        } else {
          if (files.length > 20) throw new Error('批量处理每次最多 20 张图片');
          const outputs: File[] = [];
          for (const input of files) {
            if (batchMode === 'convert') {
              outputs.push(await convertImage(input, {
                format: options.format, quality: options.quality, background: options.background,
              }));
            } else if (batchMode === 'compress') {
              outputs.push(await compressImage(input, {
                quality: options.quality, maxSizeMB: .8, maxDimension: 2400,
              }));
            } else {
              outputs.push(await resizeImage(input, {
                mode: 'percent', width: 0, height: 0, percent: batchPercent,
                keepAspect: true, format: options.format, quality: options.quality,
              }));
            }
          }
          setResults(outputs);
        }
      } else {
        const kind = key as ImageTransform;
        setResults([await transformImage(files[0], kind, options)]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '处理失败');
    } finally {
      setProcessing(false);
    }
  }

  if (!tool) return <NotFoundPage />;

  const isSelectedRegion = ['pixelate', 'blur', 'mask'].includes(key);
  const isOutputTransparent = key === 'background' || key === 'round';
  const hasVisualChange = !['strip', 'collage', 'batch'].includes(key);
  const hasSourcePreview = hasVisualChange;
  const qualityUseful = options.format !== 'image/png';

  return (
    <ToolPageShell tool={tool}>
      <FileDrop accept={IMAGE_ACCEPT} multiple={isMultiple} files={files}
        onChange={(next) => { setFiles(next); setResults([]); setError(''); }}
        title={isMultiple ? '选择多张图片' : '选择一张图片'}
        testId={`image-${utility}-drop`} />

      {url && hasSourcePreview ? (
        <div className="image-utility-preview">
          <div className="image-utility-preview-inner">
            <img ref={previewRef} src={url} alt="原始图片预览" style={{
              filter: key === 'adjust'
                ? `brightness(${options.brightness}%) contrast(${options.contrast}%) saturate(${options.saturation}%) grayscale(${options.grayscale}%) sepia(${options.sepia}%) blur(${options.blurRadius}px)`
                : undefined,
              transform: key === 'rotate' ? `rotate(${options.angle}deg)` :
                key === 'flip' ? `scale${options.direction === 'horizontal' ? 'X' : 'Y'}(-1)` : undefined,
              borderRadius: key === 'round'
                ? `${Math.min(50, (options.cornerRadius / Math.max(1, Math.min(info?.width || 1, info?.height || 1))) * 100)}%`
                : undefined,
              boxShadow: key === 'frame' ? `0 0 0 ${options.border}px ${options.color}` : undefined,
            }} />
            {key === 'watermark' ? (
              <span
                className={`image-utility-watermark ${options.position}`}
                style={{
                  color: options.color,
                  opacity: options.opacity / 100,
                  fontSize: `${Math.max(10, Math.min(56, options.textSize * 0.5))}px`,
                }}
              >
                {options.text || ' '}
              </span>
            ) : null}
            {isSelectedRegion ? (
              <div
                className={`image-utility-region ${regionDragging ? 'is-dragging' : ''}`}
                style={{
                  left: `${options.region.x * 100}%`,
                  top: `${options.region.y * 100}%`,
                  width: `${options.region.width * 100}%`,
                  height: `${options.region.height * 100}%`,
                  background: key === 'mask' ? `${options.color}b3` : key === 'blur' ? 'transparent' : undefined,
                  backdropFilter: key === 'blur' ? `blur(${options.blurRadius}px)` : undefined,
                }}
                aria-label="将要处理的区域"
                onPointerDown={(event) => beginRegionDrag('move', event)}
                data-testid="utility-region"
                role="presentation"
              >
                {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                  <button
                    key={corner}
                    type="button"
                    className={`region-handle region-handle-${corner}`}
                    aria-label={`拖动${corner}区域控制点`}
                    data-testid={`utility-region-handle-${corner}`}
                    onPointerDown={(event) => beginRegionDrag(corner, event)}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <p className="muted">
            {info ? `${info.width} × ${info.height} · ${files.length} 张文件` : '读取中…'}
          </p>
        </div>
      ) : null}

      {isSelectedRegion ? (
        <p className="visual-hint">拖动框内移动区域，拖动四角调整范围。</p>
      ) : null}

      <div className="field-grid">
        {key === 'rotate' ? (
          <label className="field">
            <span>旋转角度</span>
            <select value={options.angle}
              onChange={(event) => update('angle', Number(event.target.value) as 90 | 180 | 270)}>
              <option value={90}>顺时针 90°</option>
              <option value={180}>180°</option>
              <option value={270}>顺时针 270°</option>
            </select>
          </label>
        ) : null}

        {key === 'flip' ? (
          <label className="field">
            <span>翻转方向</span>
            <select value={options.direction}
              onChange={(event) => update('direction', event.target.value as 'horizontal' | 'vertical')}>
              <option value="horizontal">水平镜像</option>
              <option value="vertical">垂直镜像</option>
            </select>
          </label>
        ) : null}

        {key === 'adjust' ? (
          <>
            <ValueSlider label="亮度" value={options.brightness} min={0} max={200} suffix="%"
              onChange={(n) => update('brightness', n)} />
            <ValueSlider label="对比度" value={options.contrast} min={0} max={200} suffix="%"
              onChange={(n) => update('contrast', n)} />
            <ValueSlider label="饱和度" value={options.saturation} min={0} max={200} suffix="%"
              onChange={(n) => update('saturation', n)} />
            <ValueSlider label="黑白" value={options.grayscale} min={0} max={100} suffix="%"
              onChange={(n) => update('grayscale', n)} />
            <ValueSlider label="复古褐色" value={options.sepia} min={0} max={100} suffix="%"
              onChange={(n) => update('sepia', n)} />
            <ValueSlider label="柔化" value={options.blurRadius} min={0} max={20} suffix="px"
              onChange={(n) => update('blurRadius', n)} />
          </>
        ) : null}

        {key === 'watermark' ? (
          <>
            <label className="field">
              <span>水印内容</span>
              <input value={options.text} maxLength={100} data-testid="image-watermark-text"
                onChange={(event) => update('text', event.target.value)} />
            </label>
            <ValueSlider label="文字大小" min={8} max={160} value={options.textSize} suffix="px"
              onChange={(n) => update('textSize', n)} />
            <ValueSlider label="水印透明度" min={5} max={100} value={options.opacity} suffix="%"
              onChange={(n) => update('opacity', n)} />
            <label className="field">
              <span>位置</span>
              <select value={options.position} onChange={(event) =>
                update('position', event.target.value as ImageTransformOptions['position'])}>
                <option value="bottom-right">右下角</option>
                <option value="top-left">左上角</option>
                <option value="center">居中</option>
              </select>
            </label>
          </>
        ) : null}

        {key === 'frame' ? (
          <ValueSlider label="边框宽度" min={0} max={200} value={options.border} suffix="px"
            onChange={(n) => update('border', n)} />
        ) : null}

        {key === 'round' ? (
          <ValueSlider label="圆角半径" min={0} max={Math.floor(Math.min(info?.width || 200, info?.height || 200) / 2)}
            value={Math.min(options.cornerRadius, Math.floor(Math.min(info?.width || 200, info?.height || 200) / 2))}
            suffix="px" onChange={(n) => update('cornerRadius', n)} />
        ) : null}

        {key === 'pixelate' ? (
          <ValueSlider label="马赛克像素块" value={options.mosaicSize} min={2} max={80} suffix="px"
            onChange={(n) => update('mosaicSize', n)} />
        ) : null}
        {key === 'blur' ? (
          <ValueSlider label="区域模糊半径" value={options.blurRadius} min={1} max={50} suffix="px"
            onChange={(n) => update('blurRadius', n)} />
        ) : null}

        {key === 'background' ? (
          <ValueSlider label="背景颜色容差" min={0} max={200} value={options.tolerance}
            onChange={(n) => update('tolerance', n)} />
        ) : null}

        {key === 'collage' ? (
          <>
            <label className="field">
              <span>布局方式</span>
              <select value={arrangement}
                onChange={(event) => { setArrangement(event.target.value as ImageArrangement); setResults([]); }}>
                <option value="horizontal">水平拼接</option>
                <option value="vertical">垂直拼接</option>
                <option value="grid-2">两列拼图</option>
                <option value="grid-3">三列拼图</option>
              </select>
            </label>
            <ValueSlider label="图片间距" min={0} max={100} value={gap} suffix="px"
              onChange={(n) => { setGap(n); setResults([]); }} />
          </>
        ) : null}

        {key === 'batch' ? (
          <>
            <label className="field">
              <span>批量操作</span>
              <select value={batchMode}
                onChange={(event) => { setBatchMode(event.target.value as typeof batchMode); setResults([]); }}>
                <option value="convert">格式转换</option>
                <option value="compress">压缩图片</option>
                <option value="resize">按百分比缩放</option>
              </select>
            </label>
            {batchMode === 'resize' ? (
              <ValueSlider label="输出比例" min={10} max={150} value={batchPercent} suffix="%"
                onChange={(n) => { setBatchPercent(n); setResults([]); }} />
            ) : null}
          </>
        ) : null}

        {['frame', 'mask', 'watermark'].includes(key) ? (
          <label className="field">
            <span>{key === 'frame' ? '边框颜色' : key === 'mask' ? '遮挡颜色' : '文字颜色'}</span>
            <input type="color" value={options.color} onChange={(event) => update('color', event.target.value)} />
          </label>
        ) : null}

        {['background', 'replace-background', 'collage', 'batch'].includes(key) ? (
          <label className="field">
            <span>{key === 'background' ? '要抠除的背景色' : '背景填充颜色'}</span>
            <input type="color" value={options.background}
              onChange={(event) => update('background', event.target.value)} />
          </label>
        ) : null}

        {!isOutputTransparent && key !== 'collage' && key !== 'mask' && key !== 'batch' ? (
          <label className="field">
            <span>导出格式</span>
            <select value={options.format}
              onChange={(event) => update('format', event.target.value as OutputFormat)}>
              {FORMATS.map((item) => <option key={item.mime} value={item.mime}>{item.name}</option>)}
            </select>
          </label>
        ) : null}

        {key === 'batch' && batchMode !== 'compress' ? (
          <label className="field">
            <span>批量导出格式</span>
            <select value={options.format}
              onChange={(event) => update('format', event.target.value as OutputFormat)}>
              {FORMATS.map((item) => <option key={item.mime} value={item.mime}>{item.name}</option>)}
            </select>
          </label>
        ) : null}

        {key !== 'collage' && key !== 'mask' && key !== 'background' && key !== 'round' && qualityUseful ? (
          <label className="field">
            <span>有损格式品质: {options.quality}%</span>
            <input type="range" min={30} max={100} value={options.quality}
              onChange={(event) => update('quality', Number(event.target.value))} aria-label="有损格式品质" />
          </label>
        ) : null}
      </div>

      {key === 'background' ? (
        <p className="pdf-warning" role="note">只清除颜色接近所选背景色的像素，适合纯色背景，不是 AI 智能抠图；输出透明 PNG。</p>
      ) : null}
      {key === 'replace-background' ? (
        <p className="pdf-warning" role="note">只替换原图中已有的透明区域，不会自动识别人像或主体。</p>
      ) : null}
      {key === 'pixelate' || key === 'blur' ? (
        <p className="pdf-warning" role="note">模糊或马赛克属于外观处理，不适合保密信息脱敏；要覆盖区域请使用实心遮挡。</p>
      ) : null}
      {key === 'strip' ? (
        <p className="pdf-warning" role="note">重新编码图片可删除常见 EXIF 元数据，但不能保证清除所有嵌入式来源标记。</p>
      ) : null}
      {key === 'batch' ? (
        <p className="muted">每次最多处理 20 张图片。所有结果分别提供下载，不向云端上传原图。</p>
      ) : null}
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}

      <div className="action-row">
        <ToolProcessButton processing={processing} disabled={files.length === 0 || !info}
          onClick={() => void process()}>{tool.title}</ToolProcessButton>
      </div>

      {hasVisualChange && results.length === 1 && file ? (
        <BeforeAfter before={file} after={results[0]} beforeLabel="原图" afterLabel="处理后" />
      ) : null}
      {key === 'strip' && results[0] ? (
        <p className="muted" role="note">画面未改变；输出文件已重新编码，常见 EXIF 信息已移除。</p>
      ) : null}
      {results.map((result, index) =>
        <ResultCard key={`${result.name}-${index}`} file={result}
          title={results.length > 1 ? `结果 ${index + 1}` : '处理完成'}
          showPreview={key !== 'strip'} />)}
    </ToolPageShell>
  );
}
