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

  return (    <div className="auth-page">
      <div className="auth-panel">
        <span className="eyebrow">ACCOUNT</span>
        <h1>{mode === 'otp' ? '输入验证码' : mode === 'register' ? '创建账号' : '登录工作台'}</h1>
        <p className="auth-lede">
          {mode === 'otp'
            ? `验证码已发送到 ${email}。`
            : mode === 'register'
              ? '使用邮箱验证码完成注册。'
              : '登录后可使用 AI 出图与空间功能。'}
        </p>

        {configMissing ? (
          <div className="notice notice-warn">
            <strong>登录暂不可用</strong>
            <p>PDF 和图片工具仍可正常使用。</p>
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
      </div>
      <aside className="auth-side">
        <div className="auth-side-badge"><LockIcon size={18} /> 安全登录</div>
        <h2>你的空间，<br />你的额度。</h2>
        <p>PDF 和图片工具无需登录。登录后可保存 AI 作品、查看剩余额度与管理空间成员。</p>
        <ul>
          <li><SparklesIcon size={16} /> AI 图像生成</li>
          <li><LockIcon size={16} /> 团队空间</li>
          <li><LockIcon size={16} /> 用量记录</li>
        </ul>
        <Link to="/pdf" className="text-link">先使用 PDF / 图片工具 →</Link>
      </aside>
    </div>
  );
}
