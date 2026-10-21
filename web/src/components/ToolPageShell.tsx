import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowIcon, LockIcon } from './Icons';
import type { ToolMeta } from '../lib/tools';

interface ToolPageShellProps {
  tool: ToolMeta;
  children: ReactNode;
}

export function ToolPageShell({ tool, children }: ToolPageShellProps) {
  const groupPath = tool.group === 'pdf' ? '/pdf' : '/image';
  return (
    <div className="tool-page">
      <div className="tool-topline">
        <Link to={groupPath} className="back-link">
          <ArrowIcon size={15} className="back-arrow" /> {tool.group === 'pdf' ? 'PDF 工作台' : '图片工作台'}
        </Link>
        <span className="local-pill">
          <LockIcon size={14} /> 本机处理
        </span>
      </div>
      <header className="tool-hero">
        <div>
          <span className="eyebrow">{tool.group === 'pdf' ? 'PDF TOOL' : 'IMAGE TOOL'}</span>
          <h1>{tool.title}</h1>
          <p>{tool.short}</p>
        </div>
      </header>
      <div className="tool-workbench tool-workbench-single">{children}</div>
    </div>
  );
}

export function ToolProcessButton({
  processing,
  onClick,
  children = '开始处理',
  disabled = false,
}: {
  processing: boolean;
  onClick: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="button button-accent button-large"
      onClick={onClick}
      disabled={processing || disabled}
      data-testid="process-button"
    >
      {processing ? (
        <>
          <span className="spinner" aria-hidden="true" /> 处理中…
        </>
      ) : (
        children
      )}
    </button>
  );
}
