import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import { useToast } from '../components/Toast';
import { FileDrop } from '../components/FileDrop';
import { PdfPreview } from '../components/PdfPreview';
import { BeforeAfter } from '../features/tools/image/BeforeAfter';
import { useObjectUrl } from '../features/tools/image/useObjectUrl';
import { downloadFile } from '../lib/download';
import { formatBytes } from '../lib/format';
import {
  DownloadIcon,
  FileIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
} from '../components/Icons';
import type {
  AssistantPlan,
  ExecuteResult,
  PlanOutcome,
  StepExecution,
  WorkspaceFileMeta,
} from '../features/assistant/types';
import { parseLocalIntent } from '../features/assistant/parseLocalIntent';
import {
  PlanValidationError,
  executePlan,
  validatePlan,
} from '../features/assistant/planExecutor';
import { describeStep, planStepTitle, planWarnings } from '../features/assistant/planDisplay';
import { FileRegistry } from '../features/workspace/fileRegistry';
import { describeFile, plannerMetadata } from '../features/workspace/inspect';
import {
  popCheckpoint,
  pushCheckpoint,
  type WorkspaceCheckpoint,
} from '../features/workspace/history';
import {
  clearDrafts,
  deleteDraft,
  listDrafts,
  loadDraftFiles,
  saveDraft,
  storageSupported,
  type DraftRecord,
} from '../features/workspace/storage';
import { ImageStudioPanel } from './ImageStudioPanel';

type Mode = 'files' | 'image';
type Stage =
  | 'empty'
  | 'file_ready'
  | 'classifying'
  | 'needs_clarification'
  | 'plan_ready'
  | 'executing'
  | 'preview_ready'
  | 'saved'
  | 'failed'
  | 'quota_blocked';

interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  kind?: 'plan' | 'result' | 'error';
  plan?: AssistantPlan;
  manualPath?: string;
}

const STAGE_LABELS: Record<Stage, string> = {
  empty: '等待文件',
  file_ready: '文件已就绪',
  classifying: '正在理解指令',
  needs_clarification: '需要补充说明',
  plan_ready: '计划待确认',
  executing: '执行中',
  preview_ready: '结果可预览',
  saved: '草稿已保存',
  failed: '执行未完成',
  quota_blocked: '云端额度受限',
};

function id(): string {
  return crypto.randomUUID();
}

function modeFromSearch(value: string | null): Mode {
  return value === 'image' ? 'image' : 'files';
}

export function AiPage({ initialMode = 'files' }: { initialMode?: Mode }) {
  const { status, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { push } = useToast();
  const memberships = useMemo(() => session?.memberships ?? [], [session]);
  const [mode, setMode] = useState<Mode>(() => (
    initialMode === 'image' ? 'image' : modeFromSearch(searchParams.get('mode'))
  ));
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [metas, setMetas] = useState<WorkspaceFileMeta[]>([]);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<Stage>('empty');
  const [activePlan, setActivePlan] = useState<AssistantPlan | null>(null);
  const [planSteps, setPlanSteps] = useState<StepExecution[]>([]);
  const [planState, setPlanState] = useState<'idle' | 'executing' | 'done' | 'failed'>('idle');
  const [checkpoints, setCheckpoints] = useState<WorkspaceCheckpoint[]>([]);
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [draftBusy, setDraftBusy] = useState(false);
  const registryRef = useRef(new FileRegistry());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const selectedMembership = memberships.find((item) => item.tenantId === selectedTenantId) ?? null;
  const ownerKey = session?.user.id || 'anonymous';
  const tenantKey = selectedMembership?.slug || 'public';
  const plannerConfigured = Boolean(session?.config.planner.configured);

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
  }, [status, memberships, searchParams]);

  useEffect(() => {
    setMode(initialMode === 'image' ? 'image' : modeFromSearch(searchParams.get('mode')));
  }, [initialMode, searchParams]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, activePlan]);

  const loadDraftList = useCallback(async () => {
    try {
      setDrafts(await listDrafts(ownerKey, tenantKey));
    } catch {
      setDrafts([]);
    }
  }, [ownerKey, tenantKey]);

  useEffect(() => {
    void loadDraftList();
  }, [loadDraftList]);

  function addMessage(item: Omit<ChatItem, 'id'>) {
    setMessages((current) => [...current, { ...item, id: id() }]);
  }

  function changeMode(next: Mode) {
    setMode(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'image') params.set('mode', 'image');
    else params.delete('mode');
    setSearchParams(params, { replace: true });
  }

  function chooseTenant(nextTenantId: string) {
    setSelectedTenantId(nextTenantId);
    const membership = memberships.find((item) => item.tenantId === nextTenantId);
    const params = new URLSearchParams(searchParams);
    if (membership) params.set('tenant', membership.slug);
    setSearchParams(params, { replace: true });
  }

  async function handleFiles(nextFiles: File[]) {
    if (nextFiles.length > 4) {
      setError('一次最多选择 4 个文件');
      return;
    }
    if (nextFiles.length === 0) {
      setFiles([]);
      setMetas([]);
      setStage('empty');
      setError('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextMetas: WorkspaceFileMeta[] = [];
      for (const file of nextFiles) {
        nextMetas.push(await registryRef.current.add(file, 'upload'));
      }
      const firstLoad = metas.length === 0;
      setFiles(nextFiles);
      setMetas(nextMetas);
      if (!originalFile && nextFiles[0]) setOriginalFile(nextFiles[0]);
      setStage('file_ready');
      setActivePlan(null);
      setPlanState('idle');
      if (firstLoad) {
        addMessage({
          role: 'assistant',
          text: `已读取 ${nextMetas.length} 个文件。${nextMetas.map((meta) => `${meta.name}（${describeFile(meta)}）`).join('；')}。直接输入中文指令即可。`,
        });
      }
    } catch (inspectError) {
      setError(inspectError instanceof Error ? inspectError.message : '无法读取文件');
      setStage('failed');
    } finally {
      setBusy(false);
    }
  }

  function showPlan(outcome: PlanOutcome) {
    if (outcome.kind !== 'plan') {
      addMessage({
        role: 'assistant',
        text: outcome.message,
        ...(outcome.kind === 'needs_clarification' && outcome.manualPath
          ? { manualPath: outcome.manualPath }
          : {}),
      });
      setStage(outcome.kind === 'needs_clarification' ? 'needs_clarification' : 'failed');
      return;
    }
    try {
      const validated = validatePlan(outcome, metas);
      setActivePlan(validated.plan);
      setPlanSteps(validated.plan.steps.map((step) => ({
        toolKey: step.toolKey,
        title: planStepTitle(step),
        status: 'pending',
        outputFileIds: [],
      })));
      setPlanState('idle');
      setStage('plan_ready');
      addMessage({
        role: 'assistant',
        text: validated.plan.message || (validated.plan.source === 'cloud'
          ? '复杂指令已解析为计划。确认后仍在本机执行。'
          : '已生成操作计划。确认后在本机执行。'),
        kind: 'plan',
        plan: validated.plan,
      });
    } catch (validationError) {
      if (validationError instanceof PlanValidationError) {
        addMessage({
          role: 'assistant',
          text: validationError.message,
          ...(validationError.manualPath ? { manualPath: validationError.manualPath } : {}),
        });
        setStage('needs_clarification');
      } else {
        setError(validationError instanceof Error ? validationError.message : '计划无效');
        setStage('failed');
      }
    }
  }

  async function requestCloudPlan(text: string) {
    if (!selectedMembership) {
      addMessage({ role: 'assistant', text: '复杂指令需要登录并选择空间；基础本地指令仍可直接使用。' });
      setStage('needs_clarification');
      return;
    }
    if (!plannerConfigured) {
      addMessage({ role: 'assistant', text: '复杂指令规划暂未配置，基础本地指令仍可使用。' });
      setStage('needs_clarification');
      return;
    }
    setBusy(true);
    setStage('classifying');
    try {
      const outcome = await callPlatformApi<PlanOutcome>('ai.plan', {
        tenantId: selectedTenantId,
        requestId: id(),
        prompt: text,
        files: metas.map(plannerMetadata),
      });
      showPlan(outcome);
    } catch (cloudError) {
      const message = cloudError instanceof Error ? cloudError.message : '复杂指令暂时无法解析';
      addMessage({ role: 'assistant', text: `${message} 基础本地指令仍可使用。` });
      setStage(/额度|quota|limit/i.test(message) ? 'quota_blocked' : 'failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitCommand() {
    const text = input.trim();
    if (!text) return;
    if (metas.length === 0) {
      setError('请先上传 PDF 或图片');
      return;
    }
    setInput('');
    setActivePlan(null);
    setPlanState('idle');
    setError('');
    addMessage({ role: 'user', text });
    const local = parseLocalIntent(text, metas);
    if (local.kind === 'plan') {
      showPlan(local);
      return;
    }
    if (local.kind === 'needs_clarification' && local.manualPath) {
      showPlan(local);
      return;
    }
    if (plannerConfigured && selectedMembership) {
      await requestCloudPlan(text);
    } else {
      showPlan(local);
    }
  }

  async function runPlan() {
    if (!activePlan) return;
    setPlanState('executing');
    setStage('executing');
    setBusy(true);
    const checkpoint = pushCheckpoint(
      checkpoints,
      activePlan.reason,
      files,
      metas,
    );
    setCheckpoints(checkpoint);
    try {
      const result: ExecuteResult = await executePlan(activePlan, registryRef.current, {
        onStep: (step) => {
          setPlanSteps((current) => current.map((item) => (
            item.toolKey === step.toolKey ? { ...step } : item
          )));
        },
      });
      setFiles(result.files);
      setMetas(result.metas);
      setStage('preview_ready');
      setPlanState('done');
      addMessage({
        role: 'assistant',
        text: `已在本机完成 ${result.files.length} 个结果文件。可以继续输入指令，或下载当前结果。`,
        kind: 'result',
      });
    } catch (planError) {
      setCheckpoints((current) => current.slice(0, -1));
      setPlanState('failed');
      setStage('failed');
      setError(planError instanceof Error ? planError.message : '执行失败');
    } finally {
      setBusy(false);
    }
  }

  function cancelPlan() {
    setActivePlan(null);
    setPlanState('idle');
    setPlanSteps([]);
    setStage('file_ready');
    addMessage({ role: 'assistant', text: '已取消计划，原文件没有变化。' });
  }

  function undo() {
    const popped = popCheckpoint(checkpoints);
    if (!popped) return;
    setCheckpoints(popped.rest);
    setFiles(popped.checkpoint.files);
    setMetas(popped.checkpoint.metas);
    setActivePlan(null);
    setPlanState('idle');
    setPlanSteps([]);
    setStage('file_ready');
    addMessage({ role: 'assistant', text: '已撤销到上一个检查点。原文件仍然保留。' });
  }

  async function saveLocalDraft() {
    if (files.length === 0) {
      setError('请先添加文件');
      return;
    }
    setDraftBusy(true);
    setError('');
    try {
      const record = await saveDraft({
        ownerKey,
        tenantKey,
        title: files[0]?.name || '文件工作台草稿',
        stage,
        messages,
        files,
        metas,
        draftId,
      });
      setDraftId(record.id);
      setStage('saved');
      push('草稿已保存到本机', 'success');
      await loadDraftList();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '无法保存草稿');
    } finally {
      setDraftBusy(false);
    }
  }

  async function restoreDraft(record: DraftRecord) {
    setDraftBusy(true);
    setError('');
    try {
      const restoredFiles = await loadDraftFiles(record);
      const restoredMetas: WorkspaceFileMeta[] = [];
      for (const file of restoredFiles) restoredMetas.push(await registryRef.current.add(file, 'upload'));
      setFiles(restoredFiles);
      setMetas(restoredMetas);
      setOriginalFile(restoredFiles[0] ?? null);
      setMessages(Array.isArray(record.messages) ? record.messages as ChatItem[] : []);
      setDraftId(record.id);
      setActivePlan(null);
      setPlanState('idle');
      setStage(record.stage as Stage);
      addMessage({ role: 'assistant', text: '已从本机恢复草稿。' });
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : '无法恢复草稿');
    } finally {
      setDraftBusy(false);
    }
  }

  async function clearLocalDrafts() {
    setDraftBusy(true);
    try {
      await clearDrafts(ownerKey, tenantKey);
      setDrafts([]);
      setDraftId(undefined);
      push('本机草稿已清空', 'success');
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '无法清空草稿');
    } finally {
      setDraftBusy(false);
    }
  }

  async function removeDraft(record: DraftRecord) {
    await deleteDraft(record);
    await loadDraftList();
  }

  async function useGeneratedFile(file: File) {
    const meta = await registryRef.current.add(file, 'upload');
    setFiles([file]);
    setMetas([meta]);
    setOriginalFile(file);
    setStage('file_ready');
    addMessage({ role: 'assistant', text: '生成图片已加入文件工作台，可以继续用本地工具处理。' });
    changeMode('files');
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitCommand();
    }
  }

  if (mode === 'image') {
    if (status === 'loading') return <div className="page-loading">正在加载…</div>;
    if (status !== 'authenticated' || !session) {
      return (
        <div className="empty-page">
          <SparklesIcon size={44} />
          <h1>登录后使用 AI 出图</h1>
          <p>PDF 和图片工具无需登录。</p>
          <Link to="/login?next=/ai/image" className="button button-accent">登录</Link>
        </div>
      );
    }
    return (
      <div className="ai-workspace" data-testid="ai-workspace">
        <header className="ai-workspace-head">
          <div>
            <h1>AI 出图</h1>
            <p>描述画面，生成后可以继续用本地工具处理。</p>
          </div>
          <div className="ai-head-actions">
            <ModeTabs mode={mode} onChange={changeMode} />
            <TenantSelect memberships={memberships} value={selectedTenantId} onChange={chooseTenant} />
          </div>
        </header>
        {memberships.length === 0 ? (
          <div className="empty-page"><h1>还没有空间</h1><p>请联系空间管理员邀请你加入。</p><Link to="/account" className="button button-ghost">查看账户</Link></div>
        ) : selectedTenantId ? (
          <ImageStudioPanel tenantId={selectedTenantId} onUseFile={useGeneratedFile} />
        ) : <div className="page-loading">正在读取空间…</div>}
      </div>
    );
  }

  return (
    <div className="ai-workspace" data-testid="ai-workspace">
      <header className="ai-workspace-head">
        <div>
          <h1>文件工作台</h1>
          <p>上传 PDF 或图片，用中文描述要做什么。</p>
        </div>
        <div className="ai-head-actions">
          <ModeTabs mode={mode} onChange={changeMode} />
          {memberships.length > 0 ? (
            <TenantSelect memberships={memberships} value={selectedTenantId} onChange={chooseTenant} />
          ) : null}
          <span className={`stage-pill stage-${stage}`} data-testid="ai-stage">{STAGE_LABELS[stage]}</span>
        </div>
      </header>

      <div className="ai-workspace-grid">
        <section className="ai-chat-panel">
          <div className="ai-chat-scroll">
            <FileDrop
              accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
              multiple
              files={files}
              onChange={(next) => void handleFiles(next)}
              title="拖入 PDF 或图片"
              testId="ai-drop"
            />

            {drafts.length > 0 ? (
              <div className="workspace-drafts" data-testid="ai-draft-list">
                <div className="workspace-section-head"><strong>本机草稿</strong><button type="button" className="text-button" onClick={() => void clearLocalDrafts()} disabled={draftBusy} data-testid="ai-clear-drafts">清空</button></div>
                {drafts.map((draft) => (
                  <div className="workspace-draft-row" key={draft.id}>
                    <button type="button" className="workspace-draft-main" onClick={() => void restoreDraft(draft)} data-testid="ai-restore-draft">
                      <span>{draft.title}</span>
                      <small>{new Date(draft.updatedAt).toLocaleString('zh-CN')}</small>
                    </button>
                    <button type="button" className="icon-button" aria-label="删除草稿" onClick={() => void removeDraft(draft)}><TrashIcon size={14} /></button>
                  </div>
                ))}
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="workspace-welcome">
                <SparklesIcon size={28} />
                <h2>说一句，文件就位</h2>
                <p>例如“删除第 2 页，再旋转剩余页面 90 度”，或者“给这张图片加右下角水印后压缩”。</p>
                <div className="suggestion-row">
                  {['删除第 2 页并旋转 90°', '提取 PDF 文字', '压缩图片', '转成 PNG'].map((suggestion) => (
                    <button key={suggestion} type="button" className="suggestion-chip" onClick={() => setInput(suggestion)}>{suggestion}</button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="chat-messages">
              {messages.map((message) => (
                <div key={message.id} className={`chat-message ${message.role}`}>
                  <div className={`chat-bubble ${message.kind ?? ''}`}>
                    <p>{message.text}</p>
                    {message.kind === 'plan' && message.plan ? (
                      <PlanCard
                        plan={message.plan}
                        fileNames={metas.filter((meta) => message.plan?.fileIds.includes(meta.fileId)).map((meta) => meta.name)}
                        steps={activePlan === message.plan ? planSteps : []}
                        state={activePlan === message.plan ? planState : 'idle'}
                        interactive={activePlan === message.plan}
                        onExecute={() => void runPlan()}
                        onCancel={cancelPlan}
                      />
                    ) : null}
                    {message.manualPath ? (
                      <Link className="text-link" to={message.manualPath}>打开手动工具 →</Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div ref={chatEndRef} />
          </div>

          <div className="ai-composer">
            <textarea
              rows={2}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={metas.length ? '例如：删除第 2 页，再旋转剩余页面 90 度' : '先添加文件，再输入中文指令'}
              data-testid="ai-command"
              disabled={busy || metas.length === 0}
            />
            <div className="ai-composer-actions">
              <span className="ai-composer-hint">{plannerConfigured && selectedMembership ? '复杂指令会发送指令和文件信息到云端规划。' : ''}</span>
              <button type="button" className="button button-accent" onClick={() => void submitCommand()} disabled={busy || !input.trim() || metas.length === 0} data-testid="ai-command-send">
                <SparklesIcon size={16} /> 解析指令
              </button>
            </div>
          </div>
        </section>

        <section className="ai-preview-panel" data-testid="ai-preview">
          <WorkspacePreview
            files={files}
            metas={metas}
            originalFile={originalFile}
            showCompare={planState === 'done' || stage === 'preview_ready'}
            onDownload={(file) => downloadFile(file)}
            onClear={() => {
              setFiles([]);
              setMetas([]);
              setOriginalFile(null);
              setStage('empty');
              setActivePlan(null);
              setMessages([]);
              setCheckpoints([]);
            }}
          />
          <div className="workspace-actions">
            <button type="button" className="button button-ghost" onClick={undo} disabled={checkpoints.length === 0 || busy} data-testid="ai-undo">
              <RefreshIcon size={15} /> 撤销
            </button>
            <button type="button" className="button button-ghost" onClick={() => void saveLocalDraft()} disabled={files.length === 0 || draftBusy || !storageSupported()} data-testid="ai-save-draft">
              保存到本机
            </button>
            {drafts.length > 0 ? <span className="muted">{drafts.length} 个本机草稿</span> : null}
          </div>
          {!storageSupported() ? <p className="fine-print">当前浏览器不支持本机草稿；请及时下载结果。</p> : null}
          {error ? <div className="notice notice-error" role="alert" data-testid="ai-workspace-error">{error}</div> : null}
        </section>
      </div>
    </div>
  );
}

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label="AI 工作区模式">
      <button type="button" role="tab" aria-selected={mode === 'files'} className={mode === 'files' ? 'active' : ''} onClick={() => onChange('files')} data-testid="ai-mode-files">文件工作台</button>
      <button type="button" role="tab" aria-selected={mode === 'image'} className={mode === 'image' ? 'active' : ''} onClick={() => onChange('image')} data-testid="ai-mode-image">生成图片</button>
    </div>
  );
}

function TenantSelect({ memberships, value, onChange }: {
  memberships: Array<{ tenantId: string; tenantName: string }>;
  value: string;
  onChange: (tenantId: string) => void;
}) {
  if (memberships.length === 0) return null;
  return (
    <label className="tenant-select">
      <span>当前空间</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} data-testid="ai-tenant-select">
        {memberships.map((membership) => (
          <option key={membership.tenantId} value={membership.tenantId}>{membership.tenantName}</option>
        ))}
      </select>
    </label>
  );
}

function PlanCard({
  plan,
  fileNames,
  steps,
  state,
  interactive,
  onExecute,
  onCancel,
}: {
  plan: AssistantPlan;
  fileNames: string[];
  steps: StepExecution[];
  state: 'idle' | 'executing' | 'done' | 'failed';
  interactive: boolean;
  onExecute: () => void;
  onCancel: () => void;
}) {
  const warnings = planWarnings(plan);
  const done = state === 'done';
  const failed = state === 'failed';
  return (
    <div className="plan-card" data-testid="ai-plan-card">
      <div className="plan-card-head">
        <div>
          <span className="plan-kicker">{plan.source === 'cloud' ? '云端规划' : '本机计划'}</span>
          <strong>{plan.reason}</strong>
          <small className="plan-target">目标：{fileNames.join('、') || '当前文件'}</small>
        </div>
        <span className="plan-cost">¥0.00</span>
      </div>
      <ol className="plan-steps">
        {plan.steps.map((step, index) => {
          const status = steps[index]?.status ?? 'pending';
          return (
            <li key={`${step.toolKey}-${index}`} className={`plan-step ${status}`}>
              <span className="plan-step-index">{index + 1}</span>
              <div><strong>{planStepTitle(step)}</strong><small>{describeStep(step)}</small></div>
              <span className="plan-step-status">{status === 'succeeded' ? '完成' : status === 'running' ? '执行中' : status === 'failed' ? '失败' : '待执行'}</span>
            </li>
          );
        })}
      </ol>
      {warnings.length ? <ul className="plan-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      <div className="plan-actions">
        {!interactive ? <span className="muted">历史计划</span> : done ? <span className="success-badge">已执行</span> : failed ? <span className="status-pill failed">未完成</span> : (
          <>
            <button type="button" className="button button-accent" onClick={onExecute} disabled={state === 'executing'} data-testid="ai-plan-execute">
              {state === 'executing' ? '执行中…' : '执行计划'}
            </button>
            <button type="button" className="button button-ghost" onClick={onCancel} disabled={state === 'executing'} data-testid="ai-plan-cancel">取消</button>
          </>
        )}
      </div>
    </div>
  );
}

function WorkspacePreview({
  files,
  metas,
  originalFile,
  showCompare,
  onDownload,
  onClear,
}: {
  files: File[];
  metas: WorkspaceFileMeta[];
  originalFile: File | null;
  showCompare: boolean;
  onDownload: (file: File) => void;
  onClear: () => void;
}) {
  const first = files[0] ?? null;
  const imageUrl = useObjectUrl(first?.type.startsWith('image/') ? first : null);
  const [pdfSide, setPdfSide] = useState<'result' | 'original'>('result');

  useEffect(() => setPdfSide('result'), [files]);

  if (files.length === 0) {
    return (
      <div className="preview-empty">
        <FileIcon size={34} />
        <h2>预览会出现在这里</h2>
        <p>上传文件后显示页数或图片尺寸；执行计划后显示结果。原文件始终保留。</p>
      </div>
    );
  }

  if (files.length > 1) {
    return (
      <div className="preview-multi">
        <div className="preview-head"><h2>当前结果 · {files.length} 个文件</h2><button type="button" className="text-button" onClick={onClear}>清空</button></div>
        <div className="preview-file-grid">
          {files.map((file, index) => (
            <div className="preview-file-card" key={`${file.name}-${index}`}>
              <span className="file-kind">{metas[index]?.kind === 'pdf' ? 'PDF' : 'IMG'}</span>
              <strong>{file.name}</strong>
              <small>{formatBytes(file.size)}</small>
              <button type="button" className="button button-ghost button-small" onClick={() => onDownload(file)} data-testid="ai-file-download">
                <DownloadIcon size={14} /> 下载
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const meta = metas[0];
  const canCompareImage = showCompare && originalFile && first?.type.startsWith('image/') && originalFile !== first;
  return (
    <div className="preview-single">
      <div className="preview-head">
        <div>
          <h2>当前结果</h2>
          <p>{meta ? describeFile(meta) : ''} · {formatBytes(first?.size ?? 0)}</p>
        </div>
        <div className="preview-head-actions">
          <button type="button" className="button button-ghost button-small" onClick={() => onDownload(first)} data-testid="ai-file-download"><DownloadIcon size={14} /> 下载</button>
          <button type="button" className="text-button" onClick={onClear}>清空</button>
        </div>
      </div>
      {first?.type === 'application/pdf' || /\.pdf$/i.test(first?.name ?? '') ? (
        <>
          {showCompare && originalFile ? (
            <div className="preview-side-switch">
              <button type="button" className={pdfSide === 'result' ? 'active' : ''} onClick={() => setPdfSide('result')}>结果</button>
              <button type="button" className={pdfSide === 'original' ? 'active' : ''} onClick={() => setPdfSide('original')}>原文件</button>
            </div>
          ) : null}
          <PdfPreview file={pdfSide === 'original' && originalFile ? originalFile : first} />
        </>
      ) : first?.type.startsWith('image/') && imageUrl ? (
        canCompareImage && originalFile ? (
          <BeforeAfter before={originalFile} after={first} beforeLabel="原图" afterLabel="当前结果" />
        ) : (
          <div className="workspace-image-preview"><img src={imageUrl} alt="当前图片结果" /></div>
        )
      ) : (
        <div className="workspace-text-preview"><FileIcon size={26} /><p>{first?.name}</p><small>{formatBytes(first?.size ?? 0)}</small></div>
      )}
    </div>
  );
}
