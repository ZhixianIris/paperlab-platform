import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { callPlatformApi } from '../lib/api';
import { useToast } from '../components/Toast';
import { DownloadIcon, FileIcon, RefreshIcon, SparklesIcon, TrashIcon } from '../components/Icons';
import { ChatLayout, WelcomeMessage } from '../features/chat/ChatLayout';
import { ChatComposer, type ComposerFile } from '../features/chat/ChatComposer';
import { FilePreviewDrawer, type PreviewTarget } from '../features/chat/FilePreviewDrawer';
import { formatBytes } from '../lib/format';
import { downloadFile } from '../lib/download';
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
  attachments?: WorkspaceFileMeta[];
  results?: WorkspaceFileMeta[];
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

export function AiPage({ initialMode = 'files' }: { initialMode?: 'files' | 'image' }) {
  const { status, session } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { push } = useToast();
  const memberships = useMemo(() => session?.memberships ?? [], [session]);
  const [imageOpen, setImageOpen] = useState(initialMode === 'image');
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
  const [pending, setPending] = useState<ComposerFile[]>([]);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const registryRef = useRef(new FileRegistry());

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

  function chooseTenant(nextTenantId: string) {
    setSelectedTenantId(nextTenantId);
    const membership = memberships.find((item) => item.tenantId === nextTenantId);
    const params = new URLSearchParams(searchParams);
    if (membership) params.set('tenant', membership.slug);
    setSearchParams(params, { replace: true });
  }

  async function attachFiles(nextFiles: File[]) {
    if (pending.length + nextFiles.length > 4) {
      setError('一次最多选择 4 个文件');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const additions: ComposerFile[] = [];
      for (const file of nextFiles) {
        const meta = await registryRef.current.add(file, 'upload');
        additions.push({ file, meta });
      }
      setPending((current) => {
        const seen = new Set(current.map((item) => item.meta.fileId));
        return [...current, ...additions.filter((item) => !seen.has(item.meta.fileId))];
      });
      setStage('file_ready');
      setActivePlan(null);
      setPlanState('idle');
    } catch (inspectError) {
      setError(inspectError instanceof Error ? inspectError.message : '无法读取文件');
      setStage('failed');
    } finally {
      setBusy(false);
    }
  }

  function removePending(fileId: string) {
    setPending((current) => current.filter((item) => item.meta.fileId !== fileId));
  }

  function showPlan(outcome: PlanOutcome, planMetas: WorkspaceFileMeta[] = metas) {
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
      const validated = validatePlan(outcome, planMetas);
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

  async function requestCloudPlan(text: string, planMetas: WorkspaceFileMeta[]) {
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
        files: planMetas.map(plannerMetadata),
      });
      showPlan(outcome, planMetas);
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
    const attached = pending.map((item) => item.meta);
    const merged = new Map<string, ComposerFile>();
    for (const item of [...files.map((file, index) => ({ file, meta: metas[index] })), ...pending]) {
      if (item.meta) merged.set(item.meta.fileId, item as ComposerFile);
    }
    const sent = [...merged.values()];
    if (sent.length === 0) {
      setError('请先上传 PDF 或图片');
      return;
    }
    const sentMetas = sent.map((item) => item.meta);
    const sentFiles = sent.map((item) => item.file);
    setInput('');
    setPending([]);
    setFiles(sentFiles);
    setMetas(sentMetas);
    if (!originalFile) setOriginalFile(sentFiles[0] ?? null);
    setActivePlan(null);
    setPlanState('idle');
    setError('');
    addMessage({ role: 'user', text, attachments: attached.length ? attached : sentMetas.length === 1 && files.length === 0 ? sentMetas : [] });
    const local = parseLocalIntent(text, sentMetas);
    if (local.kind === 'plan') {
      showPlan(local, sentMetas);
      return;
    }
    if (local.kind === 'needs_clarification' && local.manualPath) {
      showPlan(local, sentMetas);
      return;
    }
    if (plannerConfigured && selectedMembership) {
      await requestCloudPlan(text, sentMetas);
    } else {
      showPlan(local, sentMetas);
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
        text: `已完成 ${result.files.length} 个结果文件。点击文件可预览，或继续输入指令。`,
        kind: 'result',
        results: result.metas,
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
    const draftFiles = files.length ? files : pending.map((item) => item.file);
    const draftMetas = metas.length ? metas : pending.map((item) => item.meta);
    if (draftFiles.length === 0) {
      setError('请先添加文件');
      return;
    }
    setDraftBusy(true);
    setError('');
    try {
      const record = await saveDraft({
        ownerKey,
        tenantKey,
        title: draftFiles[0]?.name || 'PaperLab 草稿',
        stage,
        messages,
        files: draftFiles,
        metas: draftMetas,
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
      setPending([]);
      setPreviewTarget(null);
      setDraftId(record.id);
      setActivePlan(null);
      setPlanState('idle');
      setStage(record.stage as Stage);
      addMessage({ role: 'assistant', text: '已从本机恢复草稿。', attachments: restoredMetas });
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
    setPending([]);
    setImageOpen(false);
    addMessage({ role: 'assistant', text: '图片已生成并加入当前对话，可以继续用本地工具处理。' });
  }

  const chatStarted = messages.length > 0 || files.length > 0 || Boolean(activePlan);
  const currentRepresented = messages.some((message) => (message.attachments?.length ?? 0) > 0 || (message.results?.length ?? 0) > 0);
  const canSend = Boolean(input.trim()) && (pending.length > 0 || files.length > 0);

  function openPreview(meta: WorkspaceFileMeta, compare = false) {
    const file = registryRef.current.get(meta.fileId);
    if (!file) return;
    setPreviewTarget({ file, meta, originalFile, showCompare: compare });
  }

  const composer = (
    <div className="ai-composer-shell">
      {error ? <div className="ai-inline-error" role="alert" data-testid="ai-workspace-error">{error}</div> : null}
      <ChatComposer
        input={input}
        onInput={setInput}
        attachments={pending}
        onFiles={(next) => void attachFiles(next)}
        onRemove={removePending}
        onSend={() => void submitCommand()}
        busy={busy}
        canSend={canSend}
        hint={plannerConfigured && selectedMembership ? '复杂指令会发送指令和文件信息到云端规划。' : undefined}
      />
    </div>
  );

  return (
    <div className={`ai-chat-page ${chatStarted ? 'is-chat' : `is-home${pending.length > 0 ? ' has-pending' : ''}`}`} data-testid="ai-workspace">
      <header className="ai-session-bar">
        <div className="ai-session-left">
          {chatStarted ? (
            <button type="button" className="ai-new-chat" onClick={() => {
              setMessages([]);
              setFiles([]);
              setMetas([]);
              setPending([]);
              setOriginalFile(null);
              setActivePlan(null);
              setPlanSteps([]);
              setPlanState('idle');
              setCheckpoints([]);
              setDraftId(undefined);
              setPreviewTarget(null);
              setStage('empty');
            }} data-testid="ai-new-chat"><TrashIcon size={15} /> 新对话</button>
          ) : null}
          {memberships.length > 0 ? <TenantSelect memberships={memberships} value={selectedTenantId} onChange={chooseTenant} /> : null}
        </div>
        <div className="ai-session-actions">
          <span className={`stage-pill stage-${stage}`} data-testid="ai-stage">{STAGE_LABELS[stage]}</span>
          <button type="button" className="ai-tool-button" onClick={() => setImageOpen(true)} data-testid="ai-mode-image">生成图片</button>
          <button type="button" className="ai-tool-button" onClick={undo} disabled={checkpoints.length === 0 || busy} data-testid="ai-undo"><RefreshIcon size={14} /> 撤销</button>
          <button type="button" className="ai-tool-button" onClick={() => void saveLocalDraft()} disabled={(files.length === 0 && pending.length === 0) || draftBusy || !storageSupported()} data-testid="ai-save-draft">保存草稿</button>
        </div>
      </header>

      {!chatStarted ? (
        <div className="ai-home">
          <WelcomeMessage title="我们从哪里开始？" />
          {composer}
          <div className="ai-suggestions">
            <button type="button" onClick={() => setInput('删除 PDF 第 2 页并旋转 90 度')}>
              <FileIcon size={18} /><span>删除 PDF 第 2 页并旋转</span>
            </button>
            <button type="button" onClick={() => setInput('给图片加水印并压缩')}>
              <SparklesIcon size={18} /><span>给图片加水印并压缩</span>
            </button>
            <button type="button" onClick={() => setImageOpen(true)} data-testid="ai-image-open">
              <SparklesIcon size={18} /><span>生成一张图片</span>
            </button>
          </div>
          {drafts.length > 0 ? <DraftPanel drafts={drafts} busy={draftBusy} onRestore={(draft) => void restoreDraft(draft)} onRemove={(draft) => void removeDraft(draft)} onClear={() => void clearLocalDrafts()} /> : null}
        </div>
      ) : (
        <ChatLayout className="ai-chat-layout" footer={composer}>
          <div className="ai-thread">
            {drafts.length > 0 ? <DraftPanel drafts={drafts} busy={draftBusy} onRestore={(draft) => void restoreDraft(draft)} onRemove={(draft) => void removeDraft(draft)} onClear={() => void clearLocalDrafts()} /> : null}
            {files.length > 0 && !currentRepresented ? (
              <div className="ai-current-files" data-testid="ai-current-files">
                {files.map((file, index) => {
                  const meta = metas[index];
                  return meta ? <ChatFileRow key={meta.fileId} file={file} meta={meta} onPreview={() => openPreview(meta)} onDownload={undefined} /> : null;
                })}
              </div>
            ) : null}
            {messages.map((message) => (
              <div key={message.id} className={`chat-message ${message.role}`}>
                <div className={`chat-bubble ${message.kind ?? ''}`}>
                  <p>{message.text}</p>
                  {message.attachments?.length ? (
                    <div className="chat-file-list">
                      {message.attachments.map((meta) => {
                        const file = registryRef.current.get(meta.fileId);
                        return file ? <ChatFileRow key={meta.fileId} file={file} meta={meta} onPreview={() => openPreview(meta)} onDownload={undefined} /> : null;
                      })}
                    </div>
                  ) : null}
                  {message.kind === 'plan' && message.plan ? (
                    <PlanCard
                      plan={message.plan}
                      fileNames={registryRef.current.getMetas(message.plan.fileIds).map((meta) => meta.name)}
                      steps={activePlan === message.plan ? planSteps : []}
                      state={activePlan === message.plan ? planState : 'idle'}
                      interactive={activePlan === message.plan}
                      onExecute={() => void runPlan()}
                      onCancel={cancelPlan}
                    />
                  ) : null}
                  {message.results?.length ? (
                    <div className="chat-file-list result-list">
                      {message.results.map((meta) => {
                        const file = registryRef.current.get(meta.fileId);
                        return file ? <ChatFileRow key={meta.fileId} file={file} meta={meta} onPreview={() => openPreview(meta, true)} onDownload={() => downloadFile(file)} /> : null;
                      })}
                    </div>
                  ) : null}
                  {message.manualPath ? <Link className="text-link" to={message.manualPath}>打开手动工具 →</Link> : null}
                </div>
              </div>
            ))}
          </div>
        </ChatLayout>
      )}

      <FilePreviewDrawer target={previewTarget} onClose={() => setPreviewTarget(null)} />
      {imageOpen ? (
        <ImageModal
          status={status}
          authenticated={Boolean(session)}
          memberships={memberships}
          selectedTenantId={selectedTenantId}
          onClose={() => setImageOpen(false)}
          onUseFile={useGeneratedFile}
        />
      ) : null}
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


function ChatFileRow({
  file,
  meta,
  onPreview,
  onDownload,
}: {
  file: File;
  meta: WorkspaceFileMeta;
  onPreview: () => void;
  onDownload?: () => void;
}) {
  return (
    <div className="chat-file-row file-row" data-testid="ai-attachment">
      <button type="button" className="chat-file-main" onClick={onPreview}>
        <span className="chat-file-icon">{meta.kind === 'pdf' ? <FileIcon size={18} /> : <SparklesIcon size={18} />}</span>
        <span>
          <strong>{meta.name}</strong>
          <small>{describeFile(meta)} · {formatBytes(file.size)}</small>
        </span>
      </button>
      {onDownload ? (
        <button type="button" className="chat-file-download" aria-label={`下载 ${meta.name}`} onClick={onDownload} data-testid="ai-file-download">
          <DownloadIcon size={16} />
        </button>
      ) : null}
    </div>
  );
}

function DraftPanel({
  drafts,
  busy,
  onRestore,
  onRemove,
  onClear,
}: {
  drafts: DraftRecord[];
  busy: boolean;
  onRestore: (draft: DraftRecord) => void;
  onRemove: (draft: DraftRecord) => void;
  onClear: () => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="workspace-drafts" data-testid="ai-draft-list">
      <div className="workspace-section-head"><strong>本机草稿</strong><button type="button" className="text-button" onClick={onClear} disabled={busy} data-testid="ai-clear-drafts">清空</button></div>
      {drafts.map((draft) => (
        <div className="workspace-draft-row" key={draft.id}>
          <button type="button" className="workspace-draft-main" onClick={() => onRestore(draft)} data-testid="ai-restore-draft">
            <span>{draft.title}</span>
            <small>{new Date(draft.updatedAt).toLocaleString('zh-CN')}</small>
          </button>
          <button type="button" className="icon-button" aria-label="删除草稿" onClick={() => onRemove(draft)}><TrashIcon size={14} /></button>
        </div>
      ))}
    </div>
  );
}

function ImageModal({
  status,
  authenticated,
  memberships,
  selectedTenantId,
  onClose,
  onUseFile,
}: {
  status: string;
  authenticated: boolean;
  memberships: Array<{ tenantId: string; tenantName: string }>;
  selectedTenantId: string;
  onClose: () => void;
  onUseFile: (file: File) => Promise<void>;
}) {
  return (
    <div className="ai-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ai-image-modal" role="dialog" aria-label="生成图片">
        <header className="ai-image-modal-head">
          <h1>AI 出图</h1>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="ai-image-modal-body">
          {status === 'loading' ? <div className="page-loading">正在加载…</div> : !authenticated ? (
            <div className="empty-page"><SparklesIcon size={44} /><h1>登录后使用 AI 出图</h1><p>PDF 和图片工具无需登录。</p><Link to="/login?next=/ai/image" className="button button-accent">登录</Link></div>
          ) : memberships.length === 0 ? (
            <div className="empty-page"><h1>还没有空间</h1><p>请联系空间管理员邀请你加入。</p><Link to="/account" className="button button-ghost">查看账户</Link></div>
          ) : selectedTenantId ? (
            <ImageStudioPanel tenantId={selectedTenantId} onUseFile={onUseFile} />
          ) : <div className="page-loading">正在读取空间…</div>}
        </div>
      </section>
    </div>
  );
}
