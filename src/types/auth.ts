export type JwtAuthPayload = {
  userId: string;
  tenantId: string;
  role?: string;
  branchId?: string;
  branchCode?: string;
  tier?: string | null;
  addons?: string[];
  entitlementsRevision?: number;
  activeModules?: string[];
};

export type ModuleEntitlementDto = {
  enabled: boolean;
  source: 'CORE' | 'BUNDLE' | 'ADDON' | 'TRIAL' | 'MANUAL_OVERRIDE';
  config?: Record<string, unknown>;
  limits?: Record<string, unknown>;
  activatedAt?: string | null;
  expiredAt?: string | null;
};

export type TenantEntitlementsDto = {
  revision: number;
  resolvedAt: string;
  active_modules: string[];
  modules: Record<string, ModuleEntitlementDto>;
};

export type LoginResponseDto = {
  success: true;
  token: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: {
    id: string;
    username: string;
    role: string;
    tenantId: string;
    branchId?: string | null;
    customRoleId?: string | null;
  };
  branch?: {
    id: string;
    name: string;
    branchCode?: string | null;
  } | null;
  tenant: {
    id: string;
    slug: string;
    name: string;
    bridgeApiUrl?: string | null;
    showInventoryImages?: boolean;
    syncMode?: string;
  };
  entitlements: TenantEntitlementsDto;
  subscription: {
    tier?: string | null;
    addons?: string[];
    endDate?: string | null;
  };
};

export function isJwtAuthPayload(value: unknown): value is JwtAuthPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<JwtAuthPayload>;

  return (
    typeof candidate.userId === 'string' && candidate.userId.length > 0 &&
    typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0 &&
    (candidate.role === undefined || typeof candidate.role === 'string') &&
    (candidate.branchId === undefined || typeof candidate.branchId === 'string') &&
    (candidate.branchCode === undefined || typeof candidate.branchCode === 'string') &&
    (candidate.tier === undefined || candidate.tier === null || typeof candidate.tier === 'string') &&
    (candidate.addons === undefined || (Array.isArray(candidate.addons) && candidate.addons.every((item) => typeof item === 'string'))) &&
    (candidate.entitlementsRevision === undefined || typeof candidate.entitlementsRevision === 'number') &&
    (candidate.activeModules === undefined || (Array.isArray(candidate.activeModules) && candidate.activeModules.every((item) => typeof item === 'string')))
  );
}
