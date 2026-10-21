import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageInfo } from './operations';
import { useObjectUrl } from './useObjectUrl';

export interface ResizeSize {
  width: number;
  height: number;
}

interface DragState {
  startX: number;
  startY: number;
  startScale: number;
  startWidth: number;
  startHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function ResizeEditor({
  file,
  info,
  onChange,
}: {
  file: File;
  info: ImageInfo;
  onChange: (next: ResizeSize) => void;
}) {
  const url = useObjectUrl(file);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const onChangeRef = useRef(onChange);
  const [scale, setScale] = useState(1);
  const [base, setBase] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  onChangeRef.current = onChange;

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const maxWidth = Math.max(240, stage.clientWidth - 56);
    const maxHeight = 430;
    const fit = Math.min(maxWidth / info.width, maxHeight / info.height, 1.25);
    setBase({ width: Math.max(120, info.width * fit), height: Math.max(90, info.height * fit) });
  }, [info.height, info.width]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    setScale(1);
    onChangeRef.current({ width: info.width, height: info.height });
  }, [info.height, info.width]);

  useEffect(() => {
    if (!dragging) return;
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const widthRatio = (drag.startWidth + (event.clientX - drag.startX)) / Math.max(1, drag.startWidth);
      const heightRatio = (drag.startHeight + (event.clientY - drag.startY)) / Math.max(1, drag.startHeight);
      const nextScale = clamp(drag.startScale * ((widthRatio + heightRatio) / 2), 0.1, 1.75);
      setScale(nextScale);
      onChangeRef.current({
        width: Math.max(1, Math.round(info.width * nextScale)),
        height: Math.max(1, Math.round(info.height * nextScale)),
      });
    }
    function onUp() {
      dragRef.current = null;
      setDragging(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, info.height, info.width]);

  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startScale: scale,
      startWidth: base.width * scale,
      startHeight: base.height * scale,
    };
    setDragging(true);
  }

  function applyScale(next: number) {
    const bounded = clamp(next, 0.1, 1.75);
    setScale(bounded);
    onChangeRef.current({
      width: Math.max(1, Math.round(info.width * bounded)),
      height: Math.max(1, Math.round(info.height * bounded)),
    });
  }

  return (
    <div className={`visual-editor ${dragging ? 'is-dragging' : ''}`}>
      <div className="visual-toolbar">
        <div>
          <span className="visual-label">输出尺寸</span>
          <strong>{Math.round(info.width * scale)} × {Math.round(info.height * scale)}</strong>
        </div>
        <div className="visual-toolbar-actions">
          <span className="visual-dim">原图 {info.width} × {info.height}</span>
          <button type="button" className="button button-small button-ghost" onClick={() => applyScale(1)}>
            原尺寸
          </button>
        </div>
      </div>
      <div className="resize-presets" aria-label="快捷尺寸">
        {[
          { label: '25%', value: 0.25 },
          { label: '50%', value: 0.5 },
          { label: '75%', value: 0.75 },
          { label: '100%', value: 1 },
          { label: '150%', value: 1.5 },
        ].map((preset) => (
          <button
            key={preset.value}
            type="button"
            className={`preset-pill ${Math.abs(scale - preset.value) < 0.01 ? 'active' : ''}`}
            onClick={() => applyScale(preset.value)}
            data-testid={`resize-preset-${preset.label.replace('%', '')}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="resize-stage" ref={stageRef}>
        {base.width > 0 ? (
          <div
            className="resize-frame"
            style={{ width: base.width * scale, height: base.height * scale }}
            data-testid="resize-frame"
          >
            <img src={url ?? ''} alt="待缩放图片" draggable={false} />
            <span className="resize-readout">{Math.round(info.width * scale)} × {Math.round(info.height * scale)}</span>
            <button
              type="button"
              className="resize-handle"
              aria-label="拖动调整尺寸"
              data-testid="resize-handle-se"
              onPointerDown={beginDrag}
            />
          </div>
        ) : null}
      </div>
      <p className="visual-hint">拖动右下角改变图片大小，宽高比例保持不变。</p>
    </div>
  );
}
