import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { AuditLogService } from '../services/auditLogService';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

function hasAuditLogAccess(req: Request): boolean {
  const normalizedRole = (req.user?.role ?? '')
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[-\s]+/g, '_');

  return (
    normalizedRole === 'SUPER_ADMIN' ||
    normalizedRole === 'TENANT_ADMIN' ||
    normalizedRole === 'OWNER' ||
    normalizedRole === 'ADMIN'
  );
}

function parseLimit(value: unknown): number {
  if (typeof value !== 'string') return 100;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(1, Math.min(parsed, 500));
}

export const listAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  if (!hasAuditLogAccess(req)) {
    throw new AppError('Akses ditolak: hanya Admin/Owner', 403);
  }

  const tenantId = readTenantId(req);
  const limit = parseLimit(req.query.limit);

  const logs = await AuditLogService.listLogs(tenantId, limit);

  return res.status(200).json({
    success: true,
    data: logs,
    total: logs.length,
  });
});
