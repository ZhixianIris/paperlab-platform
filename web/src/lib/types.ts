export interface PaymentStatus {
  enabled: boolean;
  provider: string | null;
  reason: string | null;
  message: string | null;
}

export interface AiStatus {
  provider: string;
  configured: boolean;
}

export interface PublicConfig {
  payments: PaymentStatus;
  ai: AiStatus;
  version: string;
  environment: string;
}

export interface SessionUser {
  id: string;
  email: string;
}

export interface Membership {
  tenantId: string;
  slug: string;
  tenantName: string;
  tenantStatus: 'active' | 'suspended';
  role: 'tenant_owner' | 'tenant_member';
  userId: string;
  availableCents: number;
  reservedCents: number;
  userBudgetCents: number;
  userMonthSpentCents: number;
  tenantBudgetCents: number;
  tenantMonthSpentCents: number;
  maxJobCostCents: number;
  memberCount: number;
}

export interface Bootstrap {
  user: SessionUser;
  platformAdmin: boolean;
  memberships: Membership[];
  config: PublicConfig;
}

export interface AiImage {
  mimeType: string;
  dataUrl?: string;
  url?: string;
}

export interface AiJob {
  id: string;
  tenantId: string;
  userId: string;
  requestId: string;
  status: 'processing' | 'pending_reconciliation' | 'succeeded' | 'settled' | 'failed';
  feature: string;
  provider: string;
  model: string;
  modelPriceId: string;
  prompt?: string;
  params: { size?: string; count?: number };
  reservedCents: number;
  settledCents: number;
  usageQuantity: number;
  providerRequestId: string | null;
  result?: { images?: AiImage[]; revisedPrompt?: string | null } | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ModelInfo {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  description: string;
  unitPriceCents: number;
  currency: string;
  enabled: boolean;
  maxImages: number;
  maxPromptChars: number;
  monthlyBudgetCents: number;
  providerConfigured: boolean;
  available: boolean;
  unavailableReason: string | null;
}

export interface ToolConfig {
  key: string;
  enabled: boolean;
  updatedAt?: string;
}

export interface MemberInfo {
  userId: string;
  email: string;
  role: 'tenant_owner' | 'tenant_member';
  userBudgetCents: number;
  createdAt?: string;
}

export interface WalletInfo {
  availableCents: number;
  reservedCents: number;
  currency: string;
}

export interface TenantUsage {
  tenantMonthSpentCents: number;
  userMonthSpentCents: number;
  reservedCents: number;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  monthlyAiBudgetCents: number;
  maxJobCostCents: number;
  createdAt: string;
}

export interface TenantDashboard {
  tenant: TenantInfo;
  role: 'tenant_owner' | 'tenant_member';
  membership: { userBudgetCents: number; userMonthSpentCents: number };
  wallet: WalletInfo;
  usage: TenantUsage;
  tools: ToolConfig[];
  members: MemberInfo[];
  jobs: AiJob[];
  config: PublicConfig;
}

export interface UsageRecord {
  id: string;
  tenantId: string;
  tenantName: string | null;
  userId: string;
  feature: string;
  provider: string;
  model: string;
  quantity: number;
  unitPriceCents: number;
  amountCents: number;
  createdAt: string;
}

export interface Order {
  id: string;
  tenantId: string;
  tenantName: string | null;
  userId: string | null;
  amountCents: number;
  currency: string;
  status: string;
  provider: string;
  providerOrderId: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  tenantName: string | null;
  kind: string;
  availableDeltaCents: number;
  reservedDeltaCents: number;
  availableAfterCents: number;
  reservedAfterCents: number;
  createdAt: string;
}

export interface AccountSummary extends Bootstrap {
  usage: UsageRecord[];
  orders: Order[];
  ledger: LedgerEntry[];
}

export interface AdminTenant extends TenantInfo {
  availableCents: number;
  reservedCents: number;
  memberCount: number;
  owners: string;
  monthUsageCents: number;
}

export interface AdminCounts {
  tenantCount: number;
  memberCount: number;
  adminCount: number;
  pendingJobs: number;
  paidOrders: number;
  enabledModels: number;
  walletTotalCents: number;
  monthUsageCents: number;
}

export interface AdminOverview {
  counts: AdminCounts;
  tenants: AdminTenant[];
  models: ModelInfo[];
  jobs: AiJob[];
  orders: Order[];
  usage: UsageRecord[];
  config: PublicConfig;
}

export interface AdminTenantDetail {
  tenant: AdminTenant;
  members: MemberInfo[];
  tools: ToolConfig[];
  jobs: AiJob[];
  ledger: LedgerEntry[];
}

export interface GenerateResult {
  job: AiJob;
  error: { code: string; message: string } | null;
}
