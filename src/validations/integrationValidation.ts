import { z } from 'zod';

export const provisionErpSchema = z.object({
  tenantId: z.string().uuid('tenantId harus UUID'),
  organizationId: z.string().min(2).max(50).optional(),
  organizationName: z.string().min(1).max(120).optional(),
  features: z.array(z.string().min(1).max(50)).max(50).optional(),
  logoUrl: z.string().url('logoUrl harus berupa URL valid').max(500).optional(),
  adminEmail: z.string().email('adminEmail harus berupa email valid').optional(),
  adminPassword: z.string().min(6, 'adminPassword minimal 6 karakter').max(100).optional(),
  adminName: z.string().min(1).max(120).optional(),
});

export type ProvisionErpInput = z.infer<typeof provisionErpSchema>;
