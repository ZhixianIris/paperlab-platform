import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import type { AiJob, GenerateResult, ModelInfo, TenantDashboard } from '../lib/types';
import { formatDate, formatMoney, jobStatusLabel } from '../lib/format';
import { userError, userMessageForCode } from '../lib/userMessages';
import { downloadDataUrl } from '../lib/download';
import { useToast } from '../components/Toast';
import { AlertIcon, DownloadIcon, PlusIcon, SparklesIcon } from '../components/Icons';

function newRequestId(): string {
  return crypto.randomUUID();
}

export function ImageStudioPanel({
  tenantId,
  onUseFile,
}: {
  tenantId: string;
  onUseFile: (file: File) => Promise<void>;
}) {
  const { session } = useAuth();
  const { push } = useToast();
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

  const selectedModel = models.find((model) => model.id === selectedModelId) ?? null;

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError('');
    try {
      const [nextDashboard, nextModels, nextJobs] = await Promise.all([
        callPlatformApi<TenantDashboard>('tenant.dashboard', { tenantId }),
        callPlatformApi<ModelInfo[]>('models.list', { tenantId }),
        callPlatformApi<AiJob[]>('ai.jobs', { tenantId, limit: 20 }),
      ]);
      setDashboard(nextDashboard);
      setModels(nextModels);
      setJobs(nextJobs);
      setSelectedModelId((current) => {
        if (nextModels.some((model) => model.id === current)) return current;
        return nextModels.find((model) => model.available)?.id ?? nextModels[0]?.id ?? '';
      });
    } catch (loadError) {
      setError(userError(loadError, '无法加载 AI 出图'));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function editPrompt(value: string) {
    setPrompt(value);
    setRequestId(newRequestId());
    setActiveJob(null);
  }

  async function generate() {
    if (!selectedModel) return;
    if (!selectedModel.available) {
      setError('该功能暂不可用，请稍后再试');
      return;
    }
    setGenerating(true);
    setError('');
    setActiveJob(null);
    try {
      const result = await callPlatformApi<GenerateResult>('ai.generate', {
        tenantId,
        modelId: selectedModel.id,
        requestId,
        prompt: prompt.trim(),
        size,
        count,
      });
      setActiveJob(result.job);
      if (result.error) {
        if (result.error.code !== 'pending_reconciliation') {
          push(userMessageForCode(result.error.code, '生成未成功'), 'error');
          setRequestId(newRequestId());
        } else {
          push('生成结果确认中，额度会暂时保留', 'info');
        }
      } else {
        push('图片已生成', 'success');
        setRequestId(newRequestId());
      }
      await loadData();
    } catch (generateError) {
      setError(userError(generateError, '生成失败'));
    } finally {
      setGenerating(false);
    }
  }

  const resultImage = useMemo(() => {
    const image = activeJob?.result?.images?.[0];
    return image?.dataUrl || image?.url || null;
  }, [activeJob]);

  const aiConfigured = dashboard?.config.ai.configured ?? session?.config.ai.configured ?? false;
  const canSubmit =
    !generating &&
    Boolean(selectedModel?.available) &&
    aiConfigured &&
    prompt.trim().length >= 3;

  async function continueWithResult() {
    if (!resultImage) return;
    const response = await fetch(resultImage);
    if (!response.ok) throw new Error('无法读取生成的图片');
    const blob = await response.blob();
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const file = new File([blob], `ai-result.${extension}`, { type: blob.type || 'image/png' });
    await onUseFile(file);
  }

  if (loading) return <div className="page-loading">正在加载…</div>;
  if (!aiConfigured) {
    return (
      <div className="notice notice-warn" data-testid="ai-unconfigured">
        <AlertIcon size={18} />
        <div>
          <strong>AI 出图暂未开放</strong>
          <p>请稍后再试或联系空间管理员。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-image-studio" data-testid="ai-image-studio">
      {dashboard ? (
        <section className="ai-metrics">
          <div><span>可用额度</span><strong>{formatMoney(dashboard.wallet.availableCents)}</strong></div>
          <div><span>占用中</span><strong>{formatMoney(dashboard.wallet.reservedCents)}</strong></div>
          <div><span>本月用量</span><strong>{formatMoney(dashboard.usage.userMonthSpentCents)}</strong></div>
          <div><span>我的上限</span><strong>{formatMoney(dashboard.membership.userBudgetCents)}</strong></div>
        </section>
      ) : null}

      {error ? <div className="notice notice-error" role="alert">{error}</div> : null}

      <div className="ai-layout">
        <section className="panel ai-compose">
          <div className="panel-head">
            <h2>图像生成</h2>
            <span className="muted">按张消耗额度</span>
          </div>

          <div className="model-list" role="radiogroup" aria-label="选择模型">
            {models.length === 0 ? (
              <p className="empty-text">该功能暂未开放。</p>
            ) : models.map((model) => (
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
                  <small>{model.available ? `${formatMoney(model.unitPriceCents)} / 张` : '暂不可用'}</small>
                </span>
              </button>
            ))}
          </div>

          <label className="field">
            <span>画面描述</span>
            <textarea
              rows={5}
              value={prompt}
              maxLength={selectedModel?.maxPromptChars ?? 1000}
              onChange={(event) => editPrompt(event.target.value)}
              placeholder="例如：一张有纸张纹理的极简杂志封面"
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
              <input type="number" min={1} max={selectedModel?.maxImages ?? 1} value={count}
                onChange={(event) => {
                  const next = Math.max(1, Math.min(selectedModel?.maxImages ?? 1, Number(event.target.value) || 1));
                  setCount(next);
                  setRequestId(newRequestId());
                }} />
            </label>
          </div>

          <div className="cost-preview">
            <span>本次消耗</span>
            <strong>{selectedModel ? formatMoney(selectedModel.unitPriceCents * count) : '—'}</strong>
            <small>生成成功后扣除额度。</small>
          </div>

          <button type="button" className="button button-accent button-large"
            disabled={!canSubmit} onClick={() => void generate()} data-testid="ai-generate">
            {generating ? <><span className="spinner" /> 生成中…</> : <><SparklesIcon size={18} /> 生成图像</>}
          </button>
        </section>

        <aside className="ai-image-side">
          <section className="panel ai-result-panel" data-testid="ai-result-panel">
            <div className="panel-head"><h2>生成结果</h2><span className="muted">{activeJob ? jobStatusLabel(activeJob.status) : '等待生成'}</span></div>
            {!activeJob ? (
              <div className="result-placeholder"><SparklesIcon size={32} /><p>生成结果会出现在这里。</p></div>
            ) : activeJob.status === 'succeeded' && resultImage ? (
              <div className="ai-image-result" data-testid="ai-result-image">
                <img src={resultImage} alt={activeJob.prompt || 'AI 生成结果'} />
                <div className="ai-result-meta">
                  <span>AI 图片</span>
                  <strong>{formatMoney(activeJob.settledCents)}</strong>
                </div>
                {activeJob.result?.images?.[0]?.dataUrl ? (
                  <button type="button" className="button button-accent" data-testid="ai-download"
                    onClick={() => {
                      const mime = activeJob.result?.images?.[0]?.mimeType || 'image/png';
                      downloadDataUrl(resultImage, `paperlab-${activeJob.id.slice(0, 8)}.${mime.split('/')[1] || 'png'}`);
                    }}>
                    <DownloadIcon size={17} /> 下载图片
                  </button>
                ) : <a href={resultImage} target="_blank" rel="noreferrer" className="button button-accent">打开图片</a>}
                <button type="button" className="button button-ghost" onClick={() => void continueWithResult().catch((reason) => setError(userError(reason, '无法读取结果')))}>
                  <PlusIcon size={16} /> 继续本地编辑
                </button>
              </div>
            ) : activeJob.status === 'pending_reconciliation' ? (
              <div className="result-placeholder pending"><AlertIcon size={30} /><strong>结果确认中</strong><p>额度会暂时保留，确认后自动完成。</p></div>
            ) : activeJob.status === 'failed' ? (
              <div className="result-placeholder failed"><AlertIcon size={30} /><strong>本次未产生费用</strong><p>可以修改描述后重试。</p></div>
            ) : (
              <div className="result-placeholder"><AlertIcon size={30} /><strong>生成中</strong><p>刷新页面或稍后查看记录。</p></div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>使用说明</h2></div>
            <ul className="check-list">
              <li>生成会消耗额度</li>
              <li>未成功不会扣费</li>
              <li>结果可继续用本地工具处理</li>
            </ul>
            <Link to="/account" className="text-link">查看额度记录 →</Link>
          </section>
        </aside>
      </div>

      <section className="panel ai-history">
        <div className="panel-head"><h2>生成记录</h2><button type="button" className="text-button" onClick={() => void loadData()}>刷新</button></div>
        {jobs.length === 0 ? <p className="empty-text">还没有生成记录。</p> : (
          <div className="table-wrap">
            <table className="data-table" data-testid="ai-history">
              <thead><tr><th>时间</th><th>画面描述</th><th>状态</th><th>消耗</th></tr></thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>{formatDate(job.createdAt)}</td>
                    <td className="truncate">{job.prompt || '—'}</td>
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
