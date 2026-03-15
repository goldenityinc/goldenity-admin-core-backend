import axios from 'axios';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { ProvisionErpInput } from '../validations/integrationValidation';

type ErpOrganization = {
  id: string;
  name: string;
  createdAt?: string;
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

  const timeoutMsRaw = process.env.ERP_API_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 15000;

  return {
    baseURL,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
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

function isValidOrgIdCandidate(value: string): boolean {
  // Keep aligned with ERP routing slug/id constraints used across the UI.
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && value.length >= 2 && value.length <= 50;
}

export class ErpProvisionService {
  static async getFeatureCatalog(authHeader: string): Promise<ErpFeatureDefinition[]> {
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new AppError('Authorization Bearer token wajib diisi', 401);
    }

    const { baseURL, timeoutMs } = getErpConfig();
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: authHeader,
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

  static async provision(
    input: ProvisionErpInput,
    authHeader: string,
    options?: { dryRun?: boolean },
  ) {
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new AppError('Authorization Bearer token wajib diisi', 401);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: input.tenantId },
      select: { id: true, name: true, slug: true, isActive: true },
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
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: authHeader,
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
    authHeader: string,
  ) {
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new AppError('Authorization Bearer token wajib diisi', 401);
    }

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
    const http = axios.create({
      baseURL,
      timeout: timeoutMs,
      headers: {
        Authorization: authHeader,
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
