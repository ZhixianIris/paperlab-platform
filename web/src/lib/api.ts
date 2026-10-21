import cloudbase from '@cloudbase/js-sdk';

const env = import.meta.env;

export const runtime = {
  cloudbaseEnvId: (env.VITE_CLOUDBASE_ENV_ID ?? '').trim(),
  cloudbaseRegion: (env.VITE_CLOUDBASE_REGION || 'ap-shanghai').trim(),
  publishableKey: (env.VITE_CLOUDBASE_PUBLISHABLE_KEY ?? '').trim(),
  e2eMode: env.VITE_E2E_MODE === '1',
  e2eApiUrl: (env.VITE_E2E_API_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, ''),
  cloudbaseConfigured: false,
};

runtime.cloudbaseConfigured = Boolean(runtime.cloudbaseEnvId && runtime.publishableKey);

export class ApiError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

type CloudBaseApp = ReturnType<typeof cloudbase.init>;
let app: CloudBaseApp | null = null;

function getApp(): CloudBaseApp {
  if (!runtime.cloudbaseConfigured) {
    throw new ApiError('cloudbase_not_configured', 'CloudBase 尚未配置');
  }
  if (!app) {
    app = cloudbase.init({
      env: runtime.cloudbaseEnvId,
      region: runtime.cloudbaseRegion,
      accessKey: runtime.publishableKey,
    });
  }
  return app;
}

export function getCloudBaseAuth() {
  return getApp().auth;
}

interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
  requestId?: string;
}

function parseResult<T>(result: unknown): T {
  let body: unknown = result;
  if (typeof result === 'string') {
    try {
      body = JSON.parse(result);
    } catch {
      throw new ApiError('invalid_response', '服务返回了无法解析的响应');
    }
  }
  if (!body || typeof body !== 'object') {
    throw new ApiError('invalid_response', '服务返回格式异常');
  }
  const envelope = body as Envelope<T>;
  if (!envelope.ok) {
    throw new ApiError(
      envelope.error?.code || 'api_error',
      envelope.error?.message || '请求失败',
    );
  }
  return envelope.data as T;
}

const E2E_TOKEN_KEY = 'paperlab.e2e.token';

export function getE2EToken(): string | null {
  if (!runtime.e2eMode) return null;
  return window.sessionStorage.getItem(E2E_TOKEN_KEY);
}

function setE2EToken(token: string): void {
  window.sessionStorage.setItem(E2E_TOKEN_KEY, token);
}

export function clearE2EToken(): void {
  window.sessionStorage.removeItem(E2E_TOKEN_KEY);
}

export async function callPlatformApi<T>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  if (runtime.e2eMode) {
    const token = getE2EToken();
    let response: Response;
    try {
      response = await fetch(`${runtime.e2eApiUrl}/platform-api`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action, payload }),
      });
    } catch {
      throw new ApiError('network_error', '无法连接本地 E2E 服务');
    }
    const body = (await response.json().catch(() => null)) as Envelope<T> | null;
    if (!body) throw new ApiError('invalid_response', 'E2E 服务响应异常');
    if (!body.ok) {
      throw new ApiError(body.error?.code || 'api_error', body.error?.message || '请求失败');
    }
    return body.data as T;
  }

  const cloudbaseApp = getApp();
  try {
    const response = await cloudbaseApp.callFunction({
      name: 'platform-api',
      data: { action, payload },
    });
    return parseResult<T>(response.result);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : '云函数调用失败';
    throw new ApiError('function_call_failed', message);
  }
}

export interface E2ELoginResult {
  token: string;
  user: { id: string; email: string };
}

export async function e2eLogin(email: string, password: string): Promise<E2ELoginResult> {
  if (!runtime.e2eMode) throw new ApiError('not_e2e', '仅测试环境可用');
  const response = await fetch(`${runtime.e2eApiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json().catch(() => null)) as
    | { ok: boolean; data?: E2ELoginResult; error?: { message?: string } }
    | null;
  if (!response.ok || !body?.ok || !body.data) {
    throw new ApiError('login_failed', body?.error?.message || '邮箱或密码不正确');
  }
  setE2EToken(body.data.token);
  return body.data;
}
