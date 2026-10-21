import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useObjectUrl } from './useObjectUrl';

export function BeforeAfter({
  before,
  after,
  beforeLabel = '原图',
  afterLabel = '处理结果',
}: {
  before: File;
  after: File;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const beforeUrl = useObjectUrl(before);
  const afterUrl = useObjectUrl(after);
  const stageRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(52);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    function move(event: PointerEvent) {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      setPosition((x / Math.max(1, rect.width)) * 100);
    }
    function up() {
      setDragging(false);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('pointercancel', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging]);

  function start(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(true);
  }

  return (
    <div className="compare-wrap">
      <div
        className={`compare-stage ${dragging ? 'is-dragging' : ''}`}
        ref={stageRef}
        onPointerDown={start}
        data-testid="compare-stage"
      >
        <img src={beforeUrl ?? ''} alt={beforeLabel} draggable={false} className="compare-img" />
        <div className="compare-after" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
          <img src={afterUrl ?? ''} alt={afterLabel} draggable={false} className="compare-img" />
        </div>
        <div className="compare-divider" style={{ left: `${position}%` }}>
          <span className="compare-handle" aria-hidden="true">↔</span>
        </div>
        <span className="compare-label left">{beforeLabel}</span>
        <span className="compare-label right">{afterLabel}</span>
      </div>
      <p className="visual-hint">拖动中线对比处理前后效果。</p>
    </div>
  );
}
