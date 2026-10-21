import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './components/Toast';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { AccountPage } from './pages/AccountPage';
import { AiPage } from './pages/AiPage';
import { TenantPage } from './pages/TenantPage';
import { AdminPage } from './pages/AdminPage';
import { ToolWorkbenchPage } from './pages/ToolWorkbenchPage';
import { PdfMergePage } from './pages/PdfMergePage';
import { PdfSplitPage } from './pages/PdfSplitPage';
import { PdfRotatePage } from './pages/PdfRotatePage';
import { ImageCropPage } from './pages/ImageCropPage';
import { ImageResizePage } from './pages/ImageResizePage';
import { ImageConvertPage } from './pages/ImageConvertPage';
import { ImageCompressPage } from './pages/ImageCompressPage';
import { NotFoundPage } from './pages/NotFoundPage';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ScrollToTop />
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/pdf" replace />} />
            <Route path="pdf" element={<ToolWorkbenchPage kind="pdf" />} />
            <Route path="pdf/merge" element={<PdfMergePage />} />
            <Route path="pdf/split" element={<PdfSplitPage />} />
            <Route path="pdf/rotate" element={<PdfRotatePage />} />
            <Route path="image" element={<ToolWorkbenchPage kind="image" />} />
            <Route path="image/crop" element={<ImageCropPage />} />
            <Route path="image/resize" element={<ImageResizePage />} />
            <Route path="image/convert" element={<ImageConvertPage />} />
            <Route path="image/compress" element={<ImageCompressPage />} />
            <Route path="ai" element={<ToolWorkbenchPage kind="ai" />} />
            <Route path="ai/image" element={<AiPage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="t/:slug" element={<TenantPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
