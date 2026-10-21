interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

const MESSAGES: Record<string, string> = {
  provider_not_configured: 'AI 出图暂未开放',
  model_disabled: '该功能暂不可用',
  model_not_found: '该功能暂不可用',
  tool_disabled: '该功能暂未开放',
  insufficient_balance: '额度不足，请联系空间管理员',
  tenant_budget_exceeded: '本月额度已用完',
  user_budget_exceeded: '你的本月额度已用完',
  model_budget_exceeded: '本月可用额度已用完',
  rate_limited: '操作太频繁，请稍后再试',
  payments_disabled: '充值暂未开放',
  payment_provider_not_configured: '充值暂未开放',
  forbidden: '没有访问权限',
  unauthenticated: '登录已过期，请重新登录',
  tenant_suspended: '当前空间已暂停使用',
  idempotency_conflict: '请求已变化，请重新提交',
  validation_error: '请检查填写内容',
  network_error: '网络连接中断，请稍后再试',
  user_not_found: '该邮箱尚未加入平台',
  already_member: '这个成员已在空间中',
  last_owner: '至少保留一位空间所有者',
};

export function userError(error: unknown, fallback = '操作未完成，请稍后再试'): string {
  if (!error || typeof error !== 'object') return fallback;
  const value = error as ErrorLike;
  const code = typeof value.code === 'string' ? value.code : '';
  return MESSAGES[code] || (typeof value.message === 'string' ? value.message : fallback);
}

export function userMessageForCode(code: string | null | undefined, fallback: string): string {
  return code ? MESSAGES[code] || fallback : fallback;
}

export function ledgerKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    reserve: '预占',
    settle: '扣费',
    release: '退回',
    reconcile_hold: '待确认',
    adjustment: '额度调整',
    topup: '充值',
  };
  return labels[kind] || '额度变动';
}

export function orderStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    created: '待支付',
    pending: '处理中',
    paid: '已完成',
    failed: '失败',
    cancelled: '已取消',
    refunded: '已退款',
  };
  return labels[status] || '处理中';
}
