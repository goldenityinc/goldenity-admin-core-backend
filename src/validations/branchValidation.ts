import { z } from 'zod';

export const branchIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Branch id must be a numeric string'),
});

export const createBranchSchema = z.object({
  name: z.string().trim().min(2, 'Branch name must be at least 2 characters'),
  address: z.string().trim().min(5, 'Address must be at least 5 characters').optional().nullable(),
  phone: z.string().trim().min(6, 'Phone must be at least 6 characters').optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateBranchSchema = z.object({
  name: z.string().trim().min(2, 'Branch name must be at least 2 characters').optional(),
  address: z.string().trim().min(5, 'Address must be at least 5 characters').optional().nullable(),
  phone: z.string().trim().min(6, 'Phone must be at least 6 characters').optional().nullable(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});