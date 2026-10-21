import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { IMAGE_TOOLS, PDF_TOOLS, type ToolMeta } from '../lib/tools';
import {
  ArrowIcon,
  CompressIcon,
  ConvertIcon,
  CropIcon,
  FileIcon,
  ImageIcon,
  ResizeIcon,
  RotateIcon,
  ScissorsIcon,
  ShieldIcon,
  SparklesIcon,
} from '../components/Icons';

function ToolGlyph({ icon, size = 22 }: { icon: ToolMeta['icon']; size?: number }) {
  switch (icon) {
    case 'file':
      return <FileIcon size={size} />;
    case 'scissors':
      return <ScissorsIcon size={size} />;
    case 'rotate':
      return <RotateIcon size={size} />;
    case 'crop':
      return <CropIcon size={size} />;
    case 'resize':
      return <ResizeIcon size={size} />;
    case 'convert':
      return <ConvertIcon size={size} />;
    case 'compress':
      return <CompressIcon size={size} />;
    case 'sparkles':
      return <SparklesIcon size={size} />;
    default:
      return <ImageIcon size={size} />;
  }
}

function ToolCard({ tool }: { tool: ToolMeta }) {
  return (
    <Link to={tool.path} className="tool-card" data-testid={`tool-${tool.key}`}>
      <span className="tool-icon"><ToolGlyph icon={tool.icon} /></span>
      <div>
        <h3>{tool.title}</h3>
        <p>{tool.short}</p>
      </div>
      <span className="tool-card-arrow"><ArrowIcon size={16} /></span>
    </Link>
  );
}

export function HomePage() {
  const { session } = useAuth();

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">LOCAL-FIRST FILE WORKBENCH</span>
          <h1>
            处理文件，
            <br />
            <em>不必交出文件。</em>
          </h1>
          <p className="hero-lede">
            PDF 合并、拆分、旋转，图片裁剪、缩放、转换、压缩——全部在你的浏览器里完成。
            AI 出图与团队额度走经过认证的 CloudBase 服务。
          </p>
          <div className="hero-actions">
            <Link to="/pdf/merge" className="button button-accent button-large">
              开始处理 PDF <ArrowIcon size={18} />
            </Link>
            <Link to="/ai" className="button button-ghost button-large">
              <SparklesIcon size={18} /> 试试 AI 出图
            </Link>
          </div>
          <div className="trust-row">
            <span><ShieldIcon size={16} /> 文件不上传</span>
            <span>断网可用</span>
            <span>无埋点</span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-label">IN-BROWSER / NO UPLOAD</div>
          <div className="paper-stack">
            <div className="paper-sheet sheet-back">
              <span>IMAGE</span>
              <div className="sheet-lines" />
            </div>
            <div className="paper-sheet sheet-mid">
              <span>PDF</span>
              <div className="sheet-lines" />
            </div>
            <div className="paper-sheet sheet-front">
              <span className="sheet-tag">LOCAL</span>
              <div className="sheet-title">paper.pdf</div>
              <div className="sheet-lines" />
              <div className="sheet-lock"><ShieldIcon size={22} /> 0 bytes uploaded</div>
            </div>
          </div>
          <div className="art-sticker">100%<small>本地处理</small></div>
        </div>
      </section>

      {session?.memberships.length ? (
        <section className="workspace-strip" aria-label="我的租户">
          <span className="strip-label">我的空间</span>
          {session.memberships.map((membership) => (
            <Link key={membership.tenantId} to={`/t/${membership.slug}`} className="workspace-pill">
              <strong>{membership.tenantName}</strong>
              <span>{membership.role === 'tenant_owner' ? '所有者' : '成员'}</span>
              <ArrowIcon size={14} />
            </Link>
          ))}
          <Link to="/account" className="text-link">账户与用量</Link>
        </section>
      ) : null}

      <section className="tools-section" id="tools">
        <div className="section-head">
          <div>
            <span className="eyebrow">01 / LOCAL TOOLS</span>
            <h2>七件顺手的文件工具</h2>
          </div>
          <p>没有上传进度条，因为没有上传。页面加载后，处理链路只在你的设备上运行。</p>
        </div>
        <div className="tools-group">
          <h3 className="group-title"><FileIcon size={18} /> PDF</h3>
          <div className="tool-grid">
            {PDF_TOOLS.map((tool) => <ToolCard key={tool.key} tool={tool} />)}
          </div>
        </div>
        <div className="tools-group">
          <h3 className="group-title"><ImageIcon size={18} /> 图片</h3>
          <div className="tool-grid">
            {IMAGE_TOOLS.map((tool) => <ToolCard key={tool.key} tool={tool} />)}
          </div>
        </div>
      </section>

      <section className="ai-band">
        <div className="ai-band-copy">
          <span className="eyebrow">02 / CLOUDBASE AI</span>
          <h2>需要创意时，<br />再让云端接手。</h2>
          <p>
            登录后进入租户工作台。模型、价格、额度和使用记录全部由服务端决定；
            每次付费调用先预留余额，再结算，并留下不可篡改的账本。
          </p>
          <div className="hero-actions">
            <Link to="/ai" className="button button-light">打开 AI 创作</Link>
            <Link to="/login" className="button button-outline-light">登录租户工作台</Link>
          </div>
        </div>
        <div className="ai-band-art" aria-hidden="true">
          <div className="ai-orbit">
            <SparklesIcon size={42} />
            <span className="orbit-dot dot-1" />
            <span className="orbit-dot dot-2" />
            <span className="orbit-dot dot-3" />
          </div>
          <div className="ai-meter">
            <span>MONTHLY BUDGET</span>
            <strong>服务端可信额度</strong>
            <div><i style={{ width: '62%' }} /></div>
            <small>预留 → 结算 → 账本</small>
          </div>
        </div>
      </section>

      <section className="principles">
        <div className="section-head compact">
          <div>
            <span className="eyebrow">03 / PRINCIPLES</span>
            <h2>清晰边界，才敢托付。</h2>
          </div>
        </div>
        <div className="principle-grid">
          <article>
            <span className="principle-no">01</span>
            <h3>本地能力不依赖登录</h3>
            <p>匿名访客可使用全部 PDF 与图片工具。AI 和租户协作才需要 CloudBase 身份。</p>
          </article>
          <article>
            <span className="principle-no">02</span>
            <h3>钱与价格只在服务端</h3>
            <p>前端只发送请求 ID 与提示词。价格、余额、预占和结算由 PostgreSQL 事务决定。</p>
          </article>
          <article>
            <span className="principle-no">03</span>
            <h3>租户之间默认拒绝</h3>
            <p>GRANT + RLS 双重约束，服务端再次校验成员关系。不存在前端传 tenantId 就越权。</p>
          </article>
        </div>
      </section>
    </div>
  );
}
