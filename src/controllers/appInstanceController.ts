import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { AppInstanceService } from '../services/appInstanceService';
import { ErpProvisionService } from '../services/erpProvisionService';
import {
  appInstanceIdParamSchema,
  createAppInstanceSchema,
  listAppInstanceModuleCatalogQuerySchema,
  listAppInstancesQuerySchema,
  updateAppInstanceSchema,
} from '../validations/appInstanceValidation';

type AppInstanceResponsePayload = Awaited<ReturnType<typeof AppInstanceService.create>>;

async function syncErpOrganizationProfile(
  appInstance: AppInstanceResponsePayload,
  authHeader: string | undefined,
): Promise<string | null> {
  if (appInstance?.solution?.code !== 'ERP' || typeof authHeader !== 'string') {
    return null;
  }

  try {
    await ErpProvisionService.upsertOrganizationProfile(
      {
        organizationId: appInstance.tenant.slug,
        subscriptionStartDate: appInstance.createdAt,
        subscriptionEndDate: appInstance.endDate ?? null,
      },
      authHeader,
    );

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ERP synchronization error';
    console.error('ERP organization profile sync failed', {
      tenantId: appInstance.tenant.id,
      tenantSlug: appInstance.tenant.slug,
      appInstanceId: appInstance.id,
      error: message,
    });
    return `ERP profile sync skipped: ${message}`;
  }
}

export const createAppInstance = asyncHandler(async (req: Request, res: Response) => {
  const bodyParsed = createAppInstanceSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid app instance payload', 400);
  }

  try {
    const appInstance = await AppInstanceService.create(bodyParsed.data);
    const warning = await syncErpOrganizationProfile(
      appInstance,
      typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    );

    return res.status(201).json({
      success: true,
      message: 'App instance created successfully',
      data: appInstance,
      ...(warning ? { warning } : {}),
    });
  } catch (error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      throw error;
    }

    if (error.code === 'P2002') {
      throw new AppError('Tenant already subscribed to this solution', 409);
    }

    if (error.code === 'P2003') {
      throw new AppError('Invalid tenantId or solutionId reference', 400);
    }

    throw error;
  }
});

export const getAppInstances = asyncHandler(async (req: Request, res: Response) => {
  const queryParsed = listAppInstancesQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    throw new AppError(queryParsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const result = await AppInstanceService.list(queryParsed.data);

  return res.status(200).json({
    success: true,
    data: result.items,
    meta: result.meta,
  });
});

export const getAppInstanceModuleCatalog = asyncHandler(async (req: Request, res: Response) => {
  const queryParsed = listAppInstanceModuleCatalogQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    throw new AppError(queryParsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const items = await AppInstanceService.listModuleCatalog(queryParsed.data);

  return res.status(200).json({
    success: true,
    data: items,
  });
});

export const updateAppInstance = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = appInstanceIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid app instance id', 400);
  }

  const bodyParsed = updateAppInstanceSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid app instance payload', 400);
  }

  const existing = await AppInstanceService.getById(paramParsed.data.id);
  if (!existing) {
    throw new AppError('App instance not found', 404);
  }

  const updated = await AppInstanceService.update(paramParsed.data.id, bodyParsed.data);
  const warning = await syncErpOrganizationProfile(
    updated,
    typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
  );

  return res.status(200).json({
    success: true,
    message: 'App instance updated successfully',
    data: updated,
    ...(warning ? { warning } : {}),
  });
});

export const deleteAppInstance = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = appInstanceIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid app instance id', 400);
  }

  const existing = await AppInstanceService.getById(paramParsed.data.id);
  if (!existing) {
    throw new AppError('App instance not found', 404);
  }

  await AppInstanceService.remove(paramParsed.data.id);

  return res.status(200).json({
    success: true,
    message: 'App instance deleted successfully',
  });
});
