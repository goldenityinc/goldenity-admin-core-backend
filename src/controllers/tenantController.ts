import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  createTenantSchema,
  paginationQuerySchema,
  tenantIdParamSchema,
  updateTenantSchema,
} from '../validations/tenantValidation';
import { TenantService } from '../services/tenantService';
import { ErpProvisionService } from '../services/erpProvisionService';
import prisma from '../config/database';
import { ObjectStorageService } from '../services/objectStorageService';
import { Readable } from 'node:stream';

function getServicePublicBaseUrl(req?: Request): string {
  const explicit = process.env.PUBLIC_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const railwayHost = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayHost) return `https://${railwayHost}`;

  if (!req) return '';
  const xfProtoRaw = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(xfProtoRaw)
    ? xfProtoRaw[0]
    : typeof xfProtoRaw === 'string'
      ? xfProtoRaw.split(',')[0]?.trim()
      : undefined;

  const xfHostRaw = req.headers['x-forwarded-host'];
  const host = Array.isArray(xfHostRaw)
    ? xfHostRaw[0]
    : typeof xfHostRaw === 'string'
      ? xfHostRaw.split(',')[0]?.trim()
      : req.get('host');

  const scheme = proto || req.protocol;
  return host ? `${scheme}://${host}` : '';
}

function buildTenantLogoProxyUrl(req: Request, tenantId: string, versionToken: string): string {
  const base = getServicePublicBaseUrl(req);
  // If base cannot be determined, fall back to relative URL.
  const path = `/public/tenants/${tenantId}/logo?v=${encodeURIComponent(versionToken)}`;
  return base ? `${base}${path}` : path;
}

function tryParseTigrisKeyFromUrl(logoUrl: string): { bucket?: string; key?: string } {
  try {
    const u = new URL(logoUrl);
    const parts = u.pathname.replace(/^\//, '').split('/');
    const bucket = parts.shift();
    const key = parts.join('/');
    if (!bucket || !key) return {};
    return { bucket, key };
  } catch {
    return {};
  }
}

function toNodeReadable(body: unknown): Readable | null {
  if (!body) return null;
  if (typeof (body as any).pipe === 'function') return body as Readable;
  // AWS SDK may return a web stream in some runtimes.
  const maybeWeb = body as any;
  if (typeof maybeWeb.getReader === 'function') {
    return Readable.fromWeb(body as any);
  }
  return null;
}

function inferImageExtension(mimeType: string): string | null {
  const mt = mimeType.trim().toLowerCase();
  if (mt === 'image/png') return 'png';
  if (mt === 'image/jpeg' || mt === 'image/jpg') return 'jpg';
  if (mt === 'image/webp') return 'webp';
  if (mt === 'image/svg+xml') return 'svg';
  return null;
}

export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createTenantSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid tenant payload', 400);
  }

  try {
    const result = await TenantService.createTenant(parsed.data);

    const erpConfigured = Boolean(
      process.env.ERP_API_BASE_URL?.trim() ||
      process.env.ERP_API_URL?.trim(),
    );
    const authHeader = req.headers.authorization;

    if (erpConfigured) {
      try {
        // Default: provision ERP org + mapping + seed baseline features, then ensure tenant admin exists in ERP.
        // Subscription upgrades can later update features via /api/integrations/erp/provision.
        await ErpProvisionService.provision(
          {
            tenantId: result.tenant.id,
            organizationId: result.tenant.slug,
            organizationName: result.tenant.name,
            features: ['crm', 'sales'],
            logoUrl: parsed.data.logoUrl,
          },
          authHeader,
          { dryRun: false },
        );

        if (parsed.data.adminEmail && parsed.data.adminPassword) {
          await ErpProvisionService.ensureTenantAdmin(
            {
              tenantId: result.tenant.id,
              organizationId: result.tenant.slug,
              adminEmail: parsed.data.adminEmail,
              adminPassword: parsed.data.adminPassword,
              adminName: `${parsed.data.name} Admin`,
            },
            authHeader,
          );
        }
      } catch (e) {
        await prisma.tenant.delete({ where: { id: result.tenant.id } });
        throw e;
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      data: result.tenant,
      firstAdmin: result.firstAdmin
        ? {
            ...result.firstAdmin,
            password: parsed.data.adminPassword,
          }
        : null,
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('Tenant with the same unique field already exists', 409);
    }

    throw error;
  }
});

export const getTenants = asyncHandler(async (req: Request, res: Response) => {
  const parsed = paginationQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const result = await TenantService.listTenants(parsed.data);

  return res.status(200).json({
    success: true,
    data: result.items,
    meta: result.meta,
  });
});

export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = tenantIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid tenantId', 400);
  }

  const bodyParsed = updateTenantSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid tenant payload', 400);
  }

  const existing = await prisma.tenant.findUnique({ where: { id: paramParsed.data.tenantId } });
  if (!existing) throw new AppError('Tenant tidak ditemukan', 404);

  const updated = await prisma.tenant.update({
    where: { id: existing.id },
    data: {
      ...(typeof bodyParsed.data.name === 'string' ? { name: bodyParsed.data.name } : {}),
      ...(bodyParsed.data.email !== undefined ? { email: bodyParsed.data.email } : {}),
      ...(bodyParsed.data.phone !== undefined ? { phone: bodyParsed.data.phone } : {}),
      ...(bodyParsed.data.address !== undefined ? { address: bodyParsed.data.address } : {}),
      ...(typeof bodyParsed.data.isActive === 'boolean' ? { isActive: bodyParsed.data.isActive } : {}),
    },
  });

  const erpConfigured = Boolean(process.env.ERP_API_BASE_URL?.trim() || process.env.ERP_API_URL?.trim());
  const authHeader = req.headers.authorization;
  if (erpConfigured && typeof authHeader === 'string') {
    await ErpProvisionService.upsertOrganizationProfile(
      {
        organizationId: updated.slug,
        displayName: updated.name,
        address: updated.address ?? undefined,
        phone: updated.phone ?? undefined,
        logoUrl: updated.logoUrl ?? undefined,
      },
      authHeader,
    );
  }

  return res.status(200).json({
    success: true,
    message: 'Tenant updated successfully',
    data: updated,
  });
});

export const uploadTenantLogo = asyncHandler(async (req: Request, res: Response) => {
  const parsed = tenantIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid tenantId', 400);
  }

  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) {
    throw new AppError('File logo wajib diupload (field: file)', 400);
  }

  if (!file.mimetype || !file.mimetype.toLowerCase().startsWith('image/')) {
    throw new AppError('File harus berupa gambar', 400);
  }

  const ext = inferImageExtension(file.mimetype);
  if (!ext) {
    throw new AppError('Format gambar tidak didukung (png/jpg/webp/svg)', 400);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: parsed.data.tenantId },
    select: { id: true, slug: true, name: true, address: true, phone: true },
  });
  if (!tenant) throw new AppError('Tenant tidak ditemukan', 404);

  const key = `tenants/${tenant.id}/logo-${Date.now()}.${ext}`;
  const uploaded = await ObjectStorageService.putPublicObject({
    key,
    body: file.buffer,
    contentType: file.mimetype,
  });

  const proxyUrl = buildTenantLogoProxyUrl(req, tenant.id, String(Date.now()));

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { logoUrl: proxyUrl, logoObjectKey: uploaded.key },
    select: { id: true, logoUrl: true, logoObjectKey: true },
  });

  const erpConfigured = Boolean(process.env.ERP_API_BASE_URL?.trim() || process.env.ERP_API_URL?.trim());
  const authHeader = req.headers.authorization;
  if (erpConfigured && typeof authHeader === 'string') {
    await ErpProvisionService.upsertOrganizationProfile(
      {
        organizationId: tenant.slug,
        displayName: tenant.name,
        address: tenant.address ?? undefined,
        phone: tenant.phone ?? undefined,
        logoUrl: proxyUrl,
      },
      authHeader,
    );
  }

  return res.status(200).json({
    success: true,
    message: 'Logo tenant berhasil diupload',
    data: { tenantId: updated.id, logoUrl: updated.logoUrl },
  });
});

export const getTenantLogoPublic = asyncHandler(async (req: Request, res: Response) => {
  const parsed = tenantIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid tenantId', 400);
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: parsed.data.tenantId },
    select: { id: true, logoUrl: true, logoObjectKey: true },
  });
  if (!tenant) throw new AppError('Tenant tidak ditemukan', 404);

  let key = tenant.logoObjectKey?.trim();
  if (!key && typeof tenant.logoUrl === 'string') {
    const parsedKey = tryParseTigrisKeyFromUrl(tenant.logoUrl);
    if (parsedKey.key) key = parsedKey.key;
  }

  if (!key) throw new AppError('Logo tenant belum tersedia', 404);

  const obj = await ObjectStorageService.getObject({ key });
  const stream = toNodeReadable(obj.body);
  if (!stream) throw new AppError('Tidak bisa membaca object stream', 502);

  res.status(200);
  res.setHeader('Content-Type', obj.contentType || 'application/octet-stream');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  stream.pipe(res);
});
