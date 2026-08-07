import { z } from 'zod';

const nonEmptyString = z.string().min(1, 'Harus diisi').trim();
const optionalText = z.string().optional().nullable();

export const createExpenseSchema = z.object({
  title: nonEmptyString.describe('Judul pengeluaran'),
  category: nonEmptyString.describe('Kategori pengeluaran'),
  branchId: z
    .union([z.number().int().positive(), z.string().regex(/^\d+$/)])
    .optional()
    .describe('ID cabang pengeluaran'),
  expense_date: z
    .string()
    .datetime()
    .describe('Tanggal pengeluaran (ISO 8601 format)'),
  amount: z
    .union([z.number().min(0), z.string().regex(/^\d+(\.\d+)?$/)])
    .transform((val) => Number(val))
    .refine((val) => val >= 0, 'Amount tidak boleh negatif'),
  pic_name: z.string().trim().optional().describe('Nama PIC pengeluaran'),
  payment_status: z
    .enum(['Paid', 'NotPaid'])
    .optional()
    .describe('Status pembayaran pengeluaran'),
  notes: optionalText.describe('Catatan pengeluaran'),
  attachment_url: optionalText.describe('URL lampiran pengeluaran (legacy)'),
  attachments: z
    .array(
      z.object({
        url: z.string().min(1, 'URL lampiran wajib diisi'),
        caption: z.string().trim().optional(),
      })
    )
    .optional()
    .describe('Daftar lampiran pengeluaran'),
  status: z
    .enum(['ACTIVE', 'VOID', 'PENDING'])
    .default('ACTIVE')
    .describe('Status pengeluaran'),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const setPaymentStatusSchema = z.object({
  payment_status: z
    .enum(['Paid', 'NotPaid'])
    .describe('Status pembayaran pengeluaran'),
});

export type SetPaymentStatusInput = z.infer<typeof setPaymentStatusSchema>;
