import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { SolutionService } from '../services/solutionService';
import {
  createSolutionSchema,
  listSolutionsQuerySchema,
  solutionIdParamSchema,
  updateSolutionSchema,
} from '../validations/solutionValidation';

export const createSolution = asyncHandler(async (req: Request, res: Response) => {
  const bodyParsed = createSolutionSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid solution payload', 400);
  }

  try {
    const solution = await SolutionService.create(bodyParsed.data);

    return res.status(201).json({
      success: true,
      message: 'Solution created successfully',
      data: solution,
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('Solution code must be unique', 409);
    }

    throw error;
  }
});

export const getSolutions = asyncHandler(async (req: Request, res: Response) => {
  const queryParsed = listSolutionsQuerySchema.safeParse(req.query);
  if (!queryParsed.success) {
    throw new AppError(queryParsed.error.issues[0]?.message ?? 'Invalid query params', 400);
  }

  const result = await SolutionService.list(queryParsed.data);

  return res.status(200).json({
    success: true,
    data: result.items,
    meta: result.meta,
  });
});

export const updateSolution = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = solutionIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid solution id', 400);
  }

  const bodyParsed = updateSolutionSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    throw new AppError(bodyParsed.error.issues[0]?.message ?? 'Invalid solution payload', 400);
  }

  const existing = await SolutionService.getById(paramParsed.data.id);
  if (!existing) {
    throw new AppError('Solution not found', 404);
  }

  try {
    const updated = await SolutionService.update(paramParsed.data.id, bodyParsed.data);

    return res.status(200).json({
      success: true,
      message: 'Solution updated successfully',
      data: updated,
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('Solution code must be unique', 409);
    }

    throw error;
  }
});

export const deleteSolution = asyncHandler(async (req: Request, res: Response) => {
  const paramParsed = solutionIdParamSchema.safeParse(req.params);
  if (!paramParsed.success) {
    throw new AppError(paramParsed.error.issues[0]?.message ?? 'Invalid solution id', 400);
  }

  const existing = await SolutionService.getById(paramParsed.data.id);
  if (!existing) {
    throw new AppError('Solution not found', 404);
  }

  try {
    await SolutionService.remove(paramParsed.data.id);

    return res.status(200).json({
      success: true,
      message: 'Solution deleted successfully',
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw new AppError('Solution is still used by app instances', 409);
    }

    throw error;
  }
});
