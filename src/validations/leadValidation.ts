import { z } from 'zod';

export const LEAD_STAGE_VALUES = ['NEW', 'CONTACTED', 'INTERVIEW', 'DEMO', 'TRIAL', 'WON', 'LOST'] as const;

const optionalText = (max = 500) =>
  z.preprocess(
    (value) => {
      if (value === null) return null;
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    },
    z.string().max(max).nullable().optional(),
  );

const optionalInt = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return value === '' ? null : value;
    if (typeof value === 'string') return Number(value.replace(/[^\d-]/g, ''));
    return value;
  },
  z.number().int().min(0).nullable().optional(),
);

const optionalFloat = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return value === '' ? null : value;
    if (typeof value === 'string') return Number(value.replace(',', '.'));
    return value;
  },
  z.number().min(0).max(5).nullable().optional(),
);

const optionalDate = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string' && value.trim() === '') return null;
    return value;
  },
  z.coerce.date().nullable().optional(),
);

export const leadInputSchema = z.object({
  name: z.string().trim().min(1, 'Nama lead wajib diisi').max(200),
  segment: z.string().trim().min(1, 'Segmen wajib diisi').max(40),
  stage: z.enum(LEAD_STAGE_VALUES).optional(),
  tier: optionalText(4),
  score: optionalInt,
  area: optionalText(200),
  address: optionalText(500),
  phone: optionalText(60),
  instagram: optionalText(120),
  rating: optionalFloat,
  reviewCount: optionalInt,
  outletCount: optionalInt,
  source: optionalText(40),
  mapsUrl: optionalText(1000),
  notes: optionalText(4000),
  lostReason: optionalText(500),
  nextFollowUpAt: optionalDate,
  lastContactedAt: optionalDate,
  tenantId: optionalText(100),
});

export const createLeadSchema = leadInputSchema;
export const updateLeadSchema = leadInputSchema.partial();

export const importLeadsSchema = z.object({
  leads: z.array(leadInputSchema).min(1, 'Tidak ada lead untuk diimpor').max(2000, 'Maksimal 2.000 lead per impor'),
});

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  stage: z.enum(LEAD_STAGE_VALUES).optional(),
  segment: z.string().trim().max(40).optional(),
  tier: z.string().trim().max(4).optional(),
  search: z.string().trim().max(200).optional(),
  dueOnly: z
    .preprocess((v) => v === true || v === 'true' || v === '1', z.boolean())
    .optional(),
});

export type LeadInput = z.infer<typeof leadInputSchema>;
