import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { runtime } from '../lib/api';
import { FileIcon, ImageIcon, SparklesIcon, UserIcon, ShieldIcon } from './Icons';

export function Layout() {
  const { status, session, configMissing } = useAuth();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand" aria-label="PaperLab 首页">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="brand-name">PaperLab</span>
            <span className="brand-sub">纸研所</span>
          </Link>
          <nav className="main-nav" aria-label="主导航">
            <NavLink to="/pdf/merge" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <FileIcon size={17} /> PDF
            </NavLink>
            <NavLink to="/image/crop" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <ImageIcon size={17} /> 图片
            </NavLink>
            <NavLink to="/ai" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <SparklesIcon size={17} /> AI 创作
            </NavLink>
          </nav>
          <div className="header-actions">
            {status === 'authenticated' && session?.platformAdmin ? (
              <NavLink to="/admin" className="nav-link subtle">
                <ShieldIcon size={16} /> 管理端
              </NavLink>
            ) : null}
            {status === 'authenticated' && session ? (
              <NavLink to="/account" className="account-chip" data-testid="account-link">
                <UserIcon size={16} />
                <span>{session.user.email || '已登录'}</span>
              </NavLink>
            ) : status === 'loading' ? (
              <span className="status-dot muted">载入中…</span>
            ) : (
              <Link className="button button-small button-ink" to="/login" data-testid="login-link">
                登录
              </Link>
            )}
          </div>
        </div>
      </header>

      {!online ? (
        <div className="offline-banner" role="status" data-testid="offline-banner">
          <span className="live-dot" /> 网络已断开 · 本地 PDF / 图片工具仍可处理并下载
        </div>
      ) : null}
      {configMissing ? (
        <div className="config-banner" role="status">
          <strong>云功能未配置。</strong> 本地 PDF / 图片工具仍可完全离线使用；AI、租户后台需在部署时配置
          CloudBase 环境与 Publishable Key。
        </div>
      ) : null}

      <main className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <div>
            <div className="footer-brand">PaperLab / 纸研所</div>
            <p>本地优先的文件工作台。文件默认不离开浏览器。</p>
          </div>
          <div className="footer-meta">
            <span><span className="live-dot" /> 本地处理引擎</span>
            <span>{runtime.e2eMode ? 'E2E 测试环境' : 'CloudBase PG'}</span>
            <span>v1.0.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
