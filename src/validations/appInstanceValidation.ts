import { z } from 'zod';

export const createAppInstanceSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
  solutionId: z.string().uuid('solutionId must be a valid UUID'),
  tier: z.enum(['Standard', 'Professional', 'Enterprise', 'Custom']),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  dbConnectionString: z.string().url('dbConnectionString must be a valid URL').optional().nullable(),
  appUrl: z.string().url('appUrl must be a valid URL').optional().nullable(),
  endDate: z
    .union([
      z.string().datetime({ message: 'endDate must be a valid ISO datetime' }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be a valid date (YYYY-MM-DD)'),
    ])
    .optional()
    .nullable(),
});

export const updateAppInstanceSchema = z.object({
  tier: z.enum(['Standard', 'Professional', 'Enterprise', 'Custom']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  dbConnectionString: z.string().url('dbConnectionString must be a valid URL').optional().nullable(),
  appUrl: z.string().url('appUrl must be a valid URL').optional().nullable(),
  endDate: z
    .union([
      z.string().datetime({ message: 'endDate must be a valid ISO datetime' }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be a valid date (YYYY-MM-DD)'),
    ])
    .optional()
    .nullable(),
});

export const appInstanceIdParamSchema = z.object({
  id: z.string().uuid('AppInstance id must be a valid UUID'),
});

export const listAppInstancesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  tenantId: z.string().uuid().optional(),
  solutionId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  tier: z.enum(['Standard', 'Professional', 'Enterprise', 'Custom']).optional(),
});
