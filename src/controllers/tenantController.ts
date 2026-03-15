import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  createTenantSchema,
  paginationQuerySchema,
} from '../validations/tenantValidation';
import { TenantService } from '../services/tenantService';
import { ErpProvisionService } from '../services/erpProvisionService';
import prisma from '../config/database';

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
