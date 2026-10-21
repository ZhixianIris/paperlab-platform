import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type { TenantDashboard } from '../lib/types';
import { formatDate, formatMoney, jobStatusLabel, roleLabel, toolLabel } from '../lib/format';
import { useToast } from '../components/Toast';
import { ArrowIcon, LockIcon, SparklesIcon, UserIcon } from '../components/Icons';

interface PublicTenant {
  slug: string;
  name: string;
  status: 'active' | 'suspended';
}

export function TenantPage() {
  const { slug = '' } = useParams();
  const { session, status, configMissing } = useAuth();
  const { push } = useToast();
  const [publicTenant, setPublicTenant] = useState<PublicTenant | null>(null);
  const [dashboard, setDashboard] = useState<TenantDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noAccess, setNoAccess] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberBusy, setMemberBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState<string | null>(null);

  const membership = session?.memberships.find((item) => item.slug === slug) ?? null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setNoAccess(false);
    setDashboard(null);

    callPlatformApi<PublicTenant>('tenant.public', { slug })
      .then(async (tenant) => {
        if (cancelled) return;
        setPublicTenant(tenant);
        if (status !== 'authenticated' || !session) {
          setLoading(false);
          return;
        }
        if (!membership) {
          setNoAccess(true);
          setLoading(false);
          return;
        }
        try {
          const data = await callPlatformApi<TenantDashboard>('tenant.dashboard', {
            tenantId: membership.tenantId,
          });
          if (!cancelled) setDashboard(data);
        } catch (dashboardError) {
          if (!cancelled) {
            setError(dashboardError instanceof Error ? dashboardError.message : '无法加载租户');
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })
      .catch((publicError: unknown) => {
        if (!cancelled) {
          setError(publicError instanceof Error ? publicError.message : '租户不存在');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug, status, session, membership]);

  const refreshDashboard = useCallback(async () => {
    if (!membership) return;
    const data = await callPlatformApi<TenantDashboard>('tenant.dashboard', {
      tenantId: membership.tenantId,
    });
    setDashboard(data);
  }, [membership]);

  async function addMember() {
    if (!membership || !memberEmail.trim()) return;
    setMemberBusy(true);
    try {
      await callPlatformApi('tenant.members.add', {
        tenantId: membership.tenantId,
        email: memberEmail.trim(),
      });
      push('成员已加入租户', 'success');
      setMemberEmail('');
      await refreshDashboard();
    } catch (addError) {
      push(addError instanceof Error ? addError.message : '添加失败', 'error');
    } finally {
      setMemberBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (!membership) return;
    try {
      await callPlatformApi('tenant.members.remove', { tenantId: membership.tenantId, userId });
      push('成员已移除', 'success');
      await refreshDashboard();
    } catch (removeError) {
      push(removeError instanceof Error ? removeError.message : '移除失败', 'error');
    }
  }

  async function toggleTool(toolKey: string, enabled: boolean) {
    if (!membership) return;
    setToolBusy(toolKey);
    try {
      await callPlatformApi('tenant.tools.update', {
        tenantId: membership.tenantId,
        toolKey,
        enabled,
      });
      setDashboard((current) =>
        current
          ? {
              ...current,
              tools: current.tools.map((tool) =>
                tool.key === toolKey ? { ...tool, enabled } : tool,
              ),
            }
          : current,
      );
      push(`${toolLabel(toolKey)}已${enabled ? '启用' : '关闭'}`, 'success');
    } catch (toolError) {
      push(toolError instanceof Error ? toolError.message : '更新失败', 'error');
    } finally {
      setToolBusy(null);
    }
  }

  if (status === 'loading' || loading) {
    return <div className="page-loading">正在载入租户工作台…</div>;
  }

  if (!publicTenant) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <h1>租户不可用</h1>
        <p>{error || '找不到该租户，或者它已停用。'}</p>
        <Link to="/" className="button button-accent">回到首页</Link>
      </div>
    );
  }

  if (status !== 'authenticated' || !session) {
    return (
      <div className="tenant-gate">
        <div className="tenant-gate-card">
          <span className="eyebrow">TENANT / {publicTenant.slug.toUpperCase()}</span>
          <div className="tenant-gate-mark">{publicTenant.name.slice(0, 1)}</div>
          <h1>{publicTenant.name}</h1>
          <p>这是受保护的租户工作台。请使用被邀请的 CloudBase 账号登录后查看额度、工具与用量。</p>
          {configMissing ? (
            <p className="notice notice-warn">CloudBase 登录尚未配置；本地工具仍可直接使用。</p>
          ) : (
            <Link className="button button-accent button-large" to={`/login?next=/t/${publicTenant.slug}`}>
              登录进入 <ArrowIcon size={18} />
            </Link>
          )}
        </div>
        <Link to="/" className="text-link">返回工具台</Link>
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <span className="eyebrow">403</span>
        <h1>你不在这个租户里</h1>
        <p>{publicTenant.name} 没有你的成员记录。租户数据不会因为知道链接而开放。</p>
        <Link to="/account" className="button button-ghost">查看我的租户</Link>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <h1>无法进入工作台</h1>
        <p>{error || '租户返回了空数据。'}</p>
        <Link to="/account" className="button button-ghost">回到账户</Link>
      </div>
    );
  }

  const aiTool = dashboard.tools.find((tool) => tool.key === 'ai.image.generate');
  const isOwner = dashboard.role === 'tenant_owner';
  const aiEnabled = Boolean(aiTool?.enabled) && dashboard.tenant.status === 'active';

  return (
    <div className="tenant-page">
      <header className="tenant-head">
        <div className="tenant-head-main">
          <span className="tenant-monogram large">{dashboard.tenant.name.slice(0, 1)}</span>
          <div>
            <span className="eyebrow">TENANT WORKSPACE / {dashboard.tenant.slug}</span>
            <h1>{dashboard.tenant.name}</h1>
            <p>{roleLabel(dashboard.role)} · {dashboard.members.length} 位成员 · 状态 {dashboard.tenant.status === 'active' ? '正常' : '停用'}</p>
          </div>
        </div>
        <div className="tenant-head-actions">
          <Link to={`/ai?tenant=${dashboard.tenant.slug}`} className={`button ${aiEnabled ? 'button-accent' : 'button-disabled'}`} aria-disabled={!aiEnabled}>
            <SparklesIcon size={17} /> AI 创作
          </Link>
          <Link to="/account" className="button button-ghost">账户</Link>
        </div>
      </header>

      {dashboard.tenant.status !== 'active' ? (
        <div className="notice notice-warn">该租户已停用，AI 与写操作被禁止。请联系平台管理员。</div>
      ) : null}
      {!aiTool?.enabled ? (
        <div className="notice notice-warn">AI 出图工具已被租户所有者关闭。</div>
      ) : null}

      <section className="tenant-metrics">
        <article className="metric-card">
          <span>可用余额</span>
          <strong>{formatMoney(dashboard.wallet.availableCents)}</strong>
          <small>预占 {formatMoney(dashboard.wallet.reservedCents)}</small>
        </article>
        <article className="metric-card">
          <span>本月租户用量</span>
          <strong>{formatMoney(dashboard.usage.tenantMonthSpentCents)}</strong>
          <small>租户月度上限 {formatMoney(dashboard.tenant.monthlyAiBudgetCents)}</small>
        </article>
        <article className="metric-card">
          <span>我的本月用量</span>
          <strong>{formatMoney(dashboard.usage.userMonthSpentCents)}</strong>
          <small>成员上限 {formatMoney(dashboard.membership.userBudgetCents)}</small>
        </article>
        <article className="metric-card">
          <span>单次成本上限</span>
          <strong>{formatMoney(dashboard.tenant.maxJobCostCents)}</strong>
          <small>租户月度上限 {formatMoney(dashboard.tenant.monthlyAiBudgetCents)}</small>
        </article>
      </section>

      <section className="tenant-grid">
        <div className="panel tenant-tools">
          <div className="panel-head">
            <h2>工具开关</h2>
            <span className="muted">本地工具不消耗额度</span>
          </div>
          <div className="tool-toggle-grid">
            {dashboard.tools.map((tool) => (
              <div className="tool-toggle" key={tool.key}>
                <span>{toolLabel(tool.key)}</span>
                <label className="switch" aria-label={`${toolLabel(tool.key)} 开关`}>
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    disabled={!isOwner || toolBusy === tool.key || dashboard.tenant.status !== 'active'}
                    onChange={(event) => void toggleTool(tool.key, event.target.checked)}
                    data-testid={`tool-toggle-${tool.key}`}
                  />
                  <span className="switch-track" />
                </label>
                {toolBusy === tool.key ? <small>保存中…</small> : null}
              </div>
            ))}
          </div>
          <div className="local-tool-links">
            <Link to="/pdf/merge">PDF 工具</Link>
            <Link to="/image/crop">图片工具</Link>
            <span>始终本地 · 无需额度</span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>最近 AI 任务</h2>
            <Link to={`/ai?tenant=${dashboard.tenant.slug}`} className="text-link">打开创作台</Link>
          </div>
          {dashboard.jobs.length === 0 ? (
            <p className="empty-text">还没有任务。模型启用与密钥配置完成后即可生成。</p>
          ) : (
            <ul className="job-list">
              {dashboard.jobs.map((job) => (
                <li key={job.id} className="job-row">
                  <div>
                    <strong>{job.prompt?.slice(0, 46) || '图像生成'}</strong>
                    <span>{job.model} · {formatDate(job.createdAt)}</span>
                  </div>
                  <span className={`status-pill ${job.status}`}>{jobStatusLabel(job.status)}</span>
                  <span className="job-amount">{formatMoney(job.settledCents || job.reservedCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="account-section">
        <div className="panel">
          <div className="panel-head">
            <h2>成员</h2>
            <span className="muted">{isOwner ? '所有者可添加普通成员' : '只读'}</span>
          </div>
          {isOwner ? (
            <div className="inline-form">
              <input
                type="email"
                value={memberEmail}
                placeholder="新成员注册邮箱"
                onChange={(event) => setMemberEmail(event.target.value)}
                data-testid="member-email"
              />
              <button type="button" className="button button-ink" disabled={memberBusy || !memberEmail.trim()} onClick={() => void addMember()} data-testid="add-member">
                {memberBusy ? '添加中…' : '添加成员'}
              </button>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>成员</th><th>角色</th><th>加入时间</th><th /></tr></thead>
              <tbody>
                {dashboard.members.map((member) => (
                  <tr key={member.userId}>
                    <td><UserIcon size={15} /> {member.email || member.userId}</td>
                    <td>{roleLabel(member.role)}</td>
                    <td>{formatDate(member.createdAt)}</td>
                    <td>
                      {isOwner && member.role === 'tenant_member' ? (
                        <button type="button" className="text-button danger" onClick={() => void removeMember(member.userId)}>
                          移除
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
