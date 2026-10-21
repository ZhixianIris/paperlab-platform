import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth';
import { callPlatformApi } from './api';
import type { TenantDashboard } from './types';

type TenantScope =
  | { status: 'public'; query: ''; keys: null; slug: '' }
  | { status: 'loading' | 'login-required' | 'forbidden' | 'error'; query: string; keys: null; slug: string }
  | { status: 'ready'; query: string; keys: Set<string>; slug: string };

/**
 * UI-level tenant tool selection, not an authorization mechanism.
 * Public/free local tools remain available without a tenant query.
 * Server-side AI/payment permission is always enforced by platform-api.
 */
export function useTenantToolScope(): TenantScope {
  const [params] = useSearchParams();
  const slug = (params.get('tenant') || '').trim().toLowerCase();
  const query = slug ? `?tenant=${encodeURIComponent(slug)}` : '';
  const { session, status } = useAuth();
  const member = session?.memberships.find((m) => m.slug === slug && m.tenantStatus === 'active');
  const tenantId = member?.tenantId || '';
  const [loaded, setLoaded] = useState<{ tenantId: string; keys: Set<string> } | null>(null);
  const [failure, setFailure] = useState(false);

  useEffect(() => {
    if (!slug || !tenantId || status !== 'authenticated') {
      setLoaded(null);
      setFailure(false);
      return;
    }
    let cancelled = false;
    setLoaded(null);
    setFailure(false);
    void callPlatformApi<TenantDashboard>('tenant.dashboard', { tenantId })
      .then((data) => {
        if (!cancelled) setLoaded({
          tenantId,
          keys: new Set(data.tools.filter((tool) => tool.enabled).map((tool) => tool.key)),
        });
      })
      .catch(() => {
        if (!cancelled) setFailure(true);
      });
    return () => { cancelled = true; };
  }, [slug, status, tenantId]);

  if (!slug) return { status: 'public', keys: null, slug: '', query: '' };
  if (status === 'loading') return { status: 'loading', keys: null, slug, query };
  if (status !== 'authenticated' || !session) {
    return { status: 'login-required', keys: null, slug, query };
  }
  if (!member) return { status: 'forbidden', keys: null, slug, query };
  if (failure) return { status: 'error', keys: null, slug, query };
  if (!loaded || loaded.tenantId !== tenantId) return { status: 'loading', keys: null, slug, query };
  return { status: 'ready', keys: loaded.keys, slug, query };
}

export function tenantScopeMessage(scope: TenantScope): string {
  switch (scope.status) {
    case 'loading': return '正在加载团队空间的工具权限…';
    case 'login-required': return '需要登录才能使用此团队空间。';
    case 'forbidden': return '你没有此团队空间的访问权限，或空间已停用。';
    case 'error': return '无法读取团队空间工具配置，请稍后重试。';
    default: return '';
  }
}
