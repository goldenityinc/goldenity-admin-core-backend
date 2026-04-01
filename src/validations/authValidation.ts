import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi'),
  tenantSlug: z.string().trim().min(1, 'Kode Perusahaan wajib diisi'),
});

export type LoginInput = z.infer<typeof loginSchema>;