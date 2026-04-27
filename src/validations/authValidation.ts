import { z } from 'zod';

// Accept any of the three key conventions that clients may send:
//   camelCase  : tenantSlug        (Flutter default, Core API standard)
//   snake_case : tenant_slug       (Flutter sends this as secondary fallback)
//   Indonesian : kode_perusahaan   (legacy / manual API callers / HTTP test files)
// The transform collapses all three into a single normalised lowercase `tenantSlug`.
export const loginSchema = z
  .object({
    username: z.string().trim().min(1, 'Username wajib diisi'),
    password: z.string().min(1, 'Password wajib diisi'),
    tenantSlug: z.string().trim().min(1).optional(),
    tenant_slug: z.string().trim().min(1).optional(),
    kode_perusahaan: z.string().trim().min(1).optional(),
  })
  .transform((data, ctx) => {
    // Priority: camelCase > snake_case > Indonesian legacy key
    const raw = data.tenantSlug ?? data.tenant_slug ?? data.kode_perusahaan ?? '';
    const resolvedSlug = raw.trim().toLowerCase();
    if (!resolvedSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Kode Perusahaan wajib diisi',
        path: ['tenantSlug'],
      });
      return z.NEVER;
    }
    return { username: data.username, password: data.password, tenantSlug: resolvedSlug };
  });

export type LoginInput = z.infer<typeof loginSchema>;