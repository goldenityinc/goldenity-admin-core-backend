import { z } from 'zod';

const nonEmptyString = z.string().min(1, 'Harus diisi').trim();
const optionalText = z.string().optional().nullable();

export const createIncomeSchema = z.object({
  title: nonEmptyString.describe('Judul pemasukan'),
  category: nonEmptyString.describe('Kategori pemasukan'),
  branchId: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .optional()
    .describe('ID cabang pemasukan'),
  income_date: z
    .string()
    .datetime()
    .describe('Tanggal pemasukan (ISO 8601 format)'),
  amount: z
    .union([z.number().min(0), z.string().regex(/^\d+(\.\d+)?$/)])
    .transform((val) => Number(val))
    .refine((val) => val >= 0, 'Amount tidak boleh negatif'),
  pic_name: z.string().trim().optional().describe('Nama PIC pemasukan'),
  payment_status: z
    .enum(['Paid', 'NotPaid'])
    .optional()
    .describe('Status pembayaran pemasukan'),
  notes: optionalText.describe('Catatan pemasukan'),
  attachment_url: optionalText.describe('URL lampiran pemasukan (legacy)'),
  attachments: z
    .array(
      z.object({
        url: z.string().min(1, 'URL lampiran wajib diisi'),
        caption: z.string().trim().optional(),
      })
    )
    .optional()
    .describe('Daftar lampiran pemasukan'),
  status: z
    .enum(['ACTIVE', 'VOID', 'PENDING'])
    .default('ACTIVE')
    .describe('Status pemasukan'),
});

export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;

export const updateIncomeSchema = createIncomeSchema.partial();

export type UpdateIncomeInput = z.infer<typeof updateIncomeSchema>;

export const setPaymentStatusSchema = z.object({
  payment_status: z
    .enum(['Paid', 'NotPaid'])
    .describe('Status pembayaran pemasukan'),
});

export type SetPaymentStatusInput = z.infer<typeof setPaymentStatusSchema>;
