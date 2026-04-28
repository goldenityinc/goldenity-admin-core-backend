import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  createUserSchema,
  listUsersQuerySchema,
  syncPosUsersSchema,
  tenantIdParamSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from '../validations/tenantValidation';
import { UserService } from '../services/userService';
import prisma from '../config/database';
import { emitUserChanged } from '../services/realtimeEmitter';
import { serializeForJson } from '../utils/serializeForJson';

const TENANT_SCOPED_ADMIN_ROLES = new Set(['TENANT_ADMIN', 'ADMIN', 'OWNER']);
const TENANT_ADMIN_MANAGEABLE_ROLES = new Set(['CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY']);

const normalizeCreateUserRole = (
  rawRole: unknown,
): 'TENANT_ADMIN' | 'CRM_MANAGER' | 'CRM_STAFF' | 'READ_ONLY' | undefined => {
  if (typeof rawRole !== 'string') {
    return undefined;
  }

  switch (rawRole.trim().toUpperCase()) {
    case 'TENANT_ADMIN':
    case 'ADMIN':
    case 'OWNER':
      return 'TENANT_ADMIN';
    case 'CRM_MANAGER':
    case 'MANAGER':
      return 'CRM_MANAGER';
    case 'CRM_STAFF':
    case 'STAFF':
    case 'CASHIER':
    case 'KASIR':
    case 'USER':
      return 'CRM_STAFF';
    case 'READ_ONLY':
    case 'VIEWER':
    case 'AUDITOR':
    case 'PAJAK':
      return 'READ_ONLY';
    default:
      return undefined;
  }
};

function getActorRole(req: Request): string {
  return (req.user?.role ?? '').toString().toUpperCase();
}

function isTenantScopedAdmin(req: Request): boolean {
  return TENANT_SCOPED_ADMIN_ROLES.has(getActorRole(req));
}

function canManageTargetUser(req: Request, target: { tenantId: string; role?: string | null }): boolean {
  const actorRole = getActorRole(req);
  if (actorRole === 'SUPER_ADMIN') {
    return true;
  }

  if (!TENANT_SCOPED_ADMIN_ROLES.has(actorRole)) {
    return false;
  }

  if (!req.user?.tenantId || req.user.tenantId !== target.tenantId) {
    return false;
  }

  const normalizedTargetRole = (target.role ?? '').toString().toUpperCase();
  return TENANT_ADMIN_MANAGEABLE_ROLES.has(normalizedTargetRole);
}

export const createTenantUser = asyncHandler(async (req: Request, res: Response) => {
  const incomingRoleRaw = (req.body as { role?: unknown })?.role;
  const normalizedIncomingRole = normalizeCreateUserRole(incomingRoleRaw);
  if (
    typeof incomingRoleRaw === 'string' &&
    incomingRoleRaw.trim().length > 0 &&
    !normalizedIncomingRole
  ) {
    throw new AppError('Invalid role value in request body', 400);
  }

  const paramParsed = tenantIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid tenantId', 400);
  }

  const bodyParsed = createUserSchema.safeParse({
    ...req.body,
    tenantId: paramParsed.data.tenantId,
    role: normalizedIncomingRole,
    branchId: (req.body as { branchId?: unknown }).branchId,
  });
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid user payload', 400);
  }

  try {
    const createdUser = await UserService.createTenantUser(bodyParsed.data);
    const serializedUser = serializeForJson(createdUser);

    emitUserChanged(req, bodyParsed.data.tenantId, 'CREATED', {
      user: serializedUser,
    });

    return res.status(201).json({
      success: true,
      message: 'Tenant user created successfully',
      data: serializedUser,
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('User with the same username already exists in this tenant', 409);
    }

    throw error;
  }
});

export const getTenantUsers = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = tenantIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid tenantId', 400);
  }

  const queryParsed = listUsersQuerySchema.safeParse({
    ...req.query,
    tenantId: paramParsed.data.tenantId,
  });
  if (!queryParsed.success) {
    throw new AppError(queryParsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const result = await UserService.listUsers(queryParsed.data);

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.items),
    meta: result.meta,
  });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const actorRole = (req.user?.role ?? '').toString().toUpperCase();
  const isSuperAdmin = actorRole === 'SUPER_ADMIN';
  const isTenantScopedAdminUser = isTenantScopedAdmin(req);

  if (!isSuperAdmin && !isTenantScopedAdminUser) {
    throw new AppError('You do not have permission to create users', 403);
  }

  const incomingRoleRaw = (req.body as { role?: unknown })?.role;
  const normalizedIncomingRole = normalizeCreateUserRole(incomingRoleRaw);
  if (
    typeof incomingRoleRaw === 'string' &&
    incomingRoleRaw.trim().length > 0 &&
    !normalizedIncomingRole
  ) {
    throw new AppError('Invalid role value in request body', 400);
  }

  if (isTenantScopedAdminUser) {
    const tenantAdminAllowedRoles = new Set(['CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY']);
    const targetRole = normalizedIncomingRole ?? 'CRM_STAFF';

    if (!tenantAdminAllowedRoles.has(targetRole)) {
      throw new AppError(
        'Admin tenant hanya boleh membuat user role CRM_MANAGER, CRM_STAFF, atau READ_ONLY',
        403,
      );
    }
  }

  const bodyForValidation = {
    ...(req.body as Record<string, unknown>),
    // SUPER_ADMIN boleh menentukan tenantId target dari payload.
    // TENANT_ADMIN dipaksa ke tenant miliknya sendiri.
    tenantId: isSuperAdmin
      ? (req.body as Record<string, unknown>).tenantId
      : req.user?.tenantId,
    role: normalizedIncomingRole,
    branchId: (req.body as Record<string, unknown>).branchId,
  };

  const bodyParsed = createUserSchema.safeParse(bodyForValidation);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid user payload', 400);
  }

  try {
    const createdUser = await UserService.createTenantUser(bodyParsed.data);
    const serializedUser = serializeForJson(createdUser);

    emitUserChanged(req, bodyParsed.data.tenantId, 'CREATED', {
      user: serializedUser,
    });

    return res.status(201).json({
      success: true,
      message: 'Tenant user created successfully',
      data: serializedUser,
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('User with the same username already exists in this tenant', 409);
    }

    throw error;
  }
});

export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const queryParsed = listUsersQuerySchema.safeParse({
    ...req.query,
    tenantId: isTenantScopedAdmin(req)
      ? req.user?.tenantId
      : (req.query as Record<string, unknown>).tenantId,
  });
  if (!queryParsed.success) {
    throw new AppError(queryParsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const result = await UserService.listUsers(queryParsed.data);

  return res.status(200).json({
    success: true,
    data: serializeForJson(result.items),
    meta: result.meta,
  });
});

export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { newPassword } = req.body as { newPassword?: string };

  if (!id) {
    throw new AppError('User ID is required', 400);
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new AppError('newPassword must be at least 6 characters', 400);
  }

  const existingUser = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      role: true,
    },
  });

  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  if (!canManageTargetUser(req, existingUser)) {
    throw new AppError('You do not have permission to reset this user password', 403);
  }

  const updatedUser = await UserService.resetUserPassword(id, newPassword);

  return res.status(200).json({
    success: true,
    message: 'Password berhasil direset',
    data: serializeForJson(updatedUser),
  });
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = userIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid user id', 400);
  }

  const bodyParsed = updateUserStatusSchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid status payload', 400);
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: paramParsed.data.id },
    select: {
      id: true,
      tenantId: true,
      role: true,
    },
  });

  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  if (!canManageTargetUser(req, existingUser)) {
    throw new AppError('You do not have permission to update this user status', 403);
  }

  const updatedUser = await UserService.updateUserStatus(
    paramParsed.data.id,
    bodyParsed.data.isActive,
  );
  const serializedUser = serializeForJson(updatedUser);

  emitUserChanged(req, updatedUser.tenantId, 'UPDATED', {
    user: serializedUser,
  });

  return res.status(200).json({
    success: true,
    message: `Status user berhasil diubah menjadi ${bodyParsed.data.isActive ? 'aktif' : 'nonaktif'}`,
    data: serializedUser,
  });
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = userIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid user id', 400);
  }

  const incomingRoleRaw = (req.body as { role?: unknown })?.role;
  const normalizedIncomingRole = normalizeCreateUserRole(incomingRoleRaw);
  if (
    typeof incomingRoleRaw === 'string' &&
    incomingRoleRaw.trim().length > 0 &&
    !normalizedIncomingRole
  ) {
    throw new AppError('Invalid role value in request body', 400);
  }

  const bodyParsed = updateUserSchema.safeParse({
    role: normalizedIncomingRole,
    branchId: (req.body as { branchId?: unknown }).branchId,
  });
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid role payload', 400);
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: paramParsed.data.id },
    select: {
      id: true,
      tenantId: true,
      role: true,
    },
  });

  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  if (!canManageTargetUser(req, existingUser)) {
    throw new AppError('You do not have permission to update this user role', 403);
  }

  if (
    isTenantScopedAdmin(req) &&
    bodyParsed.data.role !== undefined &&
    !TENANT_ADMIN_MANAGEABLE_ROLES.has(bodyParsed.data.role)
  ) {
    throw new AppError(
      'Admin tenant hanya boleh mengubah role ke CRM_MANAGER, CRM_STAFF, atau READ_ONLY',
      403,
    );
  }

  const updatedUser = await UserService.updateUser(paramParsed.data.id, bodyParsed.data);
  const serializedUser = serializeForJson(updatedUser);

  emitUserChanged(req, updatedUser.tenantId, 'UPDATED', {
    user: serializedUser,
  });

  return res.status(200).json({
    success: true,
    message: 'User berhasil diperbarui',
    data: serializedUser,
  });
});

export const deleteUserHard = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = userIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid user id', 400);
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: paramParsed.data.id },
    select: { id: true, tenantId: true, username: true, email: true, role: true },
  });

  if (!existingUser) {
    throw new AppError('User not found', 404);
  }

  if (!canManageTargetUser(req, existingUser)) {
    throw new AppError('You do not have permission to delete this user', 403);
  }

  await UserService.deleteUserHard(paramParsed.data.id);

  emitUserChanged(req, existingUser.tenantId, 'DELETED', {
    user: existingUser,
  });

  return res.status(200).json({
    success: true,
    message: 'User berhasil dihapus permanen',
  });
});

export const syncPosUsers = asyncHandler(async (req: Request, res: Response) => {
  const parsed = syncPosUsersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Payload sync POS tidak valid', 400);
  }

  if (parsed.data.tenantId) {
    const summary = await UserService.syncTenantUsersToPos(parsed.data.tenantId);

    emitUserChanged(req, parsed.data.tenantId, 'SYNCED', {
      summary,
    });

    return res.status(200).json({
      success: true,
      message: 'Sync user admin panel ke auth POS selesai untuk tenant',
      data: summary,
    });
  }

  const summaries = await UserService.syncAllTenantUsersToPos();

  return res.status(200).json({
    success: true,
    message: 'Sync user admin panel ke auth POS selesai untuk semua tenant',
    data: summaries,
  });
});
