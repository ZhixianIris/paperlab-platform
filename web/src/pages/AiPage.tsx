import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type { AiJob, GenerateResult, ModelInfo, TenantDashboard } from '../lib/types';
import { formatDate, formatMoney, jobStatusLabel } from '../lib/format';
import { downloadDataUrl } from '../lib/download';
import { useToast } from '../components/Toast';
import { AlertIcon, DownloadIcon, LockIcon, SparklesIcon } from '../components/Icons';

function newRequestId(): string {
  return crypto.randomUUID();
}

export function AiPage() {
  const { status, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { push } = useToast();
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [dashboard, setDashboard] = useState<TenantDashboard | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [count, setCount] = useState(1);
  const [requestId, setRequestId] = useState(newRequestId);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [activeJob, setActiveJob] = useState<AiJob | null>(null);

  const memberships = useMemo(() => session?.memberships ?? [], [session]);
  const selectedMembership = memberships.find((item) => item.tenantId === selectedTenantId) ?? null;
  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;

  useEffect(() => {
    if (status !== 'authenticated' || memberships.length === 0) {
      setSelectedTenantId('');
      return;
    }
    const requested = searchParams.get('tenant');
    const match = memberships.find((item) => item.slug === requested);
    setSelectedTenantId((current) => {
      if (current && memberships.some((item) => item.tenantId === current)) return current;
      return match?.tenantId ?? memberships[0].tenantId;
    });
  }, [status, session, memberships, searchParams]);

  const loadData = useCallback(async () => {
    if (!selectedTenantId) return;
    setLoading(true);
    setError('');
    try {
      const [nextDashboard, nextModels, nextJobs] = await Promise.all([
        callPlatformApi<TenantDashboard>('tenant.dashboard', { tenantId: selectedTenantId }),
        callPlatformApi<ModelInfo[]>('models.list', { tenantId: selectedTenantId }),
        callPlatformApi<AiJob[]>('ai.jobs', { tenantId: selectedTenantId, limit: 20 }),
      ]);
      setDashboard(nextDashboard);
      setModels(nextModels);
      setJobs(nextJobs);
      setSelectedModelId((current) => {
        if (nextModels.some((model) => model.id === current)) return current;
        return nextModels.find((model) => model.available)?.id ?? nextModels[0]?.id ?? '';
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '无法加载创作台');
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    if (selectedTenantId) void loadData();
  }, [selectedTenantId, loadData]);

  function chooseTenant(tenantId: string) {
    setSelectedTenantId(tenantId);
    const membership = memberships.find((item) => item.tenantId === tenantId);
    const next = new URLSearchParams(searchParams);
    if (membership) next.set('tenant', membership.slug);
    setSearchParams(next, { replace: true });
    setActiveJob(null);
  }

  function editPrompt(value: string) {
    setPrompt(value);
    setRequestId(newRequestId());
    setActiveJob(null);
  }

  async function generate() {
    if (!selectedMembership || !selectedModel) return;
    if (!selectedModel.available) {
      setError('该模型当前不可用，请联系管理员检查模型开关与供应商密钥');
      return;
    }
    setGenerating(true);
    setError('');
    setActiveJob(null);
    try {
      const result = await callPlatformApi<GenerateResult>('ai.generate', {
        tenantId: selectedTenantId,
        modelId: selectedModel.id,
        requestId,
        prompt: prompt.trim(),
        size,
        count,
      });
      setActiveJob(result.job);
      if (result.error) {
        if (result.error.code !== 'pending_reconciliation') {
          push(result.error.message, 'error');
          setRequestId(newRequestId());
        } else {
          push(result.error.message, 'info');
        }
      } else {
        push('图片已生成并完成结算', 'success');
        setRequestId(newRequestId());
      }
      await loadData();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '生成失败');
    } finally {
      setGenerating(false);
    }
  }

  const resultImage = useMemo(() => {
    const image = activeJob?.result?.images?.[0];
    return image?.dataUrl || image?.url || null;
  }, [activeJob]);

  if (status === 'loading') return <div className="page-loading">正在载入创作台…</div>;

  if (status !== 'authenticated' || !session) {
    return (
      <div className="empty-page">
        <SparklesIcon size={44} />
        <span className="eyebrow">AI STUDIO</span>
        <h1>登录后开始创作</h1>
        <p>AI 调用需要 CloudBase 身份、租户成员资格和可用额度。文件工具无需登录。</p>
        <Link to="/login?next=/ai" className="button button-accent">登录</Link>
      </div>
    );
  }

  if (memberships.length === 0) {
    return (
      <div className="empty-page">
        <LockIcon size={42} />
        <h1>还没有租户</h1>
        <p>AI 工作台属于租户。请联系平台管理员或租户所有者，用你的注册邮箱添加成员。</p>
        <Link to="/account" className="button button-ghost">查看账户</Link>
      </div>
    );
  }

  const aiConfigured = dashboard?.config.ai.configured ?? session.config.ai.configured;
  const canSubmit =
    !generating &&
    Boolean(selectedModel?.available) &&
    aiConfigured &&
    prompt.trim().length >= 3 &&
    selectedMembership?.tenantStatus === 'active';

  return (
    <div className="ai-page">
      <header className="ai-head">
        <div>
          <span className="eyebrow">AI STUDIO / CLOUDBASE BILLING</span>
          <h1>把提示词变成图像。</h1>
          <p>服务端选择价格、预留余额、调用供应商、结算并写入账本。前端不接触密钥。</p>
        </div>
        <label className="tenant-select">
          <span>当前租户</span>
          <select value={selectedTenantId} onChange={(event) => chooseTenant(event.target.value)} data-testid="ai-tenant-select">
            {memberships.map((membership) => (
              <option key={membership.tenantId} value={membership.tenantId}>{membership.tenantName}</option>
            ))}
          </select>
        </label>
      </header>

      {dashboard ? (
        <section className="ai-metrics">
          <div><span>可用余额</span><strong>{formatMoney(dashboard.wallet.availableCents)}</strong></div>
          <div><span>预占</span><strong>{formatMoney(dashboard.wallet.reservedCents)}</strong></div>
          <div><span>本月用量</span><strong>{formatMoney(dashboard.usage.userMonthSpentCents)}</strong></div>
          <div><span>我的月度上限</span><strong>{formatMoney(dashboard.membership.userBudgetCents)}</strong></div>
        </section>
      ) : null}

      {!aiConfigured ? (
        <div className="notice notice-warn" data-testid="ai-unconfigured">
          <AlertIcon size={18} />
          <div>
            <strong>图像模型尚未配置</strong>
            <p>管理员尚未启用模板或服务端缺少供应商密钥。页面不会发起任务，也不会扣费。请联系平台管理员配置 <code>OPENAI_API_KEY</code> 并启用模型。</p>
          </div>
        </div>
      ) : null}

      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}

      {loading ? (
        <div className="page-loading">正在读取模型与余额…</div>
      ) : (
        <div className="ai-layout">
          <section className="panel ai-compose">
            <div className="panel-head">
              <h2>图像生成</h2>
              <span className="muted">按次计费 · 服务端定价</span>
            </div>

            <div className="model-list" role="radiogroup" aria-label="选择模型">
              {models.length === 0 ? (
                <p className="empty-text">管理员尚未启用任何模型。启用后这里会显示价格和可用状态。</p>
              ) : (
                models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={`model-card ${selectedModelId === model.id ? 'selected' : ''} ${!model.available ? 'unavailable' : ''}`}
                    onClick={() => {
                      setSelectedModelId(model.id);
                      setCount((current) => Math.min(current, model.maxImages));
                      setRequestId(newRequestId());
                      setActiveJob(null);
                    }}
                    data-testid={`model-${model.provider}`}
                  >
                    <span className="model-radio" aria-hidden="true" />
                    <span className="model-info">
                      <strong>{model.displayName}</strong>
                      <small>{model.provider} / {model.model}</small>
                      <small>
                        {model.available
                          ? `${formatMoney(model.unitPriceCents)} / 张 · 最多 ${model.maxImages} 张`
                          : model.unavailableReason === 'provider_not_configured'
                            ? '供应商密钥未配置'
                            : '管理员已停用'}
                      </small>
                    </span>
                  </button>
                ))
              )}
            </div>

            <label className="field">
              <span>提示词</span>
              <textarea
                rows={5}
                value={prompt}
                maxLength={selectedModel?.maxPromptChars ?? 1000}
                onChange={(event) => editPrompt(event.target.value)}
                placeholder="例如：一张有纸张纹理的极简杂志封面，青绿色与珊瑚色，留白充足"
                data-testid="ai-prompt"
              />
              <small>{prompt.length} / {selectedModel?.maxPromptChars ?? 1000} 字符</small>
            </label>

            <div className="field-grid">
              <label className="field">
                <span>尺寸</span>
                <select value={size} onChange={(event) => { setSize(event.target.value); setRequestId(newRequestId()); }}>
                  <option value="1024x1024">1024 × 1024 方形</option>
                  <option value="1536x1024">1536 × 1024 横向</option>
                  <option value="1024x1536">1024 × 1536 纵向</option>
                </select>
              </label>
              <label className="field">
                <span>数量</span>
                <input
                  type="number"
                  min={1}
                  max={selectedModel?.maxImages ?? 1}
                  value={count}
                  onChange={(event) => {
                    setCount(Math.max(1, Math.min(selectedModel?.maxImages ?? 1, Number(event.target.value) || 1)));
                    setRequestId(newRequestId());
                  }}
                  data-testid="ai-count"
                />
              </label>
            </div>

            <div className="cost-preview">
              <span>预估扣费</span>
              <strong>{selectedModel ? formatMoney(selectedModel.unitPriceCents * count) : '—'}</strong>
              <small>最终价格以数据库中的模型价格为准，前端无法指定价格。</small>
            </div>

            <button
              type="button"
              className="button button-accent button-large"
              disabled={!canSubmit}
              onClick={() => void generate()}
              data-testid="ai-generate"
            >
              {generating ? <><span className="spinner" /> 生成中，请勿关闭…</> : <><SparklesIcon size={18} /> 生成图像</>}
            </button>
            <p className="fine-print">请求 ID: <code>{requestId.slice(0, 8)}…</code> · 重试同一请求 ID 不会重复扣费。</p>
          </section>

          <aside className="ai-side">
            <div className="panel result-panel" data-testid="ai-result-panel">
              <div className="panel-head">
                <h2>生成结果</h2>
                {activeJob ? <span className={`status-pill ${activeJob.status}`}>{jobStatusLabel(activeJob.status)}</span> : null}
              </div>
              {!activeJob ? (
                <div className="result-placeholder">
                  <SparklesIcon size={32} />
                  <p>生成结果会出现在这里。图片由服务端供应商返回，不使用静态示例。</p>
                </div>
              ) : activeJob.status === 'succeeded' && resultImage ? (
                <div className="ai-image-result" data-testid="ai-result-image">
                  <img src={resultImage} alt={activeJob.prompt || 'AI 生成结果'} />
                  <div className="ai-result-meta">
                    <span>{activeJob.model}</span>
                    <strong>{formatMoney(activeJob.settledCents)}</strong>
                  </div>
                  {activeJob.result?.images?.[0]?.dataUrl ? (
                    <button
                      type="button"
                      className="button button-accent"
                      onClick={() => {
                        const mime = activeJob.result?.images?.[0]?.mimeType || 'image/png';
                        downloadDataUrl(resultImage, `paperlab-${activeJob.id.slice(0, 8)}.${mime.split('/')[1] || 'png'}`);
                      }}
                      data-testid="ai-download"
                    >
                      <DownloadIcon size={17} /> 下载图片
                    </button>
                  ) : (
                    <a href={resultImage} target="_blank" rel="noreferrer" className="button button-accent">打开图片</a>
                  )}
                </div>
              ) : activeJob.status === 'pending_reconciliation' ? (
                <div className="result-placeholder pending">
                  <AlertIcon size={30} />
                  <strong>等待人工核对</strong>
                  <p>{activeJob.errorMessage || '供应商响应不确定，额度保持预占，不会自动退款或重复扣费。'}</p>
                </div>
              ) : activeJob.status === 'failed' ? (
                <div className="result-placeholder failed">
                  <AlertIcon size={30} />
                  <strong>本次未产生费用</strong>
                  <p>{activeJob.errorMessage || '供应商拒绝了请求，预占额度已释放。'}</p>
                </div>
              ) : (
                <div className="result-placeholder">
                  <AlertIcon size={30} />
                  <strong>任务处理中</strong>
                  <p>刷新页面或稍后查看历史记录。</p>
                </div>
              )}
            </div>

            <div className="panel">
              <div className="panel-head"><h2>计费边界</h2></div>
              <ul className="check-list">
                <li>价格与模型开关由管理员维护</li>
                <li>先预占，成功后结算，明确失败才释放</li>
                <li>超时或未知响应进入待核对</li>
                <li>租户与个人月度预算同时生效</li>
                <li>充值入口在商户资质就绪前保持关闭</li>
              </ul>
              <Link to="/account" className="text-link">查看账户与账本 →</Link>
            </div>
          </aside>
        </div>
      )}

      <section className="panel ai-history">
        <div className="panel-head">
          <h2>任务历史</h2>
          <button type="button" className="text-button" onClick={() => void loadData()}>刷新</button>
        </div>
        {jobs.length === 0 ? (
          <p className="empty-text">还没有任务记录。</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table" data-testid="ai-history">
              <thead><tr><th>时间</th><th>提示词</th><th>模型</th><th>状态</th><th>费用</th></tr></thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{formatDate(job.createdAt)}</td>
                    <td className="truncate">{job.prompt || '—'}</td>
                    <td>{job.model}</td>
                    <td><span className={`status-pill ${job.status}`}>{jobStatusLabel(job.status)}</span></td>
                    <td>{formatMoney(job.settledCents || job.reservedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
