import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  createTenantSchema,
  paginationQuerySchema,
} from '../validations/tenantValidation';
import { TenantService } from '../services/tenantService';

export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createTenantSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid tenant payload', 400);
  }

  try {
    const result = await TenantService.createTenant(parsed.data);

    return res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      data: result.tenant,
      firstAdmin: {
        ...result.firstAdmin,
        password: parsed.data.adminPassword,
      },
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
