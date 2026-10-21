import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileDrop } from '../components/FileDrop';
import { PdfPreview } from '../components/PdfPreview';
import { ResultCard } from '../components/ResultCard';
import { ToolPageShell, ToolProcessButton } from '../components/ToolPageShell';
import { NotFoundPage } from './NotFoundPage';
import { PDF_TOOLS } from '../lib/tools';
import { getPdfInfo, type PdfInfo } from '../features/tools/pdf/operations';
import {
  addPageNumbers, cropPdf, deletePdfPages, editPdfMetadata, flattenPdfForms,
  imagesToPdf, insertBlankPages, reorderPdfPages, stampPdf, watermarkPdf,
} from '../features/tools/pdf/operations-extended';
import { exportPdfImages, extractPdfText, rasterPdf } from '../features/tools/pdf/render';

type Paper = 'a4' | 'original';
type Format = 'png' | 'jpeg';
type NumberPosition = 'bottom-left' | 'bottom-center' | 'bottom-right' | 'top-center';
type StampPosition = 'center' | 'top-right' | 'bottom-right';

export function PdfUtilityPage() {
  const { utility } = useParams();
  const tool = PDF_TOOLS.find((item) => item.path === `/pdf/${utility}`);
  const [files, setFiles] = useState<File[]>([]);
  const [stampFiles, setStampFiles] = useState<File[]>([]);
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [range, setRange] = useState('');
  const [order, setOrder] = useState('');
  const [afterPage, setAfterPage] = useState(0);
  const [count, setCount] = useState(1);
  const [start, setStart] = useState(1);
  const [position, setPosition] = useState<NumberPosition>('bottom-center');
  const [stampPosition, setStampPosition] = useState<StampPosition>('bottom-right');
  const [stampWidth, setStampWidth] = useState(20);
  const [watermark, setWatermark] = useState('仅供内部使用');
  const [opacity, setOpacity] = useState(24);
  const [margin, setMargin] = useState(8);
  const [paper, setPaper] = useState<Paper>('a4');
  const [format, setFormat] = useState<Format>('png');
  const [scale, setScale] = useState(1.5);
  const [quality, setQuality] = useState(.75);
  const [threshold, setThreshold] = useState(190);
  const [meta, setMeta] = useState({ title: '', author: '', subject: '', keywords: '', clear: false });
  const [results, setResults] = useState<File[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const isImagesToPdf = tool?.key === 'pdf.images';
  const file = isImagesToPdf ? null : files[0] || null;
  const key = tool?.key || '';

  useEffect(() => {
    setFiles([]);
    setStampFiles([]);
    setResults([]);
    setInfo(null);
    setError('');
    setRange('');
    setOrder('');
  }, [utility]);

  useEffect(() => {
    if (!file) { setInfo(null); return; }
    let cancelled = false;
    getPdfInfo(file).then((data) => {
      if (cancelled) return;
      setInfo(data);
      setOrder(Array.from({ length: data.pageCount }, (_, index) => index + 1).join(','));
      setAfterPage(data.pageCount);
      setMeta((current) => ({ ...current, title: data.title || '' }));
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setInfo(null);
        setError(reason instanceof Error ? reason.message : 'PDF 解析失败');
      }
    });
    return () => { cancelled = true; };
  }, [file]);

  async function process() {
    setProcessing(true);
    setError('');
    setResults([]);
    try {
      if (isImagesToPdf) {
        setResults([await imagesToPdf(files, paper)]);
        return;
      }
      if (!file) throw new Error('请先选择 PDF 文件');
      let output: File | File[];
      switch (key) {
        case 'pdf.delete':
          output = await deletePdfPages(file, range);
          break;
        case 'pdf.organize':
          output = await reorderPdfPages(file, order);
          break;
        case 'pdf.blanks':
          output = await insertBlankPages(file, afterPage, count);
          break;
        case 'pdf.numbers':
          output = await addPageNumbers(file, { start, position, range });
          break;
        case 'pdf.watermark':
          output = await watermarkPdf(file, watermark, opacity / 100, range);
          break;
        case 'pdf.crop':
          output = await cropPdf(file, margin, range);
          break;
        case 'pdf.metadata':
          output = await editPdfMetadata(file, meta);
          break;
        case 'pdf.to-image':
          output = await exportPdfImages(file, range, format, scale);
          break;
        case 'pdf.to-text':
          output = await extractPdfText(file, range);
          break;
        case 'pdf.compress':
        case 'pdf.grayscale':
        case 'pdf.background':
          output = await rasterPdf(
            file,
            key === 'pdf.compress' ? 'compress' : key === 'pdf.grayscale' ? 'grayscale' : 'background',
            { quality, scale, threshold },
          );
          break;
        case 'pdf.stamp':
          if (!stampFiles[0]) throw new Error('请选择 PNG 或 JPEG 印章图片');
          output = await stampPdf(file, stampFiles[0], range, stampWidth, stampPosition);
          break;
        case 'pdf.flatten':
          output = await flattenPdfForms(file);
          break;
        default:
          throw new Error('未知 PDF 工具');
      }
      setResults(Array.isArray(output) ? output : [output]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作未完成');
    } finally {
      setProcessing(false);
    }
  }

  if (!tool) return <NotFoundPage />;

  const hasPageSelection = new Set([
    'pdf.delete', 'pdf.numbers', 'pdf.watermark', 'pdf.crop',
    'pdf.to-image', 'pdf.to-text', 'pdf.stamp',
  ]).has(key);

  return (
    <ToolPageShell tool={tool}>
      <div className="workbench-section">
        <FileDrop
          accept={isImagesToPdf ? 'image/png,image/jpeg,.png,.jpg,.jpeg' : 'application/pdf,.pdf'}
          multiple={isImagesToPdf}
          files={files}
          onChange={(next) => {
            setFiles(next);
            setResults([]);
            setError('');
          }}
          title={isImagesToPdf ? '选择 PNG / JPEG 图片（按选择顺序生成 PDF）' : '选择 PDF 文件'}
          hint={isImagesToPdf
            ? '支持多张图片，按顺序写入 PDF，文件始终留在本机。'
            : '在浏览器中解析和处理文件，不会上传到服务器。'}
          testId={`pdf-${utility}-drop`}
        />
        {file ? <PdfPreview file={file} /> : null}
      </div>

      <div className="field-grid">
        {hasPageSelection ? (
          <label className="field">
            <span>{key === 'pdf.delete' ? '要删除的页码（必填）' : '处理的页码'}</span>
            <input data-testid="utility-range" value={range}
              onChange={(event) => setRange(event.target.value)}
              placeholder={key === 'pdf.delete' ? '例如 2,4-6' : '留空处理全部页；或输入 1,3-5'} />
            <small>{info ? `共 ${info.pageCount} 页。` : ''}页码从 1 开始，逗号分隔，范围用短横线。</small>
          </label>
        ) : null}

        {key === 'pdf.organize' ? (
          <label className="field">
            <span>目标顺序（可重复页码）</span>
            <input data-testid="pdf-order" value={order} onChange={(event) => setOrder(event.target.value)}
              placeholder="3,1-2,2" />
            <small>如 3,1-2,2：第 3 页 → 第 1、2 页 → 再复制第 2 页；未列出的页将省略。</small>
          </label>
        ) : null}

        {key === 'pdf.blanks' ? (
          <>
            <label className="field">
              <span>在第几页后插入（0 = 文档开头）</span>
              <input type="number" min={0} max={info?.pageCount || 9999} value={afterPage}
                onChange={(event) => setAfterPage(Number(event.target.value))} data-testid="blank-after" />
            </label>
            <label className="field">
              <span>添加空白页数量（1–20）</span>
              <input type="number" min={1} max={20} value={count}
                onChange={(event) => setCount(Number(event.target.value))} data-testid="blank-count" />
            </label>
          </>
        ) : null}

        {key === 'pdf.numbers' ? (
          <>
            <label className="field">
              <span>起始页码</span>
              <input type="number" min={0} max={999999} value={start}
                onChange={(event) => setStart(Number(event.target.value))} data-testid="number-start" />
            </label>
            <label className="field">
              <span>页码位置</span>
              <select value={position} onChange={(event) => setPosition(event.target.value as NumberPosition)}>
                <option value="bottom-center">底部居中</option>
                <option value="bottom-left">左下角</option>
                <option value="bottom-right">右下角</option>
                <option value="top-center">顶部居中</option>
              </select>
            </label>
          </>
        ) : null}

        {key === 'pdf.watermark' ? (
          <>
            <label className="field">
              <span>文字水印（支持中文）</span>
              <input data-testid="watermark-text" maxLength={80} value={watermark}
                onChange={(event) => setWatermark(event.target.value)} />
            </label>
            <label className="field">
              <span>透明度 {opacity}%</span>
              <input type="range" min={5} max={100} value={opacity}
                onChange={(event) => setOpacity(Number(event.target.value))} />
              <small>文字会在本地绘制为透明图层，不会改动 PDF 正文文字层。</small>
            </label>
          </>
        ) : null}

        {key === 'pdf.crop' ? (
          <label className="field">
            <span>四边裁剪边距（毫米）</span>
            <input data-testid="crop-margin" type="number" min={0} max={100} step={1}
              value={margin} onChange={(event) => setMargin(Number(event.target.value))} />
            <small>通过 CropBox 改变可见范围；页面原始内容仍存在，不能用作安全涂黑。</small>
          </label>
        ) : null}

        {key === 'pdf.metadata' ? (
          <>
            {([
              ['title', '标题'], ['author', '作者'], ['subject', '主题'], ['keywords', '关键词（逗号分隔）'],
            ] as const).map(([field, label]) => (
              <label className="field" key={field}>
                <span>{label}</span>
                <input value={meta[field]} disabled={meta.clear}
                  onChange={(event) => setMeta((current) => ({ ...current, [field]: event.target.value }))}
                  data-testid={`metadata-${field}`} />
              </label>
            ))}
            <label className="field">
              <span>元信息处理方式</span>
              <label className="pdf-check">
                <input type="checkbox" checked={meta.clear}
                  onChange={(event) => setMeta((current) => ({ ...current, clear: event.target.checked }))} />
                清空常见文档属性
              </label>
              <small>不保证清除所有嵌入 XMP、修订历史或敏感内容，不能替代隐私取证级清理。</small>
            </label>
          </>
        ) : null}

        {isImagesToPdf ? (
          <label className="field">
            <span>纸张尺寸</span>
            <select value={paper} onChange={(event) => setPaper(event.target.value as Paper)}>
              <option value="a4">适配 A4（自动横竖版）</option>
              <option value="original">按照图片原始比例</option>
            </select>
          </label>
        ) : null}

        {key === 'pdf.to-image' ? (
          <label className="field">
            <span>输出图片格式</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as Format)}
              data-testid="export-format">
              <option value="png">PNG 无损</option>
              <option value="jpeg">JPEG 较小文件</option>
            </select>
            <small>每页生成一个图片文件，每次最多 30 页。</small>
          </label>
        ) : null}

        {['pdf.to-image', 'pdf.compress', 'pdf.grayscale', 'pdf.background'].includes(key) ? (
          <label className="field">
            <span>渲染清晰度（{scale.toFixed(1)}×）</span>
            <input type="range" min={.6} max={2.4} step={.2} value={scale}
              onChange={(event) => setScale(Number(event.target.value))} data-testid="raster-scale" />
            <small>清晰度越高，耗时和占用内存越多。</small>
          </label>
        ) : null}

        {['pdf.compress', 'pdf.grayscale', 'pdf.background'].includes(key) ? (
          <label className="field">
            <span>JPEG 输出品质（{Math.round(quality * 100)}%）</span>
            <input type="range" min={.4} max={.95} step={.05} value={quality}
              onChange={(event) => setQuality(Number(event.target.value))} />
          </label>
        ) : null}

        {key === 'pdf.background' ? (
          <label className="field">
            <span>浅色背景阈值（{threshold}）</span>
            <input data-testid="background-threshold" type="range" min={110} max={235} step={5}
              value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
            <small>仅适合浅色背景与深色文字。复杂背景会损失细小笔画，处理后逐页检查。</small>
          </label>
        ) : null}

        {key === 'pdf.stamp' ? (
          <>
            <label className="field">
              <span>图像相对页面宽度（{stampWidth}%）</span>
              <input type="range" min={5} max={70} step={5} value={stampWidth}
                onChange={(event) => setStampWidth(Number(event.target.value))} />
            </label>
            <label className="field">
              <span>放置位置</span>
              <select value={stampPosition} onChange={(event) => setStampPosition(event.target.value as StampPosition)}>
                <option value="bottom-right">右下角</option>
                <option value="top-right">右上角</option>
                <option value="center">页面中心</option>
              </select>
              <small>仅为可见印章或手写签名图片，不具有数字签名的身份验证能力。</small>
            </label>
          </>
        ) : null}
      </div>

      {key === 'pdf.stamp' ? (
        <FileDrop accept="image/png,image/jpeg,.png,.jpg,.jpeg" files={stampFiles} onChange={setStampFiles}
          title="选择印章或手写签名 PNG/JPEG" hint="建议使用透明背景 PNG，图片不会上传。"
          testId="stamp-image-drop" />
      ) : null}

      {['pdf.compress', 'pdf.grayscale', 'pdf.background'].includes(key) ? (
        <p className="pdf-warning" role="note">
          此操作先把 PDF 页面渲染成图像再重新封装，会丢失原生文字层、可搜索性、交互表单以及矢量清晰度。
          压缩后文件不一定更小；请保留原件，不用于需要可编辑文字的文件。
        </p>
      ) : null}
      {key === 'pdf.flatten' ? (
        <p className="pdf-warning" role="note">
          仅处理标准 AcroForm 字段，操作后字段不能再编辑；不等同于扁平化所有类型的批注或数字签名。
        </p>
      ) : null}
      {error ? <p className="form-error" role="alert" data-testid="tool-error">{error}</p> : null}
      <div className="action-row">
        <ToolProcessButton processing={processing} onClick={() => void process()}
          disabled={isImagesToPdf ? files.length === 0 : !file || !info}>
          {tool.title}
        </ToolProcessButton>
        <span className="action-note">
          {info ? `${info.pageCount} 页 · ` : ''}本地处理，无服务器上传
        </span>
      </div>
      {results.map((item, index) => (
        <ResultCard key={`${item.name}:${index}`} file={item}
          title={results.length > 1 ? `第 ${index + 1} 个结果` : '处理完成'} />
      ))}
    </ToolPageShell>
  );
}
