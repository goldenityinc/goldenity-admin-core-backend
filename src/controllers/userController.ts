import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import {
  createUserSchema,
  listUsersQuerySchema,
  tenantIdParamSchema,
} from '../validations/tenantValidation';
import { UserService } from '../services/userService';

export const createTenantUser = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = tenantIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid tenantId', 400);
  }

  const bodyParsed = createUserSchema.safeParse({
    ...req.body,
    tenantId: paramParsed.data.tenantId,
  });
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid user payload', 400);
  }

  try {
    const createdUser = await UserService.createTenantUser(bodyParsed.data);

    return res.status(201).json({
      success: true,
      message: 'Tenant user created successfully',
      data: createdUser,
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
    data: result.items,
    meta: result.meta,
  });
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const bodyParsed = createUserSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid user payload', 400);
  }

  try {
    const createdUser = await UserService.createTenantUser(bodyParsed.data);

    return res.status(201).json({
      success: true,
      message: 'Tenant user created successfully',
      data: createdUser,
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
  const queryParsed = listUsersQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    throw new AppError(queryParsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const result = await UserService.listUsers(queryParsed.data);

  return res.status(200).json({
    success: true,
    data: result.items,
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

  const updatedUser = await UserService.resetUserPassword(id, newPassword);

  return res.status(200).json({
    success: true,
    message: 'Password berhasil direset',
    data: updatedUser,
  });
});
