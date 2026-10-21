import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type { AccountSummary } from '../lib/types';
import { formatDate, formatMoney } from '../lib/format';
import { ArrowIcon, LockIcon, ShieldIcon, UserIcon } from '../components/Icons';

export function AccountPage() {
  const { session, status, logout, configMissing } = useAuth();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== 'authenticated' || !session) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    callPlatformApi<AccountSummary>('account.summary')
      .then((data) => {
        if (!cancelled) {
          setSummary(data);
          setError('');
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : '无法加载账户');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status, session]);

  if (status === 'loading' || loading) {
    return <div className="page-loading">正在载入账户…</div>;
  }

  if (status !== 'authenticated' || !summary) {
    return (
      <div className="empty-page">
        <UserIcon size={42} />
        <h1>{configMissing ? '登录尚未配置' : '请先登录'}</h1>
        <p>{configMissing ? '部署时配置 CloudBase 环境与 Publishable Key 后即可使用。' : '登录后查看租户、额度、用量与账本。'}</p>
        {!configMissing ? <Link to="/login?next=/account" className="button button-accent">去登录</Link> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="account-page">
      <header className="account-head">
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h1>账户与额度</h1>
          <p>{summary.user.email || summary.user.id}</p>
        </div>
        <div className="account-actions">
          {summary.platformAdmin ? (
            <Link to="/admin" className="button button-ghost"><ShieldIcon size={17} /> 管理端</Link>
          ) : null}
          <button
            type="button"
            className="button button-ghost"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
          >
            退出登录
          </button>
        </div>
      </header>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <section className="account-section">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">MEMBERSHIPS</span>
            <h2>我的租户</h2>
          </div>
          <p>{summary.memberships.length} 个可见空间</p>
        </div>
        {summary.memberships.length === 0 ? (
          <div className="empty-state">
            <p>你还没有加入任何租户。请联系平台管理员或租户所有者，用你的注册邮箱添加成员。</p>
          </div>
        ) : (
          <div className="membership-grid">
            {summary.memberships.map((membership) => (
              <Link key={membership.tenantId} to={`/t/${membership.slug}`} className="membership-card">
                <div className="membership-top">
                  <span className="tenant-monogram">{membership.tenantName.slice(0, 1)}</span>
                  <span className={`role-pill ${membership.role}`}>
                    {membership.role === 'tenant_owner' ? '所有者' : '成员'}
                  </span>
                </div>
                <h3>{membership.tenantName}</h3>
                <p className="slug">/t/{membership.slug}</p>
                <div className="membership-stats">
                  <div><span>可用余额</span><strong>{formatMoney(membership.availableCents)}</strong></div>
                  <div><span>本月已用</span><strong>{formatMoney(membership.tenantMonthSpentCents)}</strong></div>
                </div>
                <span className="card-link">进入工作台 <ArrowIcon size={15} /></span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="account-section two-col">
        <div className="panel">
          <div className="panel-head">
            <h2>AI 用量</h2>
            <span className="muted">最近 20 条</span>
          </div>
          {summary.usage.length === 0 ? (
            <p className="empty-text">还没有 AI 用量记录。</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>时间</th><th>租户</th><th>模型</th><th>数量</th><th>金额</th></tr></thead>
                <tbody>
                  {summary.usage.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>{row.tenantName}</td>
                      <td>{row.model}</td>
                      <td>{row.quantity}</td>
                      <td>{formatMoney(row.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <h2>充值</h2>
            <LockIcon size={18} />
          </div>
          {summary.config.payments.enabled ? (
            <p>支付渠道已配置。订单入口将在商户回调验收后启用。</p>
          ) : (
            <div className="payment-closed">
              <strong>充值暂未开放</strong>
              <p>支付商户资质与签名回调尚未配置。需要额度时，请联系平台管理员进行可审计的人工入账。</p>
            </div>
          )}
          <div className="mini-ledger">
            <h3>最近账本</h3>
            {summary.ledger.length === 0 ? (
              <p className="empty-text">暂无账本记录。</p>
            ) : (
              summary.ledger.map((entry) => (
                <div key={entry.id} className="ledger-row">
                  <span>{entry.kind}</span>
                  <span>{entry.availableDeltaCents >= 0 ? '+' : ''}{formatMoney(entry.availableDeltaCents)}</span>
                  <small>{formatDate(entry.createdAt)}</small>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="account-section">
        <div className="panel">
          <div className="panel-head">
            <h2>订单</h2>
            <span className="muted">仅显示真实订单</span>
          </div>
          {summary.orders.length === 0 ? (
            <p className="empty-text">暂无订单。当前支付入口关闭。</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>创建时间</th><th>租户</th><th>金额</th><th>状态</th></tr></thead>
                <tbody>
                  {summary.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{formatDate(order.createdAt)}</td>
                      <td>{order.tenantName}</td>
                      <td>{formatMoney(order.amountCents)}</td>
                      <td><span className={`status-pill ${order.status}`}>{order.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
