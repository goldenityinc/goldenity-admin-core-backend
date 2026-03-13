import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z.string().min(2, 'Tenant name must be at least 2 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and dashes')
    .optional(),
  email: z.string().email('Invalid tenant email').optional(),
  phone: z.string().min(6, 'Phone must be at least 6 characters').optional(),
  address: z.string().min(5, 'Address must be at least 5 characters').optional(),
  adminEmail: z.string().email('Invalid admin email'),
  adminPassword: z.string().min(8, 'Admin password must be at least 8 characters'),
  isActive: z.boolean().optional(),
});

export const createUserSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-z0-9._-]+$/, 'Username must be lowercase and cannot contain spaces'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'User name must be at least 2 characters'),
  role: z.enum(['TENANT_ADMIN', 'CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY']).optional(),
  isActive: z.boolean().optional(),
});

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().optional(),
  tenantId: z.string().uuid('tenantId must be a valid UUID').optional(),
});

export const syncPosUsersSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID').optional(),
});
