import axios from 'axios';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { ProvisionErpInput } from '../validations/integrationValidation';

type ErpOrganization = {
  id: string;
  name: string;
  createdAt?: string;
};

type ErpOrganizationFeaturesResponse = {
  ok?: boolean;
  organizationId?: string;
  enabledFeatures?: unknown;
  error?: string;
};

type ErpFeatureDefinition = {
  key: string;
  label: string;
  description?: string;
};

type ProvisionSteps = {
  createOrganization: {
    attempted: boolean;
    status: number | null;
    organizationId: string | null;
    created: boolean;
    response?: unknown;
  };
  upsertProfile: {
    attempted: boolean;
    status: number | null;
    ok: boolean;
    response?: unknown;
  };
  upsertMapping: {
    attempted: boolean;
    status: number | null;
    ok: boolean;
    response?: unknown;
  };
  applyFeatures: {
    attempted: boolean;
    status: number | null;
    ok: boolean;
    enabledFeatures: string[] | null;
    response?: unknown;
  };
};

function getErpConfig() {
  const baseUrlRaw =
    process.env.ERP_API_BASE_URL?.trim() ||
    process.env.ERP_API_URL?.trim();

  if (!baseUrlRaw) {
    throw new AppError(
      'ERP_API_BASE_URL belum dikonfigurasi. Set ke format: https://<erp-api-domain>/api/v1',
      503,
    );
  }

  const baseURL = normalizeErpApiBaseUrl(baseUrlRaw);

  const masterEmail = process.env.ERP_MASTER_EMAIL?.trim() || undefined;
  const masterPassword = process.env.ERP_MASTER_PASSWORD?.trim() || undefined;
  const masterAccessToken = process.env.ERP_MASTER_ACCESS_TOKEN?.trim() || undefined;

  const timeoutMsRaw = process.env.ERP_API_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 15000;

  return {
    baseURL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    masterEmail,
    masterPassword,
    masterAccessToken,
  };
}

function normalizeErpApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;

  // Accept already-versioned base URLs.
  if (/\/api\/v\d+$/.test(trimmed)) return trimmed;

  // Common misconfig: provide origin only (e.g., https://domain). Our ERP endpoints are under /api/v1.
  return `${trimmed}/api/v1`;
}

type JwtPayload = { exp?: number; iss?: string };

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;

    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

function isFirebaseIdToken(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.iss) return false;
  return payload.iss.includes('securetoken.google.com');
}

function stripBearer(authHeader: string): string {
  return authHeader.replace(/^bearer\s+/i, '').trim();
}

type CachedToken = { token: string; expMs: number };

let cachedMasterToken: CachedToken | null = null;

async function getMasterAccessToken(): Promise<string> {
  const { baseURL, timeoutMs, masterEmail, masterPassword, masterAccessToken } = getErpConfig();

  if (masterAccessToken) return masterAccessToken;

  if (!masterEmail || !masterPassword) {
    throw new AppError(
      'ERP master credential belum dikonfigurasi. Set ERP_MASTER_EMAIL & ERP_MASTER_PASSWORD (atau ERP_MASTER_ACCESS_TOKEN).',
      503,
    );
  }

  const now = Date.now();
  if (cachedMasterToken && cachedMasterToken.expMs - now > 60_000) {
    return cachedMasterToken.token;
  }

  const http = axios.create({
    baseURL,
    timeout: timeoutMs,
    headers: { 'content-type': 'application/json' },
    validateStatus: () => true,
  });

  const res = await http.post('/auth/login', {
    email: masterEmail,
    password: masterPassword,
  });

  const token = res.data?.accessToken;
  if (res.status !== 200 || typeof token !== 'string' || !token) {
    const reason = res.data?.error ?? res.statusText ?? 'UNKNOWN_ERROR';
    throw new AppError(`Gagal login ke ERP sebagai master admin: ${reason}`, 502);
  }

  const payload = decodeJwtPayload(token);
  const expMs = typeof payload?.exp === 'number' ? payload.exp * 1000 : now + 10 * 60_000;
  cachedMasterToken = { token, expMs };
  return token;
}

async function resolveErpAuthHeader(fallbackAuthHeader?: string): Promise<string> {
  const cfg = getErpConfig();
  if (cfg.masterAccessToken || (cfg.masterEmail && cfg.masterPassword)) {
    const token = await getMasterAccessToken();
    return `Bearer ${token}`;
  }

  if (!fallbackAuthHeader || !fallbackAuthHeader.toLowerCase().startsWith('bearer ')) {
    throw new AppError(
      'ERP master credential belum dikonfigurasi. Set ERP_MASTER_EMAIL & ERP_MASTER_PASSWORD (atau ERP_MASTER_ACCESS_TOKEN).',
      503,
    );
  }

  const token = stripBearer(fallbackAuthHeader);
  if (isFirebaseIdToken(token)) {
    throw new AppError(
      'ERP master credential belum dikonfigurasi. Token yang dikirim adalah token CRM (Firebase), bukan token ERP.',
      503,
    );
  }

  return fallbackAuthHeader;
}

function isValidOrgIdCandidate(value: string): boolean {
  // Keep aligned with ERP routing slug/id constraints used across the UI.
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && value.length >= 2 && value.length <= 50;
}

export class ErpProvisionService {
  static async getFeatureCatalog(authHeader?: string): Promise<ErpFeatureDefinition[]> {
    const { baseURL, timeoutMs } = getErpConfig();
    const erpAuthHeader = await resolveErpAuthHeader(authHeader);
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: erpAuthHeader,
        'content-type': 'application/json',
      },
      validateStatus: () => true,
    });

    const res = await http.get('/tenant-admin/features');
    if (res.status === 401) throw new AppError('Token ERP tidak valid/expired', 401);
    if (res.status === 403) throw new AppError('Akses ERP ditolak (butuh master admin)', 403);
    if (res.status !== 200 || !Array.isArray(res.data?.features)) {
      const reason = res.data?.error ?? res.statusText ?? 'UNKNOWN_ERROR';
      throw new AppError(`Gagal mengambil feature catalog ERP: ${reason}`, 502);
    }

    return res.data.features as ErpFeatureDefinition[];
  }

  static async getOrganizationEnabledFeatures(input: { organizationId: string }, authHeader?: string): Promise<string[]> {
    const orgId = input.organizationId.trim();
    if (!orgId) throw new AppError('organizationId wajib diisi', 400);

    const { baseURL, timeoutMs } = getErpConfig();
    const erpAuthHeader = await resolveErpAuthHeader(authHeader);
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: erpAuthHeader,
        'content-type': 'application/json',
      },
      validateStatus: () => true,
    });

    const res = await http.get(`/tenant-admin/organizations/${encodeURIComponent(orgId)}/features`);
    if (res.status === 401) throw new AppError('Token ERP tidak valid/expired', 401);
    if (res.status === 403) throw new AppError('Akses ERP ditolak (butuh master admin)', 403);
    if (res.status === 404) throw new AppError('Organization ERP tidak ditemukan', 404);
    if (res.status !== 200) {
      const reason = res.data?.error ?? res.statusText ?? 'UNKNOWN_ERROR';
      throw new AppError(`Gagal mengambil enabled features ERP: ${reason}`, 502);
    }

    const data = (res.data ?? {}) as ErpOrganizationFeaturesResponse;
    const enabled = data.enabledFeatures;
    return Array.isArray(enabled) ? enabled.filter((x): x is string => typeof x === 'string') : [];
  }

  static async provision(
    input: ProvisionErpInput,
    authHeader?: string,
    options?: { dryRun?: boolean },
  ) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, name: true, slug: true, isActive: true, address: true, phone: true, logoUrl: true },
    });

    if (!tenant) {
      throw new AppError('Tenant tidak ditemukan', 404);
    }

    if (!tenant.isActive) {
      throw new AppError('Tenant sudah tidak aktif', 403);
    }

    const dryRun = Boolean(options?.dryRun);

    const orgName = (input.organizationName ?? tenant.name).trim();
    if (!orgName) {
      throw new AppError('organizationName tidak valid', 400);
    }

    const fallbackOrgId = isValidOrgIdCandidate(tenant.slug) ? tenant.slug : undefined;
    const requestedOrgId = input.organizationId?.trim();
    const orgIdCandidate = requestedOrgId && isValidOrgIdCandidate(requestedOrgId)
      ? requestedOrgId
      : requestedOrgId
      ? (() => {
          throw new AppError('organizationId harus berupa slug (a-z0-9-), 2..50 karakter', 400);
        })()
      : fallbackOrgId;

    const createPayload: Record<string, unknown> = {
      name: orgName,
    };

    if (orgIdCandidate) {
      createPayload.id = orgIdCandidate;
    }

    if (input.features?.length) {
      createPayload.features = input.features;
    }

    createPayload.displayName = orgName;
    if (tenant.address) createPayload.address = tenant.address;
    if (tenant.phone) createPayload.phone = tenant.phone;
    const logoUrlToUse = input.logoUrl?.trim() || tenant.logoUrl?.trim() || '';
    if (logoUrlToUse) createPayload.logoUrl = logoUrlToUse;

    const plannedMappingPayload = {
      externalTenantId: tenant.id,
      organizationId: orgIdCandidate ?? '<auto>',
    };

    const plannedFeaturesPayload = input.features?.length
      ? { features: input.features }
      : null;

    if (dryRun) {
      return {
        dryRun: true,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
        },
        planned: {
          erpBaseUrl: process.env.ERP_API_BASE_URL?.trim() ?? null,
          requests: {
            createOrganization: {
              method: 'POST',
              path: '/tenant-admin/organizations',
              body: createPayload,
            },
            upsertProfile: {
              method: 'PUT',
              path: orgIdCandidate
                ? `/tenant-admin/organizations/${orgIdCandidate}/profile`
                : '/tenant-admin/organizations/<organizationId>/profile',
              body: {
                displayName: orgName,
                ...(tenant.address ? { address: tenant.address } : {}),
                ...(tenant.phone ? { phone: tenant.phone } : {}),
                ...(logoUrlToUse ? { logoUrl: logoUrlToUse } : {}),
              },
            },
            upsertMapping: {
              method: 'PUT',
              path: '/tenant-admin/integrations/crm/mappings',
              body: plannedMappingPayload,
            },
            applyFeatures: plannedFeaturesPayload
              ? {
                  method: 'PUT',
                  path: orgIdCandidate
                    ? `/tenant-admin/organizations/${orgIdCandidate}/features`
                    : '/tenant-admin/organizations/<organizationId>/features',
                  body: plannedFeaturesPayload,
                }
              : null,
          },
        },
      };
    }

    const { baseURL, timeoutMs } = getErpConfig();
    const erpAuthHeader = await resolveErpAuthHeader(authHeader);
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: erpAuthHeader,
        'content-type': 'application/json',
      },
      validateStatus: () => true,
    });

    let organizationId: string;
    let createdOrganization: ErpOrganization | null = null;

    const steps: ProvisionSteps = {
      createOrganization: {
        attempted: true,
        status: null,
        organizationId: null,
        created: false,
      },
      upsertProfile: {
        attempted: false,
        status: null,
        ok: false,
      },
      upsertMapping: {
        attempted: false,
        status: null,
        ok: false,
      },
      applyFeatures: {
        attempted: false,
        status: null,
        ok: false,
        enabledFeatures: null,
      },
    };

    const createRes = await http.post('/tenant-admin/organizations', createPayload);
    steps.createOrganization.status = createRes.status;
    steps.createOrganization.response = createRes.data;

    if (createRes.status === 201 && createRes.data?.organization?.id) {
      createdOrganization = createRes.data.organization as ErpOrganization;
      organizationId = createdOrganization.id;
      steps.createOrganization.organizationId = organizationId;
      steps.createOrganization.created = true;
    } else if (createRes.status === 409) {
      if (!orgIdCandidate) {
        throw new AppError(
          'Organization sudah ada di ERP. Kirim organizationId agar provisioning bisa idempotent.',
          409,
        );
      }

      organizationId = orgIdCandidate;
      steps.createOrganization.organizationId = organizationId;
      steps.createOrganization.created = false;
    } else if (createRes.status === 401) {
      throw new AppError('Token ERP tidak valid/expired', 401);
    } else if (createRes.status === 403) {
      throw new AppError('Akses ERP ditolak (butuh master admin)', 403);
    } else {
      const reason = createRes.data?.error ?? createRes.statusText ?? 'UNKNOWN_ERROR';
      throw new AppError(`Gagal create organization di ERP: ${reason}`, 502);
    }

    steps.upsertMapping.attempted = true;
    const mappingRes = await http.put('/tenant-admin/integrations/crm/mappings', {
      externalTenantId: tenant.id,
      organizationId,
    });

    steps.upsertMapping.status = mappingRes.status;
    steps.upsertMapping.response = mappingRes.data;

    if (mappingRes.status !== 200 || mappingRes.data?.ok !== true) {
      const reason = mappingRes.data?.error ?? mappingRes.statusText ?? 'UNKNOWN_ERROR';
      throw new AppError(`Gagal set mapping tenant CRM → ERP: ${reason}`, 502);
    }

    steps.upsertMapping.ok = true;

    steps.upsertProfile.attempted = true;
    const profilePayload: Record<string, unknown> = {
      displayName: orgName,
    };
    if (tenant.address) profilePayload.address = tenant.address;
    if (tenant.phone) profilePayload.phone = tenant.phone;
    if (logoUrlToUse) profilePayload.logoUrl = logoUrlToUse;

    const profileRes = await http.put(
      `/tenant-admin/organizations/${encodeURIComponent(organizationId)}/profile`,
      profilePayload,
    );

    steps.upsertProfile.status = profileRes.status;
    steps.upsertProfile.response = profileRes.data;

    if (profileRes.status !== 200 || profileRes.data?.ok !== true) {
      const reason = profileRes.data?.error ?? profileRes.statusText ?? 'UNKNOWN_ERROR';
      throw new AppError(`Gagal set company profile organization di ERP: ${reason}`, 502);
    }

    steps.upsertProfile.ok = true;

    let featuresApplied: string[] | null = null;
    if (input.features?.length) {
      steps.applyFeatures.attempted = true;
      const featuresRes = await http.put(`/tenant-admin/organizations/${encodeURIComponent(organizationId)}/features`, {
        features: input.features,
      });

      steps.applyFeatures.status = featuresRes.status;
      steps.applyFeatures.response = featuresRes.data;

      if (featuresRes.status !== 200 || featuresRes.data?.ok !== true) {
        const reason = featuresRes.data?.error ?? featuresRes.statusText ?? 'UNKNOWN_ERROR';
        throw new AppError(`Gagal set features organization di ERP: ${reason}`, 502);
      }

      steps.applyFeatures.ok = true;
      steps.applyFeatures.enabledFeatures =
        Array.isArray(featuresRes.data?.enabledFeatures)
          ? (featuresRes.data.enabledFeatures as string[])
          : input.features;

      featuresApplied = input.features;
    }

    return {
      dryRun: false,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
      },
      erp: {
        organizationId,
        organization: createdOrganization,
        featuresApplied,
      },
      steps,
    };
  }

  static async ensureTenantAdmin(
    input: { tenantId: string; organizationId?: string; adminEmail: string; adminPassword: string; adminName: string },
    authHeader?: string,
  ) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, name: true, slug: true, isActive: true },
    });

    if (!tenant) throw new AppError('Tenant tidak ditemukan', 404);
    if (!tenant.isActive) throw new AppError('Tenant sudah tidak aktif', 403);

    const requestedOrgId = input.organizationId?.trim();
    const orgId = requestedOrgId && isValidOrgIdCandidate(requestedOrgId)
      ? requestedOrgId
      : requestedOrgId
      ? (() => {
          throw new AppError('organizationId harus berupa slug (a-z0-9-), 2..50 karakter', 400);
        })()
      : isValidOrgIdCandidate(tenant.slug)
        ? tenant.slug
        : (() => {
            throw new AppError('Tenant slug tidak valid untuk organizationId ERP. Kirim organizationId.', 400);
          })();

    const { baseURL, timeoutMs } = getErpConfig();
    const erpAuthHeader = await resolveErpAuthHeader(authHeader);
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: erpAuthHeader,
        'content-type': 'application/json',
      },
      validateStatus: () => true,
    });

    const res = await http.post(`/tenant-admin/organizations/${encodeURIComponent(orgId)}/admins`, {
      email: input.adminEmail,
      password: input.adminPassword,
      name: input.adminName,
    });

    if (res.status === 201) return { ok: true, created: true };
    if (res.status === 409 && res.data?.error === 'EMAIL_TAKEN') return { ok: true, created: false };
    if (res.status === 401) throw new AppError('Token ERP tidak valid/expired', 401);
    if (res.status === 403) throw new AppError('Akses ERP ditolak (butuh master admin)', 403);

    const reason = res.data?.error ?? res.statusText ?? 'UNKNOWN_ERROR';
    throw new AppError(`Gagal membuat tenant admin di ERP: ${reason}`, 502);
  }
}
