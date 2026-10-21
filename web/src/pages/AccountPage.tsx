import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type { AccountSummary } from '../lib/types';
import { formatDate, formatMoney } from '../lib/format';
import { ledgerKindLabel, orderStatusLabel, userError } from '../lib/userMessages';
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
        if (!cancelled) setError(userError(loadError, '无法加载账户'));
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
        <p>{configMissing ? '登录暂不可用，本地工具不受影响。' : '登录后查看空间、额度和使用记录。'}</p>
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
            <h2>我的空间</h2>
          </div>
          <p>{summary.memberships.length} 个空间</p>
        </div>
        {summary.memberships.length === 0 ? (
          <div className="empty-state">
            <p>你还没有加入任何空间。请联系空间管理员邀请你。</p>
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
                <thead><tr><th>时间</th><th>空间</th><th>类型</th><th>数量</th><th>金额</th></tr></thead>
                <tbody>
                  {summary.usage.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.createdAt)}</td>
                      <td>{row.tenantName}</td>
                      <td>AI 图片</td>
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
            <p>充值功能准备中。</p>
          ) : (
            <div className="payment-closed">
              <strong>充值暂未开放</strong>
              <p>如需额度，请联系空间管理员。</p>
            </div>
          )}
          <div className="mini-ledger">
            <h3>额度记录</h3>
            {summary.ledger.length === 0 ? (
              <p className="empty-text">暂无额度记录。</p>
            ) : (
              summary.ledger.map((entry) => (
                <div key={entry.id} className="ledger-row">
                  <span>{ledgerKindLabel(entry.kind)}</span>
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
            <h2>订单记录</h2>
            <span className="muted">最近 20 条</span>
          </div>
          {summary.orders.length === 0 ? (
            <p className="empty-text">暂无订单。</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>创建时间</th><th>空间</th><th>金额</th><th>状态</th></tr></thead>
                <tbody>
                  {summary.orders.map((order) => (
                    <tr key={order.id}>
                      <td>{formatDate(order.createdAt)}</td>
                      <td>{order.tenantName}</td>
                      <td>{formatMoney(order.amountCents)}</td>
                      <td><span className={`status-pill ${order.status}`}>{orderStatusLabel(order.status)}</span></td>
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
