import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { provisionErpSchema } from '../validations/integrationValidation';
import { ErpProvisionService } from '../services/erpProvisionService';

function parseBooleanQuery(value: unknown): boolean {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'y';
}

export const provisionErp = asyncHandler(async (req: Request, res: Response) => {
  const parsed = provisionErpSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid provisioning payload', 400);
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    throw new AppError('Authorization header wajib diisi', 401);
  }

  const dryRun = parseBooleanQuery((req.query as any)?.dryRun);

  const result = await ErpProvisionService.provision(parsed.data, authHeader, { dryRun });

  return res.status(200).json({
    success: true,
    message: dryRun ? 'ERP provisioning dry-run' : 'ERP provisioning sukses',
    data: result,
  });
});

export const getErpFeatureCatalog = asyncHandler(async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    throw new AppError('Authorization header wajib diisi', 401);
  }

  const features = await ErpProvisionService.getFeatureCatalog(authHeader);

  return res.status(200).json({
    success: true,
    data: { features },
  });
});
