import { Link } from 'react-router-dom';
import { FileIcon } from '../components/Icons';

export function NotFoundPage() {
  return (
    <div className="empty-page">
      <FileIcon size={44} />
      <span className="eyebrow">404</span>
      <h1>这一页没有文件</h1>
      <p>地址可能已失效，或者工具名称拼错了。</p>
      <Link to="/" className="button button-accent">回到工具台</Link>
    </div>
  );
}
