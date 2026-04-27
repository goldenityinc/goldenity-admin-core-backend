import type { Request } from 'express';
import { emitToTenant } from './socketServer';

function resolveTenantId(req: Request, explicitTenantId?: string): string {
  const fallback = req.user?.tenantId ?? '';
  return (explicitTenantId ?? fallback).toString().trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function emitTenantUpdated(
  req: Request,
  tenantId: string,
  payload: Record<string, unknown>,
): void {
  const resolvedTenantId = resolveTenantId(req, tenantId);
  if (!resolvedTenantId) {
    return;
  }

  emitToTenant(resolvedTenantId, 'tenant_updated', {
    tenantId: resolvedTenantId,
    ...payload,
    timestamp: nowIso(),
  });
}

export function emitUserChanged(
  req: Request,
  tenantId: string,
  action: 'CREATED' | 'UPDATED' | 'DELETED' | 'SYNCED',
  payload: Record<string, unknown>,
): void {
  const resolvedTenantId = resolveTenantId(req, tenantId);
  if (!resolvedTenantId) {
    return;
  }

  emitToTenant(resolvedTenantId, 'user_changed', {
    tenantId: resolvedTenantId,
    action,
    ...payload,
    timestamp: nowIso(),
  });
}