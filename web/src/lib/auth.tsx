import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ApiError,
  callPlatformApi,
  clearE2EToken,
  e2eLogin,
  getCloudBaseAuth,
  getE2EToken,
  runtime,
} from './api';
import type { Bootstrap } from './types';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'unconfigured' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  session: Bootstrap | null;
  error: string | null;
  configMissing: boolean;
  login: (email: string, password: string) => Promise<void>;
  beginSignup: (email: string, password: string) => Promise<{ verificationRequired: boolean }>;
  completeSignup: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return '操作失败，请稍后重试';
}

function authError(error: unknown): Error {
  const message = messageOf(error);
  if (message.includes('password')) return new Error('邮箱或密码不正确');
  return new Error(message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pendingVerify = useRef<((params: { token: string }) => Promise<unknown>) | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadBootstrap = useCallback(async (withLoading = false) => {
    if (withLoading) setStatus('loading');
    try {
      const data = await callPlatformApi<Bootstrap>('session.bootstrap');
      if (!mounted.current) return;
      setSession(data);
      setStatus('authenticated');
      setError(null);
    } catch (loadError) {
      if (!mounted.current) return;
      if (loadError instanceof ApiError && loadError.code === 'unauthenticated') {
        clearE2EToken();
        setSession(null);
        setStatus('anonymous');
        return;
      }
      setError(messageOf(loadError));
      setStatus('error');
    }
  }, []);

  const refresh = useCallback(async () => {
    if (runtime.e2eMode) {
      if (!getE2EToken()) {
        setSession(null);
        setStatus('anonymous');
        return;
      }
      await loadBootstrap();
      return;
    }
    if (!runtime.cloudbaseConfigured) {
      setStatus('unconfigured');
      return;
    }
    await loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (runtime.e2eMode) {
        if (!getE2EToken()) {
          if (!cancelled) setStatus('anonymous');
          return;
        }
        if (!cancelled) await loadBootstrap();
        return;
      }
      if (!runtime.cloudbaseConfigured) {
        if (!cancelled) setStatus('unconfigured');
        return;
      }
      try {
        const { data, error: sessionError } = await getCloudBaseAuth().getSession();
        if (sessionError || !data?.session) {
          if (!cancelled) setStatus('anonymous');
          return;
        }
        if (!cancelled) await loadBootstrap();
      } catch (initError) {
        if (!cancelled) {
          setError(messageOf(initError));
          setStatus('error');
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [loadBootstrap]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      if (runtime.e2eMode) {
        await e2eLogin(email, password);
        await loadBootstrap(true);
        return;
      }
      if (!runtime.cloudbaseConfigured) {
        throw new Error('CloudBase 尚未配置，无法登录');
      }
      try {
        const { error: signInError } = await getCloudBaseAuth().signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        await loadBootstrap(true);
      } catch (loginError) {
        throw authError(loginError);
      }
    },
    [loadBootstrap],
  );

  const beginSignup = useCallback(
    async (email: string, password: string) => {
      if (runtime.e2eMode) {
        throw new Error('E2E 模式不开放注册，请使用测试账号');
      }
      if (!runtime.cloudbaseConfigured) {
        throw new Error('CloudBase 尚未配置，无法注册');
      }
      try {
        const { data, error: signUpError } = await getCloudBaseAuth().signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        if (data?.session) {
          await loadBootstrap(true);
          return { verificationRequired: false };
        }
        if (data?.verifyOtp) {
          pendingVerify.current = data.verifyOtp;
          return { verificationRequired: true };
        }
        throw new Error('注册流程未返回验证步骤，请确认已启用邮箱验证码登录');
      } catch (signUpError) {
        throw authError(signUpError);
      }
    },
    [loadBootstrap],
  );

  const completeSignup = useCallback(
    async (code: string) => {
      const verify = pendingVerify.current;
      if (!verify) throw new Error('验证码流程已失效，请重新注册');
      try {
        const result = (await verify({ token: code })) as {
          error?: { message?: string };
        };
        if (result?.error) throw result.error;
        pendingVerify.current = null;
        await loadBootstrap(true);
      } catch (verifyError) {
        throw authError(verifyError);
      }
    },
    [loadBootstrap],
  );

  const logout = useCallback(async () => {
    try {
      if (runtime.e2eMode) {
        clearE2EToken();
      } else if (runtime.cloudbaseConfigured) {
        await getCloudBaseAuth().signOut();
      }
    } finally {
      setSession(null);
      setStatus(runtime.e2eMode || runtime.cloudbaseConfigured ? 'anonymous' : 'unconfigured');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      error,
      configMissing: !runtime.e2eMode && !runtime.cloudbaseConfigured,
      login,
      beginSignup,
      completeSignup,
      logout,
      refresh,
    }),
    [status, session, error, login, beginSignup, completeSignup, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
