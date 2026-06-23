import { z } from 'zod';
import { BUSINESS_CATEGORY_VALUES } from '../constants/businessCategory';

const optionalTrimmedString = () =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string') {
        return value;
      }

      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    },
    z.string().optional(),
  );

const optionalDecimalInput = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        return undefined;
      }
      return Number(trimmed);
    }

    return value;
  },
  z.number().min(0, 'Nilai tidak boleh negatif').optional(),
);

const optionalNullableBranchIdSchema = z.preprocess(
  (value) => {
    if (value === null) {
      return null;
    }

    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z.union([z.string().regex(/^\d+$/, 'branchId must be a numeric string'), z.null()]).optional(),
);

export const createTenantSchema = z.object({
  name: z.string().min(2, 'Tenant name must be at least 2 characters'),
  businessCategory: z.enum(BUSINESS_CATEGORY_VALUES).optional(),
  solution: optionalTrimmedString().pipe(z.string().optional()),
  subscriptionType: optionalTrimmedString().pipe(z.string().optional()),
  branchName: optionalTrimmedString().pipe(
    z.string().min(2, 'Branch name must be at least 2 characters').optional(),
  ),
  firstBranchName: optionalTrimmedString().pipe(
    z.string().min(2, 'First branch name must be at least 2 characters').optional(),
  ),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and dashes')
    .optional(),
  email: optionalTrimmedString().pipe(z.string().email('Invalid tenant email').optional()),
  phone: optionalTrimmedString().pipe(z.string().min(6, 'Phone must be at least 6 characters').optional()),
  address: optionalTrimmedString().pipe(z.string().min(5, 'Address must be at least 5 characters').optional()),
  logoUrl: optionalTrimmedString().pipe(
    z.string().url('logoUrl harus berupa URL valid').max(500).optional(),
  ),
  adminEmail: optionalTrimmedString().pipe(z.string().email('Invalid admin email').optional()),
  adminPassword: optionalTrimmedString().pipe(
    z.string().min(8, 'Admin password must be at least 8 characters').optional(),
  ),
  isActive: z.boolean().optional(),
  showInventoryImages: z.boolean().optional(),
}).refine(
  (data) => Boolean(data.adminEmail) === Boolean(data.adminPassword),
  {
    message: 'adminEmail dan adminPassword harus sama-sama diisi atau sama-sama kosong',
    path: ['adminEmail'],
  },
);

export const updateTenantSchema = z.object({
  name: z.string().min(2, 'Tenant name must be at least 2 characters').optional(),
  businessCategory: z.enum(BUSINESS_CATEGORY_VALUES).optional(),
  email: z.string().email('Invalid tenant email').optional().nullable(),
  phone: z.string().min(6, 'Phone must be at least 6 characters').optional().nullable(),
  address: z.string().min(5, 'Address must be at least 5 characters').optional().nullable(),
  isActive: z.boolean().optional(),
  showInventoryImages: z.boolean().optional(),
});

export const createUserSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .regex(/^[a-z0-9._-]+$/, 'Username must be lowercase and cannot contain spaces')
    .optional(),
  email: z.string().email('Invalid user email').optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'User name must be at least 2 characters'),
  employeeType: optionalTrimmedString().pipe(
    z.string().min(2, 'employeeType must be at least 2 characters').optional(),
  ),
  baseSalary: optionalDecimalInput,
  commissionRate: optionalDecimalInput,
  role: z.enum(['TENANT_ADMIN', 'CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY']).optional(),
  branchId: optionalNullableBranchIdSchema,
  isActive: z.boolean().optional(),
})
  .refine((data) => Boolean(data.username || data.email), {
    message: 'username atau email wajib diisi',
    path: ['username'],
  })
  .refine(
    (data) => {
      const role = (data.role ?? 'TENANT_ADMIN').toString().toUpperCase();
      // ERP tenant admins require stronger password (min 8).
      if (role === 'TENANT_ADMIN' && data.email) {
        return typeof data.password === 'string' && data.password.length >= 8;
      }
      return true;
    },
    {
      message: 'Password minimal 8 karakter untuk TENANT_ADMIN (ERP login)',
      path: ['password'],
    },
  );

export const updateUserSchema = z.object({
  role: z.enum(['TENANT_ADMIN', 'CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY']).optional(),
  branchId: optionalNullableBranchIdSchema,
  employeeType: optionalTrimmedString().pipe(
    z.string().min(2, 'employeeType must be at least 2 characters').optional(),
  ),
  baseSalary: optionalDecimalInput,
  commissionRate: optionalDecimalInput,
}).refine(
    (data) =>
      data.role !== undefined ||
      data.branchId !== undefined ||
      data.employeeType !== undefined ||
      data.baseSalary !== undefined ||
      data.commissionRate !== undefined,
    {
      message: 'Minimal satu field harus diisi',
      path: ['role'],
    },
  );

export const tenantIdParamSchema = z.object({
  tenantId: z.string().uuid('tenantId must be a valid UUID'),
});

export const userIdParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
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

export const updateUserStatusSchema = z.object({
  isActive: z.boolean({
    required_error: 'isActive is required',
    invalid_type_error: 'isActive must be a boolean',
  }),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(['TENANT_ADMIN', 'CRM_MANAGER', 'CRM_STAFF', 'READ_ONLY'], {
    required_error: 'role is required',
    invalid_type_error: 'role must be a valid role',
  }),
});
