import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { BranchService } from '../services/branchService';
import {
  branchIdParamSchema,
  createBranchSchema,
  updateBranchSchema,
} from '../validations/branchValidation';
import { serializeForJson } from '../utils/serializeForJson';

function readTenantId(req: Request): string {
  const tenantId = req.params.tenantId || req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }

  return tenantId;
}

function parseBranchId(rawId: string): bigint {
  return BigInt(rawId);
}

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const parsed = createBranchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Invalid branch payload', 400);
  }

  const branch = await BranchService.createBranch(readTenantId(req), parsed.data);

  return res.status(201).json({
    success: true,
    message: 'Branch created successfully',
    data: serializeForJson(branch),
  });
});

export const listBranches = asyncHandler(async (req: Request, res: Response) => {
  const branches = await BranchService.listBranches(readTenantId(req));

  return res.status(200).json({
    success: true,
    data: serializeForJson(branches),
  });
});

export const getBranch = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = branchIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid branch id', 400);
  }

  const branch = await BranchService.getBranchById(
    readTenantId(req),
    parseBranchId(paramParsed.data.id),
  );

  return res.status(200).json({
    success: true,
    data: serializeForJson(branch),
  });
});

export const updateBranch = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = branchIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid branch id', 400);
  }

  const bodyParsed = updateBranchSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid branch payload', 400);
  }

  const branch = await BranchService.updateBranch(
    readTenantId(req),
    parseBranchId(paramParsed.data.id),
    bodyParsed.data,
  );

  return res.status(200).json({
    success: true,
    message: 'Branch updated successfully',
    data: serializeForJson(branch),
  });
});

export const deleteBranch = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = branchIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid branch id', 400);
  }

  await BranchService.deleteBranch(readTenantId(req), parseBranchId(paramParsed.data.id));

  return res.status(200).json({
    success: true,
    message: 'Branch deleted successfully',
  });
});