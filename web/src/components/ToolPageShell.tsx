import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowIcon } from './Icons';
import type { ToolMeta } from '../lib/tools';
import { tenantScopeMessage, useTenantToolScope } from '../lib/tenantTools';

interface ToolPageShellProps {
  tool: ToolMeta;
  children: ReactNode;
}

export function ToolPageShell({ tool, children }: ToolPageShellProps) {
  const scope = useTenantToolScope();
  const groupPath = (tool.group === 'pdf' ? '/pdf' : '/image') + scope.query;
  const allowed = scope.status === 'public' || (scope.status === 'ready' && scope.keys.has(tool.key));
  return (
    <div className="tool-page">
      <header className="tool-head">
        <Link to={groupPath} className="back-link">
          <ArrowIcon size={18} className="back-arrow" /> {tool.group === 'pdf' ? 'PDF 工作台' : '图片工作台'}
        </Link>
        <div className="tool-hero">
          <h1>{tool.title}</h1>
          <p>{tool.short}</p>
        </div>
      </header>
      <div className="tool-workbench tool-workbench-single">
        {allowed ? children : (
          <div className="notice notice-warn" role={scope.status === 'loading' ? 'status' : 'alert'}>
            {scope.status === 'ready'
              ? '此团队空间未启用该工具。你可以联系管理员调整工具开关。'
              : tenantScopeMessage(scope)}
          </div>
        )}
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
