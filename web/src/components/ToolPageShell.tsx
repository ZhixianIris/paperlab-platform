import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowIcon, LockIcon } from './Icons';
import type { ToolMeta } from '../lib/tools';

interface ToolPageShellProps {
  tool: ToolMeta;
  children: ReactNode;
  aside?: ReactNode;
  related?: ToolMeta[];
}

export function ToolPageShell({ tool, children, aside, related = [] }: ToolPageShellProps) {
  return (
    <div className="tool-page">
      <div className="breadcrumbs">
        <Link to="/">工具台</Link>
        <span>/</span>
        <span>{tool.group === 'pdf' ? 'PDF' : '图片'}</span>
      </div>
      <header className="tool-hero">
        <div>
          <span className="eyebrow">{tool.group === 'pdf' ? 'LOCAL PDF ENGINE' : 'LOCAL IMAGE ENGINE'}</span>
          <h1>{tool.title}</h1>
          <p>{tool.description}</p>
        </div>
        <div className="local-stamp">
          <LockIcon size={18} />
          <span>100% 浏览器内处理</span>
        </div>
      </header>
      <div className="tool-layout">
        <div className="tool-workbench">{children}</div>
        <aside className="tool-aside">
          {aside ?? (
            <div className="aside-card">
              <h3>本地优先</h3>
              <p>文件不经过网络。页面加载完成后，即使断网也能完成处理与下载。</p>
              <ul>
                <li>不生成文件指纹</li>
                <li>不调用第三方埋点</li>
                <li>不保留任何副本</li>
              </ul>
            </div>
          )}
          {related.length ? (
            <div className="aside-card aside-related">
              <h3>相关工具</h3>
              {related.map((item) => (
                <Link key={item.key} to={item.path}>
                  {item.title} <ArrowIcon size={14} />
                </Link>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
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
