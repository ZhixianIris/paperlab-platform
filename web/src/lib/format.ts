export function formatMoney(cents: number, currency = 'CNY'): string {
  const formatter = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  });
  return formatter.format(cents / 100);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function jobStatusLabel(status: string): string {
  switch (status) {
    case 'processing':
      return '生成中';
    case 'pending_reconciliation':
      return '确认中';
    case 'succeeded':
    case 'settled':
      return '已完成';
    case 'failed':
      return '未成功';
    default:
      return status;
  }
}

export function roleLabel(role: string): string {
  return role === 'tenant_owner' ? '空间所有者' : '成员';
}

export function toolLabel(key: string): string {
  const labels: Record<string, string> = {
    'pdf.merge': 'PDF 合并',
    'pdf.split': 'PDF 拆分',
    'pdf.rotate': 'PDF 旋转',
    'pdf.delete': 'PDF 删除页面',
    'pdf.organize': 'PDF 页面重排',
    'pdf.blanks': 'PDF 添加空白页',
    'pdf.numbers': 'PDF 添加页码',
    'pdf.watermark': 'PDF 文字水印',
    'pdf.crop': 'PDF 裁剪边距',
    'pdf.metadata': 'PDF 文档属性',
    'pdf.images': '图片转 PDF',
    'pdf.to-image': 'PDF 转图片',
    'pdf.to-text': 'PDF 提取文字',
    'pdf.compress': 'PDF 图像压缩',
    'pdf.grayscale': 'PDF 转灰度',
    'pdf.background': '扫描件去浅色背景',
    'pdf.stamp': 'PDF 添加印章/签名图',
    'pdf.flatten': 'PDF 表单扁平化',
    'image.crop': '图片裁剪',
    'image.resize': '图片缩放',
    'image.convert': '格式转换',
    'image.compress': '图片压缩',
    'ai.image.generate': 'AI 出图',
  };
  return labels[key] ?? key;
}
