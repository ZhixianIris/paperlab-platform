import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type {
  AdminOverview,
  AdminTenant,
  AdminTenantDetail,
  ModelInfo,
} from '../lib/types';
import { formatDate, formatMoney, jobStatusLabel, roleLabel, toolLabel } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  CheckIcon,
  LockIcon,
  PlusIcon,
  RefreshIcon,
  ShieldIcon,
} from '../components/Icons';

type Tab = 'overview' | 'tenants' | 'models' | 'usage' | 'orders' | 'jobs';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'tenants', label: '租户与成员' },
  { key: 'models', label: 'AI 模型与价格' },
  { key: 'usage', label: '用量' },
  { key: 'orders', label: '订单' },
  { key: 'jobs', label: 'AI 任务' },
];

export function AdminPage() {
  const { status, session } = useAuth();
  const { push } = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [detail, setDetail] = useState<AdminTenantDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await callPlatformApi<AdminOverview>('admin.overview');
      setOverview(data);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法加载管理数据');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (tenantId: string) => {
    if (!tenantId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const data = await callPlatformApi<AdminTenantDetail>('admin.tenant.detail', { tenantId });
      setDetail(data);
    } catch (loadError) {
      push(loadError instanceof Error ? loadError.message : '无法加载租户详情', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [push]);

  useEffect(() => {
    if (status === 'authenticated' && session?.platformAdmin) void loadOverview();
  }, [status, session, loadOverview]);

  useEffect(() => {
    if (selectedTenantId) void loadDetail(selectedTenantId);
  }, [selectedTenantId, loadDetail]);

  async function refreshAll() {
    await loadOverview(true);
    if (selectedTenantId) await loadDetail(selectedTenantId);
  }

  async function reconcile(jobId: string, decision: 'settle' | 'release') {
    try {
      await callPlatformApi('admin.jobs.reconcile', { jobId, decision });
      push(decision === 'settle' ? '已按已消费结算' : '已释放预占额度', 'success');
      await refreshAll();
    } catch (reconcileError) {
      push(reconcileError instanceof Error ? reconcileError.message : '核对失败', 'error');
    }
  }

  if (status === 'loading') return <div className="page-loading">正在验证管理员身份…</div>;

  if (status !== 'authenticated' || !session) {
    return (
      <div className="empty-page">
        <ShieldIcon size={44} />
        <h1>管理端需要登录</h1>
        <p>平台管理员权限由可信的服务端命令显式授予，不随注册自动获得。</p>
        <Link to="/login?next=/admin" className="button button-accent">登录</Link>
      </div>
    );
  }

  if (!session.platformAdmin) {
    return (
      <div className="empty-page">
        <LockIcon size={44} />
        <span className="eyebrow">403</span>
        <h1>无权访问管理端</h1>
        <p>当前账号不是平台管理员。请使用受信任的管理员账号，或在服务器上运行 <code>npm run admin:grant</code> 后重新登录。</p>
        <Link to="/account" className="button button-ghost">回到账户</Link>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-mark light"><span /><span /></span>
          <div><strong>PaperLab</strong><small>PLATFORM ADMIN</small></div>
        </div>
        <nav className="admin-nav" aria-label="管理导航">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={tab === item.key ? 'active' : ''}
              onClick={() => setTab(item.key)}
              data-testid={`admin-tab-${item.key}`}
            >
              {item.label}
              {item.key === 'jobs' && overview?.counts.pendingJobs ? (
                <span className="nav-count">{overview.counts.pendingJobs}</span>
              ) : null}
            </button>
          ))}
        </nav>
        <div className="admin-side-footer">
          <Link to="/">← 返回站点</Link>
          <Link to="/account">我的账户</Link>
          <span>{session.user.email}</span>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-head">
          <div>
            <span className="eyebrow">PLATFORM ADMIN</span>
            <h1>{TABS.find((item) => item.key === tab)?.label}</h1>
            <p>真实 CloudBase PostgreSQL 数据 · 所有变更即时写入并审计。</p>
          </div>
          <button type="button" className="button button-ghost" onClick={() => void refreshAll()} disabled={loading}>
            <RefreshIcon size={17} /> 刷新
          </button>
        </header>

        {error ? <div className="notice notice-error" role="alert">{error}</div> : null}
        {loading && !overview ? <div className="page-loading">正在读取平台数据…</div> : null}

        {overview && tab === 'overview' ? (
          <OverviewTab overview={overview} onGoTenants={() => setTab('tenants')} />
        ) : null}

        {overview && tab === 'tenants' ? (
          <div className="admin-tenants">
            <CreateTenantForm
              onCreated={async (tenant) => {
                await loadOverview(true);
                setSelectedTenantId(tenant.id);
              }}
            />
            <div className="tenant-admin-layout">
              <section className="panel tenant-picker">
                <div className="panel-head"><h2>全部租户</h2><span>{overview.tenants.length}</span></div>
                <div className="tenant-admin-list">
                  {overview.tenants.map((tenant) => (
                    <button
                      key={tenant.id}
                      type="button"
                      className={selectedTenantId === tenant.id ? 'active' : ''}
                      onClick={() => setSelectedTenantId(tenant.id)}
                      data-testid={`admin-tenant-${tenant.slug}`}
                    >
                      <span className="tenant-monogram">{tenant.name.slice(0, 1)}</span>
                      <span>
                        <strong>{tenant.name}</strong>
                        <small>/t/{tenant.slug} · {tenant.memberCount} 成员</small>
                      </span>
                      <span className={`status-pill ${tenant.status}`}>{tenant.status === 'active' ? '正常' : '停用'}</span>
                    </button>
                  ))}
                  {overview.tenants.length === 0 ? <p className="empty-text">还没有租户。先创建一个。</p> : null}
                </div>
              </section>
              <section className="tenant-detail">
                {detailLoading ? <div className="page-loading">读取租户详情…</div> : null}
                {!detailLoading && !detail ? (
                  <div className="empty-state">
                    <p>选择左侧租户，编辑成员、工具、预算与余额。</p>
                  </div>
                ) : null}
                {detail ? <TenantDetailPanel detail={detail} onChanged={refreshAll} /> : null}
              </section>
            </div>
          </div>
        ) : null}

        {overview && tab === 'models' ? (
          <ModelsTab overview={overview} onRefresh={() => loadOverview(true)} />
        ) : null}

        {overview && tab === 'usage' ? (
          <UsageTab overview={overview} />
        ) : null}

        {overview && tab === 'orders' ? (
          <OrdersTab overview={overview} />
        ) : null}

        {overview && tab === 'jobs' ? (
          <JobsTab overview={overview} onReconcile={reconcile} />
        ) : null}
      </div>
    </div>
  );
}

function OverviewTab({ overview, onGoTenants }: { overview: AdminOverview; onGoTenants: () => void }) {
  return (
    <div className="admin-stack">
      <section className="admin-metrics">
        <article><span>租户</span><strong>{overview.counts.tenantCount}</strong><small>{overview.counts.memberCount} 个成员关系</small></article>
        <article><span>本月 AI 用量</span><strong>{formatMoney(overview.counts.monthUsageCents)}</strong><small>{overview.counts.enabledModels} 个模型启用</small></article>
        <article><span>待核对任务</span><strong>{overview.counts.pendingJobs}</strong><small>{overview.counts.pendingJobs ? '需要人工判断' : '账本干净'}</small></article>
        <article><span>钱包总额</span><strong>{formatMoney(overview.counts.walletTotalCents)}</strong><small>{overview.counts.adminCount} 位平台管理员</small></article>
      </section>

      {!overview.config.payments.enabled ? (
        <div className="notice notice-info">
          <LockIcon size={18} />
          <div><strong>充值入口关闭</strong><p>没有商户资质与签名回调，平台不会创建支付订单或伪造支付成功。管理员可使用“人工入账”做可审计的测试额度。</p></div>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>最近 AI 任务</h2>
          <button type="button" className="text-button" onClick={onGoTenants}>管理租户 →</button>
        </div>
        <JobsTable jobs={overview.jobs.slice(0, 8)} onReconcile={async () => {}} readonly />
      </section>

      <div className="admin-two-col">
        <section className="panel">
          <div className="panel-head"><h2>最近用量</h2></div>
          {overview.usage.length === 0 ? <p className="empty-text">暂无用量。</p> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>时间</th><th>租户</th><th>模型</th><th>金额</th></tr></thead>
                <tbody>{overview.usage.slice(0, 8).map((row) => (
                  <tr key={row.id}><td>{formatDate(row.createdAt)}</td><td>{row.tenantName}</td><td>{row.model}</td><td>{formatMoney(row.amountCents)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>模型状态</h2></div>
          <div className="mini-model-list">
            {overview.models.map((model) => (
              <div key={model.id}>
                <span><strong>{model.displayName}</strong><small>{model.provider} / {model.model}</small></span>
                <span className={`status-pill ${model.available ? 'active' : 'disabled'}`}>{model.available ? '可用' : model.unavailableReason === 'provider_not_configured' ? '未配置' : '停用'}</span>
                <span>{formatMoney(model.unitPriceCents)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CreateTenantForm({ onCreated }: { onCreated: (tenant: AdminTenant) => Promise<void> | void }) {
  const { push } = useToast();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await callPlatformApi<{ tenant: AdminTenant }>('admin.tenants.create', {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        ownerEmail: ownerEmail.trim() || undefined,
      });
      push('租户已创建', 'success');
      setName('');
      setSlug('');
      setOwnerEmail('');
      await onCreated(result.tenant);
    } catch (createError) {
      push(createError instanceof Error ? createError.message : '创建失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel create-tenant" onSubmit={(event) => void submit(event)}>
      <div className="panel-head"><h2><PlusIcon size={18} /> 新建租户</h2><span className="muted">slug 创建后不可修改</span></div>
      <div className="inline-form four">
        <input placeholder="租户名称" value={name} onChange={(event) => setName(event.target.value)} required data-testid="admin-tenant-name" />
        <input placeholder="slug（小写）" value={slug} onChange={(event) => setSlug(event.target.value)} pattern="[a-z0-9][a-z0-9-]{1,31}" required data-testid="admin-tenant-slug" />
        <input type="email" placeholder="所有者邮箱（可选，需已注册）" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} data-testid="admin-tenant-owner" />
        <button type="submit" className="button button-ink" disabled={busy} data-testid="admin-create-tenant">{busy ? '创建中…' : '创建租户'}</button>
      </div>
    </form>
  );
}

function TenantDetailPanel({ detail, onChanged }: { detail: AdminTenantDetail; onChanged: () => Promise<void> }) {
  const { push } = useToast();
  const [name, setName] = useState(detail.tenant.name);
  const [status, setStatus] = useState(detail.tenant.status);
  const [tenantBudget, setTenantBudget] = useState((detail.tenant.monthlyAiBudgetCents / 100).toFixed(2));
  const [jobCap, setJobCap] = useState((detail.tenant.maxJobCostCents / 100).toFixed(2));
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<'tenant_owner' | 'tenant_member'>('tenant_member');
  const [walletAmount, setWalletAmount] = useState('10.00');
  const [walletReason, setWalletReason] = useState('测试额度 · 管理员人工入账');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    setName(detail.tenant.name);
    setStatus(detail.tenant.status);
    setTenantBudget((detail.tenant.monthlyAiBudgetCents / 100).toFixed(2));
    setJobCap((detail.tenant.maxJobCostCents / 100).toFixed(2));
  }, [detail]);

  async function saveTenant() {
    setBusy('save');
    try {
      await callPlatformApi('admin.tenants.update', {
        tenantId: detail.tenant.id,
        name: name.trim(),
        status,
        monthlyBudgetCents: Math.round(Number(tenantBudget) * 100),
        maxJobCostCents: Math.round(Number(jobCap) * 100),
      });
      push('租户设置已保存', 'success');
      await onChanged();
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setBusy('');
    }
  }

  async function addMember() {
    if (!memberEmail.trim()) return;
    setBusy('member');
    try {
      await callPlatformApi('admin.members.add', {
        tenantId: detail.tenant.id,
        email: memberEmail.trim(),
        role: memberRole,
      });
      push('成员已加入', 'success');
      setMemberEmail('');
      await onChanged();
    } catch (memberError) {
      push(memberError instanceof Error ? memberError.message : '添加失败', 'error');
    } finally {
      setBusy('');
    }
  }

  async function removeMember(userId: string) {
    setBusy(`remove-${userId}`);
    try {
      await callPlatformApi('admin.members.remove', { tenantId: detail.tenant.id, userId });
      push('成员已移除', 'success');
      await onChanged();
    } catch (removeError) {
      push(removeError instanceof Error ? removeError.message : '移除失败', 'error');
    } finally {
      setBusy('');
    }
  }

  async function toggleTool(toolKey: string, enabled: boolean) {
    setBusy(`tool-${toolKey}`);
    try {
      await callPlatformApi('admin.tools.update', { tenantId: detail.tenant.id, toolKey, enabled });
      push('工具开关已更新', 'success');
      await onChanged();
    } catch (toolError) {
      push(toolError instanceof Error ? toolError.message : '更新失败', 'error');
    } finally {
      setBusy('');
    }
  }

  async function adjustWallet() {
    setBusy('wallet');
    try {
      await callPlatformApi('admin.wallet.adjust', {
        tenantId: detail.tenant.id,
        amountCents: Math.round(Number(walletAmount) * 100),
        reason: walletReason,
        requestId: crypto.randomUUID(),
      });
      push('额度已调整并写入账本', 'success');
      await onChanged();
    } catch (walletError) {
      push(walletError instanceof Error ? walletError.message : '调整失败', 'error');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="admin-stack">
      <section className="panel">
        <div className="panel-head">
          <h2>{detail.tenant.name}</h2>
          <span className="muted">/t/{detail.tenant.slug}</span>
        </div>
        <div className="tenant-balance-row">
          <div><span>可用</span><strong>{formatMoney(detail.tenant.availableCents)}</strong></div>
          <div><span>预占</span><strong>{formatMoney(detail.tenant.reservedCents)}</strong></div>
          <div><span>本月用量</span><strong>{formatMoney(detail.tenant.monthUsageCents)}</strong></div>
        </div>
        <div className="field-grid field-grid-3">
          <label className="field"><span>名称</span><input value={name} onChange={(event) => setName(event.target.value)} data-testid="admin-tenant-edit-name" /></label>
          <label className="field"><span>状态</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'suspended')}>
              <option value="active">正常</option>
              <option value="suspended">停用</option>
            </select>
          </label>
          <label className="field"><span>月度预算（元）</span><input type="number" min={0} step="0.01" value={tenantBudget} onChange={(event) => setTenantBudget(event.target.value)} /></label>
          <label className="field"><span>单次上限（元）</span><input type="number" min={0} step="0.01" value={jobCap} onChange={(event) => setJobCap(event.target.value)} /></label>
        </div>
        <button type="button" className="button button-ink" onClick={() => void saveTenant()} disabled={busy === 'save'} data-testid="admin-save-tenant">
          {busy === 'save' ? '保存中…' : '保存租户设置'}
        </button>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>成员</h2><span>{detail.members.length}</span></div>
        <div className="inline-form">
          <input type="email" placeholder="已注册邮箱" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} data-testid="admin-member-email" />
          <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'tenant_owner' | 'tenant_member')} data-testid="admin-member-role">
            <option value="tenant_member">普通成员</option>
            <option value="tenant_owner">所有者</option>
          </select>
          <button type="button" className="button button-ink" onClick={() => void addMember()} disabled={busy === 'member' || !memberEmail.trim()} data-testid="admin-add-member">添加成员</button>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>邮箱</th><th>角色</th><th>加入时间</th><th /></tr></thead>
            <tbody>
              {detail.members.map((member) => (
                <tr key={member.userId}>
                  <td>{member.email || member.userId}</td>
                  <td>{roleLabel(member.role)}</td>
                  <td>{formatDate(member.createdAt)}</td>
                  <td><button type="button" className="text-button danger" onClick={() => void removeMember(member.userId)} disabled={busy === `remove-${member.userId}`}>移除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>人工入账</h2><span className="muted">不是支付 · 写入不可变账本</span></div>
        <div className="inline-form">
          <input type="number" step="0.01" value={walletAmount} onChange={(event) => setWalletAmount(event.target.value)} placeholder="金额（元，可为负）" data-testid="admin-wallet-amount" />
          <input value={walletReason} onChange={(event) => setWalletReason(event.target.value)} placeholder="原因" data-testid="admin-wallet-reason" />
          <button type="button" className="button button-ink" onClick={() => void adjustWallet()} disabled={busy === 'wallet'} data-testid="admin-wallet-adjust">
            {busy === 'wallet' ? '写入中…' : '调整额度'}
          </button>
        </div>
        <p className="fine-print">人工入账使用独立账本类型，不能替代真实支付。余额调整会立即影响后续 AI 预占。</p>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>工具开关</h2></div>
        <div className="tool-toggle-grid">
          {detail.tools.map((tool) => (
            <div className="tool-toggle" key={tool.key}>
              <span>{toolLabel(tool.key)}</span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={tool.enabled}
                  disabled={busy === `tool-${tool.key}`}
                  onChange={(event) => void toggleTool(tool.key, event.target.checked)}
                  data-testid={`admin-tool-${tool.key}`}
                />
                <span className="switch-track" />
              </label>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>最近任务</h2></div>
        <JobsTable jobs={detail.jobs} onReconcile={async () => {}} readonly />
      </section>
    </div>
  );
}

function ModelsTab({ overview, onRefresh }: { overview: AdminOverview; onRefresh: () => Promise<void> }) {
  return (
    <div className="admin-stack">
      <div className="notice notice-info">
        <LockIcon size={18} />
        <div><strong>密钥只在函数环境</strong><p>模型配置不会显示或保存 API Key。没有供应商密钥时，即使模型开关打开，服务端仍拒绝生成且不扣费。</p></div>
      </div>
      <section className="panel">
        <div className="panel-head"><h2>模型与价格</h2><span>{overview.models.length} 条</span></div>
        <div className="model-admin-list">
          {overview.models.map((model) => <ModelRow key={model.id} model={model} onRefresh={onRefresh} />)}
        </div>
      </section>
      <CreateModelForm onCreated={onRefresh} />
    </div>
  );
}

function ModelRow({ model, onRefresh }: { model: ModelInfo; onRefresh: () => Promise<void> }) {
  const { push } = useToast();
  const [displayName, setDisplayName] = useState(model.displayName);
  const [price, setPrice] = useState((model.unitPriceCents / 100).toFixed(2));
  const [maxImages, setMaxImages] = useState(model.maxImages);
  const [maxPrompt, setMaxPrompt] = useState(model.maxPromptChars);
  const [budget, setBudget] = useState((model.monthlyBudgetCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDisplayName(model.displayName);
    setPrice((model.unitPriceCents / 100).toFixed(2));
    setMaxImages(model.maxImages);
    setMaxPrompt(model.maxPromptChars);
    setBudget((model.monthlyBudgetCents / 100).toFixed(2));
  }, [model]);

  async function save() {
    setBusy(true);
    try {
      await callPlatformApi('admin.models.update', {
        modelId: model.id,
        displayName: displayName.trim(),
        unitPriceCents: Math.round(Number(price) * 100),
        maxImages,
        maxPromptChars: maxPrompt,
        monthlyBudgetCents: Math.round(Number(budget) * 100),
      });
      push('模型配置已保存', 'success');
      await onRefresh();
    } catch (saveError) {
      push(saveError instanceof Error ? saveError.message : '保存失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      await callPlatformApi('admin.models.update', { modelId: model.id, enabled });
      push(`模型已${enabled ? '启用' : '停用'}`, 'success');
      await onRefresh();
    } catch (toggleError) {
      push(toggleError instanceof Error ? toggleError.message : '更新失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`model-admin-row ${model.available ? 'available' : ''}`}>
      <div className="model-admin-head">
        <div>
          <strong>{model.displayName}</strong>
          <small>{model.provider} / {model.model}</small>
        </div>
        <div className="model-admin-badges">
          <span className={`status-pill ${model.providerConfigured ? 'active' : 'disabled'}`}>
            {model.providerConfigured ? '供应商已配置' : '供应商未配置'}
          </span>
          <label className="switch">
            <input type="checkbox" checked={model.enabled} disabled={busy} onChange={(event) => void toggle(event.target.checked)} data-testid={`model-toggle-${model.provider}`} />
            <span className="switch-track" />
          </label>
        </div>
      </div>
      <div className="field-grid field-grid-4">
        <label className="field"><span>显示名称</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label className="field"><span>单价（元 / 张）</span><input type="number" min={0} step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} data-testid={`model-price-${model.provider}`} /></label>
        <label className="field"><span>最多图片数</span><input type="number" min={1} max={4} value={maxImages} onChange={(event) => setMaxImages(Number(event.target.value))} /></label>
        <label className="field"><span>提示词上限</span><input type="number" min={1} max={4000} value={maxPrompt} onChange={(event) => setMaxPrompt(Number(event.target.value))} /></label>
        <label className="field"><span>模型月成本上限（元）</span><input type="number" min={0} step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
      </div>
      <button type="button" className="button button-ghost button-small" onClick={() => void save()} disabled={busy} data-testid={`model-save-${model.provider}`}>
        {busy ? '保存中…' : '保存价格与限制'}
      </button>
    </div>
  );
}

function CreateModelForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { push } = useToast();
  const [provider, setProvider] = useState('openai');
  const [modelName, setModelName] = useState('gpt-image-1');
  const [displayName, setDisplayName] = useState('');
  const [price, setPrice] = useState('5.00');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await callPlatformApi('admin.models.create', {
        provider,
        model: modelName,
        displayName: displayName || modelName,
        description: '管理员创建的模型价格条目',
        unitPriceCents: Math.round(Number(price) * 100),
        enabled: false,
        maxImages: 1,
        maxPromptChars: 1000,
        monthlyBudgetCents: 10000,
      });
      push('模型已创建，默认停用', 'success');
      setDisplayName('');
      await onCreated();
    } catch (createError) {
      push(createError instanceof Error ? createError.message : '创建失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={(event) => void submit(event)}>
      <div className="panel-head"><h2><PlusIcon size={18} /> 添加模型</h2><span className="muted">先创建，核验密钥后再启用</span></div>
      <div className="inline-form four">
        <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="provider" required />
        <input value={modelName} onChange={(event) => setModelName(event.target.value)} placeholder="model id" required />
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名称" />
        <input type="number" min={0} step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="单价（元）" />
        <button type="submit" className="button button-ink" disabled={busy}>{busy ? '创建中…' : '添加模型'}</button>
      </div>
    </form>
  );
}

function UsageTab({ overview }: { overview: AdminOverview }) {
  return (
    <section className="panel">
      <div className="panel-head"><h2>AI 用量记录</h2><span>{overview.usage.length} 条</span></div>
      {overview.usage.length === 0 ? <p className="empty-text">还没有用量。生成任务成功结算后会写入这里。</p> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>时间</th><th>租户</th><th>模型</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
            <tbody>{overview.usage.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.createdAt)}</td><td>{row.tenantName}</td><td>{row.model}</td>
                <td>{row.quantity}</td><td>{formatMoney(row.unitPriceCents)}</td><td>{formatMoney(row.amountCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function OrdersTab({ overview }: { overview: AdminOverview }) {
  return (
    <div className="admin-stack">
      <div className="notice notice-info">
        <LockIcon size={18} />
        <div><strong>支付边界：{overview.config.payments.enabled ? '已配置' : '关闭'}</strong><p>{overview.config.payments.message || '等待签名回调验收。'}</p></div>
      </div>
      <section className="panel">
        <div className="panel-head"><h2>订单</h2><span>{overview.orders.length} 条</span></div>
        {overview.orders.length === 0 ? (
          <div className="empty-state"><p>暂无真实订单。没有支付商户凭证时不会生成假订单。</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>时间</th><th>租户</th><th>金额</th><th>状态</th><th>渠道</th></tr></thead>
              <tbody>{overview.orders.map((order) => (
                <tr key={order.id}>
                  <td>{formatDate(order.createdAt)}</td><td>{order.tenantName}</td><td>{formatMoney(order.amountCents)}</td>
                  <td><span className={`status-pill ${order.status}`}>{order.status}</span></td><td>{order.provider}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function JobsTab({ overview, onReconcile }: { overview: AdminOverview; onReconcile: (id: string, decision: 'settle' | 'release') => Promise<void> }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>AI 任务</h2>
        <span>{overview.counts.pendingJobs} 个待核对</span>
      </div>
      <p className="fine-print">待核对表示供应商响应不确定，预占金额仍保留。只有管理员能决定结算或释放。</p>
      <JobsTable jobs={overview.jobs} onReconcile={onReconcile} />
    </section>
  );
}

function JobsTable({ jobs, onReconcile, readonly = false }: { jobs: AdminOverview['jobs']; onReconcile: (id: string, decision: 'settle' | 'release') => Promise<void>; readonly?: boolean }) {
  if (jobs.length === 0) return <p className="empty-text">暂无任务。</p>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>时间</th><th>租户</th><th>模型</th><th>状态</th><th>预占 / 结算</th>{readonly ? null : <th>核对</th>}</tr></thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{formatDate(job.createdAt)}</td>
              <td>{(job as { tenantName?: string }).tenantName || '—'}</td>
              <td>{job.model}</td>
              <td><span className={`status-pill ${job.status}`}>{jobStatusLabel(job.status)}</span></td>
              <td>{formatMoney(job.reservedCents)} / {formatMoney(job.settledCents)}</td>
              {readonly ? null : (
                <td>
                  {job.status === 'pending_reconciliation' ? (
                    <span className="inline-actions">
                      <button type="button" className="text-button" onClick={() => void onReconcile(job.id, 'release')} data-testid={`reconcile-release-${job.id}`}>释放</button>
                      <button type="button" className="text-button danger" onClick={() => void onReconcile(job.id, 'settle')} data-testid={`reconcile-settle-${job.id}`}>按已消费</button>
                    </span>
                  ) : <CheckIcon size={15} />}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
