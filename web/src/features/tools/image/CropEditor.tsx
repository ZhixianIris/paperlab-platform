import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageInfo } from './operations';
import { useObjectUrl } from './useObjectUrl';

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

interface DragState {
  mode: DragMode;
  startX: number;
  startY: number;
  startRect: CropRect;
  displayWidth: number;
  displayHeight: number;
}

const MIN_SIZE = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function CropEditor({
  file,
  info,
  value,
  onChange,
  onReset,
}: {
  file: File;
  info: ImageInfo;
  value: CropRect;
  onChange: (next: CropRect) => void;
  onReset: () => void;
}) {
  const url = useObjectUrl(file);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const onChangeRef = useRef(onChange);
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  onChangeRef.current = onChange;

  const measure = useCallback(() => {
    const image = imgRef.current;
    if (!image) return;
    setDisplay({ width: image.clientWidth, height: image.clientHeight });
  }, []);

  useEffect(() => {
    const image = imgRef.current;
    if (!image) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(image);
    return () => observer.disconnect();
  }, [measure, url]);

  useEffect(() => {
    if (!dragging) return;
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = ((event.clientX - drag.startX) / Math.max(1, drag.displayWidth)) * info.width;
      const dy = ((event.clientY - drag.startY) / Math.max(1, drag.displayHeight)) * info.height;
      const start = drag.startRect;
      let x = start.x;
      let y = start.y;
      let width = start.width;
      let height = start.height;

      if (drag.mode === 'move') {
        x = clamp(start.x + dx, 0, info.width - start.width);
        y = clamp(start.y + dy, 0, info.height - start.height);
      } else {
        if (drag.mode.includes('w')) {
          const right = start.x + start.width;
          x = clamp(start.x + dx, 0, right - MIN_SIZE);
          width = right - x;
        }
        if (drag.mode.includes('e')) {
          width = clamp(start.width + dx, MIN_SIZE, info.width - start.x);
        }
        if (drag.mode.includes('n')) {
          const bottom = start.y + start.height;
          y = clamp(start.y + dy, 0, bottom - MIN_SIZE);
          height = bottom - y;
        }
        if (drag.mode.includes('s')) {
          height = clamp(start.height + dy, MIN_SIZE, info.height - start.y);
        }
      }

      onChangeRef.current({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
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

  function beginDrag(mode: DragMode, event: ReactPointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: value,
      displayWidth: display.width,
      displayHeight: display.height,
    };
    setDragging(true);
  }

  const style = {
    left: `${(value.x / info.width) * 100}%`,
    top: `${(value.y / info.height) * 100}%`,
    width: `${(value.width / info.width) * 100}%`,
    height: `${(value.height / info.height) * 100}%`,
  };

  return (
    <div className={`visual-editor ${dragging ? 'is-dragging' : ''}`}>
      <div className="visual-toolbar">
        <div>
          <span className="visual-label">裁剪区域</span>
          <strong>{value.width} × {value.height}</strong>
        </div>
        <div className="visual-toolbar-actions">
          <span className="visual-dim">原图 {info.width} × {info.height}</span>
          <button type="button" className="button button-small button-ghost" onClick={onReset}>
            重置
          </button>
        </div>
      </div>
      <div className="crop-stage">
        <div className="crop-image-wrap">
          <img ref={imgRef} src={url ?? ''} alt="待裁剪图片" onLoad={measure} draggable={false} />
          <div
            className="crop-selection"
            style={style}
            onPointerDown={(event) => beginDrag('move', event)}
            data-testid="crop-selection"
            role="presentation"
          >
            <span className="crop-grid crop-grid-v1" />
            <span className="crop-grid crop-grid-v2" />
            <span className="crop-grid crop-grid-h1" />
            <span className="crop-grid crop-grid-h2" />
            {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <button
                key={corner}
                type="button"
                className={`crop-handle crop-handle-${corner}`}
                aria-label={`拖动${corner}裁剪控制点`}
                data-testid={`crop-handle-${corner}`}
                onPointerDown={(event) => beginDrag(corner, event)}
              />
            ))}
            <span className="crop-badge">{value.width} × {value.height}</span>
          </div>
        </div>
      </div>
      <p className="visual-hint">拖动框内移动区域，拖动四角改变大小。</p>
    </div>
  );
}
