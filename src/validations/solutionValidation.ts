import { z } from 'zod';

export const createSolutionSchema = z.object({
  name: z.string().min(2, 'Solution name must be at least 2 characters'),
  code: z
    .string()
    .min(2, 'Code must be at least 2 characters')
    .regex(/^[A-Z0-9_]+$/, 'Code can only contain uppercase letters, numbers, and underscore'),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const updateSolutionSchema = z.object({
  name: z.string().min(2, 'Solution name must be at least 2 characters').optional(),
  code: z
    .string()
    .min(2, 'Code must be at least 2 characters')
    .regex(/^[A-Z0-9_]+$/, 'Code can only contain uppercase letters, numbers, and underscore')
    .optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const solutionIdParamSchema = z.object({
  id: z.string().uuid('Solution id must be a valid UUID'),
});

export const listSolutionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  isActive: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});
