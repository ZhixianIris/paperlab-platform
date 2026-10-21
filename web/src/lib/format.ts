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
      return '处理中';
    case 'pending_reconciliation':
      return '待核对';
    case 'succeeded':
      return '已完成';
    case 'settled':
      return '已结算';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

export function roleLabel(role: string): string {
  return role === 'tenant_owner' ? '租户所有者' : '租户成员';
}

export function toolLabel(key: string): string {
  const labels: Record<string, string> = {
    'pdf.merge': 'PDF 合并',
    'pdf.split': 'PDF 拆分',
    'pdf.rotate': 'PDF 旋转',
    'image.crop': '图片裁剪',
    'image.resize': '图片缩放',
    'image.convert': '格式转换',
    'image.compress': '图片压缩',
    'ai.image.generate': 'AI 出图',
  };
  return labels[key] ?? key;
}
