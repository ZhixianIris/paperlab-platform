import { Link, useSearchParams } from 'react-router-dom';
import { ArrowIcon, SparklesIcon } from '../components/Icons';
import { ToolGlyph } from '../components/ToolGlyph';
import { IMAGE_TOOLS, PDF_TOOLS, type ToolMeta } from '../lib/tools';

type WorkbenchKind = 'pdf' | 'image' | 'ai';
type Tone = 'coral' | 'magenta' | 'blue' | 'purple' | 'ink';

const TONES: Tone[] = ['coral', 'blue', 'purple', 'magenta'];

const WORKBENCH = {
  pdf: {
    eyebrow: 'PDF WORKBENCH',
    title: 'PDF',
    count: `${PDF_TOOLS.length} 个工具`,
    tools: PDF_TOOLS,
  },
  image: {
    eyebrow: 'IMAGE WORKBENCH',
    title: '图片',
    count: `${IMAGE_TOOLS.length} 个工具`,
    tools: IMAGE_TOOLS,
  },
  ai: {
    eyebrow: 'AI WORKBENCH',
    title: 'AI',
    count: '1 个功能',
    tools: [],
  },
} as const;

function WorkbenchCard({
  tool,
  index,
  tone,
}: {
  tool: ToolMeta;
  index: number;
  tone: Tone;
}) {
  return (
    <Link
      to={tool.path}
      className={`workbench-card tone-${tone}`}
      data-testid={`workbench-${tool.key}`}
    >
      <div className="workbench-card-top">
        <span className="workbench-index">{String(index + 1).padStart(2, '0')}</span>
        <span className="workbench-arrow"><ArrowIcon size={20} /></span>
      </div>
      <div className="workbench-card-body">
        <span className="workbench-icon"><ToolGlyph icon={tool.icon} size={28} /></span>
        <h2>{tool.title}</h2>
      </div>
    </Link>
  );
}

export function ToolWorkbenchPage({ kind }: { kind: WorkbenchKind }) {
  const [searchParams] = useSearchParams();
  const workbench = WORKBENCH[kind];
  const tenant = searchParams.get('tenant');
  const aiHref = tenant ? `/ai/image?tenant=${encodeURIComponent(tenant)}` : '/ai/image';

  return (
    <div className="workbench-page" data-testid={`workbench-${kind}`}>
      <header className="workbench-head">
        <div>
          <span className="eyebrow">{workbench.eyebrow}</span>
          <h1>{workbench.title}</h1>
        </div>
        <span className="workbench-count">{workbench.count}</span>
      </header>

      {kind === 'ai' ? (
        <div className="workbench-grid workbench-grid-ai">
          <Link to={aiHref} className="workbench-card tone-ink workbench-ai-card" data-testid="workbench-ai-image">
            <div className="workbench-card-top">
              <span className="workbench-index">01</span>
              <span className="workbench-arrow"><ArrowIcon size={20} /></span>
            </div>
            <div className="workbench-card-body">
              <span className="workbench-icon"><SparklesIcon size={30} /></span>
              <h2>图像生成</h2>
            </div>
          </Link>
        </div>
      ) : (
        <div className={`workbench-grid workbench-grid-${kind}`}>
          {workbench.tools.map((tool, index) => (
            <WorkbenchCard
              key={tool.key}
              tool={tool}
              index={index}
              tone={TONES[index % TONES.length]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
