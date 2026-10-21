import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type { TenantDashboard } from '../lib/types';
import { formatDate, formatMoney, jobStatusLabel, roleLabel, toolLabel } from '../lib/format';
import { userError } from '../lib/userMessages';
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
            setError(userError(dashboardError, '无法加载空间'));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('空间不存在或已暂停使用');
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
      push('成员已加入空间', 'success');
      setMemberEmail('');
      await refreshDashboard();
    } catch (addError) {
      push(userError(addError, '添加失败'), 'error');
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
      push(userError(removeError, '移除失败'), 'error');
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
      push(userError(toolError, '更新失败'), 'error');
    } finally {
      setToolBusy(null);
    }
  }

  if (status === 'loading' || loading) {
    return <div className="page-loading">正在载入空间…</div>;
  }

  if (!publicTenant) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <h1>空间不可用</h1>
        <p>{error || '找不到该空间，或者它已暂停使用。'}</p>
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
          <p>这是你的团队空间。登录后查看额度、功能和生成记录。</p>
          {configMissing ? (
            <p className="notice notice-warn">登录暂不可用；本地工具仍可使用。</p>
          ) : (
            <Link className="button button-accent button-large" to={`/login?next=/t/${publicTenant.slug}`}>
              登录进入 <ArrowIcon size={18} />
            </Link>
          )}
        </div>
        <Link to="/pdf" className="text-link">返回工作台</Link>
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <span className="eyebrow">403</span>
        <h1>你没有访问权限</h1>
        <p>{publicTenant.name} 没有你的成员记录。</p>
        <Link to="/account" className="button button-ghost">查看我的空间</Link>
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <h1>无法进入工作台</h1>
        <p>{error || '空间返回了空数据。'}</p>
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
            <span className="eyebrow">SPACE / {dashboard.tenant.slug}</span>
            <h1>{dashboard.tenant.name}</h1>
            <p>{roleLabel(dashboard.role)} · {dashboard.members.length} 位成员 · {dashboard.tenant.status === 'active' ? '正常' : '暂停'}</p>
          </div>
        </div>
        <div className="tenant-head-actions">
          <Link to={`/ai/image?tenant=${dashboard.tenant.slug}`} className={`button ${aiEnabled ? 'button-accent' : 'button-disabled'}`} aria-disabled={!aiEnabled}>
            <SparklesIcon size={17} /> AI 出图
          </Link>
          <Link to="/account" className="button button-ghost">账户</Link>
        </div>
      </header>

      {dashboard.tenant.status !== 'active' ? (
        <div className="notice notice-warn">空间已暂停使用，请联系管理员。</div>
      ) : null}
      {!aiTool?.enabled ? (
        <div className="notice notice-warn">AI 出图已关闭。</div>
      ) : null}

      <section className="tenant-metrics">
        <article className="metric-card">
          <span>可用额度</span>
          <strong>{formatMoney(dashboard.wallet.availableCents)}</strong>
          <small>占用中 {formatMoney(dashboard.wallet.reservedCents)}</small>
        </article>
        <article className="metric-card">
          <span>本月空间用量</span>
          <strong>{formatMoney(dashboard.usage.tenantMonthSpentCents)}</strong>
          <small>月度上限 {formatMoney(dashboard.tenant.monthlyAiBudgetCents)}</small>
        </article>
        <article className="metric-card">
          <span>我的本月用量</span>
          <strong>{formatMoney(dashboard.usage.userMonthSpentCents)}</strong>
          <small>我的上限 {formatMoney(dashboard.membership.userBudgetCents)}</small>
        </article>
        <article className="metric-card">
          <span>单次使用上限</span>
          <strong>{formatMoney(dashboard.tenant.maxJobCostCents)}</strong>
          <small>超过上限需调整设置</small>
        </article>
      </section>

      <section className="tenant-grid">
        <div className="panel tenant-tools">
          <div className="panel-head">
            <h2>可用功能</h2>
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
            <Link to="/pdf">PDF 工具</Link>
            <Link to="/image">图片工具</Link>
            <span>始终本地 · 无需额度</span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>最近生成</h2>
            <Link to={`/ai/image?tenant=${dashboard.tenant.slug}`} className="text-link">打开 AI 出图</Link>
          </div>
          {dashboard.jobs.length === 0 ? (
            <p className="empty-text">还没有生成记录。</p>
          ) : (
            <ul className="job-list">
              {dashboard.jobs.map((job) => (
                <li key={job.id} className="job-row">
                  <div>
                    <strong>{job.prompt?.slice(0, 46) || '图像生成'}</strong>
                    <span>{formatDate(job.createdAt)}</span>
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
            <span className="muted">{isOwner ? '邀请成员加入空间' : '只读'}</span>
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
