import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { FileIcon } from './Icons';

export function PdfPreview({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    setState('idle');
    setPages(0);
    setError('');
    return () => {
      void documentRef.current?.destroy();
      documentRef.current = null;
    };
  }, [file]);

  async function renderPreview() {
    setState('loading');
    setError('');
    try {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const document = await pdfjs.getDocument({ data: bytes }).promise;
      documentRef.current = document;
      setPages(document.numPages);
      const page = await document.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 780 / viewport.width);
      const scaled = page.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) throw new Error('预览画布不可用');
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器不支持 Canvas');
      canvas.width = Math.ceil(scaled.width);
      canvas.height = Math.ceil(scaled.height);
      await page.render({ canvas, canvasContext: context, viewport: scaled }).promise;
      setState('ready');
    } catch {
      setError('预览未能加载，但本地处理功能不受影响。');
      setState('error');
    }
  }

  return (
    <div className="pdf-preview">
      <div className="pdf-preview-head">
        <span><FileIcon size={16} /> 本地预览</span>
        <button type="button" className="text-button" onClick={() => void renderPreview()} data-testid="pdf-preview">
          {state === 'ready' ? '重新预览第一页' : '预览第一页'}
        </button>
      </div>
      {state === 'loading' ? <p className="muted">正在本地解析 PDF…</p> : null}
      {state === 'error' ? <p className="form-error">{error}</p> : null}
      {state === 'ready' ? <p className="muted">共 {pages} 页 · 仅渲染第一页</p> : null}
      <canvas ref={canvasRef} className={state === 'ready' ? 'pdf-canvas visible' : 'pdf-canvas'} />
    </div>
  );
}
