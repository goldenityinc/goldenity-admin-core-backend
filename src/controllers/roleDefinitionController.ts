import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/AppError';
import * as svc from '../services/roleDefinitionService';

// ─── Validation schemas ────────────────────────────────────────────────────

const permissionEntrySchema = z.object({
  c: z.boolean(),
  r: z.boolean(),
  u: z.boolean(),
  d: z.boolean(),
});

const permissionsSchema = z.record(permissionEntrySchema);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(255).optional(),
  permissions: permissionsSchema,
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(255).optional(),
  permissions: permissionsSchema.optional(),
});

// ─── Helpers ───────────────────────────────────────────────────────────────

const resolveTenantId = (req: Request): string => {
  // SUPER_ADMIN dapat menyuplai tenantId via body/query
  if (req.user?.role === 'SUPER_ADMIN') {
    const id = req.params.tenantId || req.body.tenantId || (req.query.tenantId as string);
    if (!id) throw new AppError('tenantId required for SUPER_ADMIN calls', 400);
    return id;
  }
  return req.user!.tenantId;
};

// ─── Controllers ───────────────────────────────────────────────────────────

export const listRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    const roles = await svc.listCustomRoles(tenantId);
    res.json({ success: true, data: roles });
  } catch (e) { next(e); }
};

export const createRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400);
    const { name, description, permissions } = parsed.data;
    const role = await svc.createCustomRole(tenantId, name, permissions, description);
    res.status(201).json({ success: true, data: role });
  } catch (e) { next(e); }
};

export const getRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    const role = await svc.getCustomRole(tenantId, req.params.id);
    if (!role) throw new AppError('Role not found', 404);
    res.json({ success: true, data: role });
  } catch (e) { next(e); }
};

export const updateRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400);
    const existing = await svc.getCustomRole(tenantId, req.params.id);
    if (!existing) throw new AppError('Role not found', 404);
    if (existing.isDefault) {
      if (
        typeof parsed.data.name === 'string' &&
        parsed.data.name.trim().length > 0 &&
        parsed.data.name.trim() !== existing.name
      ) {
        throw new AppError('Role bawaan sistem tidak boleh diubah namanya', 403);
      }
      if ('description' in parsed.data) {
        throw new AppError('Role bawaan sistem hanya boleh diubah permissions-nya', 403);
      }
    }
    const updated = await svc.updateCustomRole(tenantId, req.params.id, parsed.data);
    if (!updated) throw new AppError('Role not found', 404);
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
};

export const deleteRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    const existing = await svc.getCustomRole(tenantId, req.params.id);
    if (!existing) throw new AppError('Role not found', 404);
    if (existing.isDefault)
      throw new AppError('Role bawaan sistem tidak dapat dihapus', 403);
    const deleted = await svc.deleteCustomRole(tenantId, req.params.id);
    if (!deleted) throw new AppError('Role not found', 404);
    res.json({ success: true, message: 'Role deleted' });
  } catch (e) { next(e); }
};

export const assignRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    const { customRoleId } = req.body; // null to unassign
    const updated = await svc.assignCustomRoleToUser(
      tenantId,
      req.params.userId,
      customRoleId ?? null,
    );
    if (!updated) throw new AppError('User or CustomRole not found', 404);
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
};

export const seedRoles = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = resolveTenantId(req);
    await svc.seedDefaultRoles(tenantId);
    res.json({ success: true, message: 'Default roles seeded (Admin, Kasir, Pajak)' });
  } catch (e) { next(e); }
};
