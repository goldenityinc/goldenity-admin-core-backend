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

  const updated = await prisma.tenant.update({
    where: { id: tenant.id },
    data: { logoUrl: uploaded.url },
    select: { id: true, logoUrl: true },
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
        logoUrl: uploaded.url,
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
