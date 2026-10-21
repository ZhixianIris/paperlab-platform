import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { runtime } from '../lib/api';
import { LockIcon, SparklesIcon } from '../components/Icons';

type Mode = 'login' | 'register' | 'otp';

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/account';
  return raw;
}

export function LoginPage() {
  const { status, session, login, beginSignup, completeSignup, configMissing, error: authError } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const nextParam = searchParams.get('next');
  const next = safeNext(nextParam);

  useEffect(() => {
    if (status === 'authenticated' && session) navigate(next, { replace: true });
  }, [status, session, navigate, next]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await login(email.trim(), password);
      navigate(next, { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setPending(false);
    }
  }

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      const result = await beginSignup(email.trim(), password);
      if (result.verificationRequired) {
        setMode('otp');
      } else {
        navigate(next, { replace: true });
      }
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : '注册失败');
    } finally {
      setPending(false);
    }
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setError('');
    setPending(true);
    try {
      await completeSignup(code.trim());
      navigate(next, { replace: true });
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '验证失败');
    } finally {
      setPending(false);
    }
  }

  function fillDemo(kind: 'admin' | 'alice' | 'bob') {
    const accounts = {
      admin: ['admin@paperlab.test', 'Passw0rd!'],
      alice: ['alice@paperlab.test', 'Passw0rd!'],
      bob: ['bob@paperlab.test', 'Passw0rd!'],
    } as const;
    setEmail(accounts[kind][0]);
    setPassword(accounts[kind][1]);
    setError('');
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">ACCOUNT / CLOUDBASE AUTH</span>
        <h1>{mode === 'otp' ? '输入邮箱验证码' : mode === 'register' ? '创建你的账号' : '回到工作台'}</h1>
        <p className="auth-lede">
          {mode === 'otp'
            ? `验证码已发送到 ${email}。验证后即完成注册并登录。`
            : '本地工具无需登录。登录后可进入租户工作台、使用 AI 出图与额度账本。'}
        </p>

        {configMissing ? (
          <div className="notice notice-warn">
            <strong>CloudBase 尚未配置</strong>
            <p>当前构建缺少环境 ID 或 Publishable Key。本地 PDF / 图片工具仍可正常使用；登录与 AI 功能不可用。</p>
          </div>
        ) : null}

        {authError ? <div className="notice notice-error">{authError}</div> : null}

        {mode !== 'otp' ? (
          <form className="auth-form" onSubmit={mode === 'login' ? onLogin : onRegister}>
            <label className="field">
              <span>邮箱</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                data-testid="login-email"
              />
            </label>
            <label className="field">
              <span>密码</span>
              <input
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
                data-testid="login-password"
              />
            </label>
            <button
              type="submit"
              className="button button-accent button-large auth-submit"
              disabled={pending || configMissing || (runtime.e2eMode && mode === 'register')}
              data-testid="login-submit"
            >
              {pending ? '处理中…' : mode === 'login' ? '登录' : '发送邮箱验证码'}
            </button>
            {error ? <p className="form-error" role="alert" data-testid="login-error">{error}</p> : null}
          </form>
        ) : (
          <form className="auth-form" onSubmit={onVerify}>
            <label className="field">
              <span>6 位验证码</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                data-testid="otp-code"
              />
            </label>
            <button type="submit" className="button button-accent button-large" disabled={pending} data-testid="otp-submit">
              {pending ? '验证中…' : '验证并登录'}
            </button>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </form>
        )}

        <div className="auth-switch">
          {mode === 'login' ? (
            <>还没有账号？<button type="button" className="text-button" onClick={() => { setMode('register'); setError(''); }} data-testid="signup-switch">注册</button></>
          ) : mode === 'register' ? (
            <>已有账号？<button type="button" className="text-button" onClick={() => { setMode('login'); setError(''); }}>登录</button></>
          ) : (
            <button type="button" className="text-button" onClick={() => { setMode('login'); setError(''); }}>返回登录</button>
          )}
        </div>

        {runtime.e2eMode ? (
          <div className="demo-accounts">
            <span>E2E 测试账号</span>
            <button type="button" onClick={() => fillDemo('admin')}>管理员</button>
            <button type="button" onClick={() => fillDemo('alice')} data-testid="demo-alice">Alice</button>
            <button type="button" onClick={() => fillDemo('bob')}>Bob</button>
          </div>
        ) : null}
      </div>
      <aside className="auth-side">
        <div className="auth-side-badge"><LockIcon size={18} /> CloudBase 身份认证</div>
        <h2>一个账号，<br />进入多个租户。</h2>
        <p>身份由 CloudBase Auth 托管。平台不存储密码，也不会把第一个注册用户自动变成管理员。</p>
        <ul>
          <li><SparklesIcon size={16} /> AI 请求由服务端认证并计费</li>
          <li><LockIcon size={16} /> 租户隔离：GRANT + RLS</li>
          <li><LockIcon size={16} /> 账本只增不改</li>
        </ul>
        <Link to="/" className="text-link">先使用本地工具 →</Link>
      </aside>
    </div>
  );
}
