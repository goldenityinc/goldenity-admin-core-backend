import { z } from 'zod';

const nonEmptyString = z.string().min(1, 'Harus diisi').trim();
const optionalText = z.string().optional().nullable();

export const createExpenseSchema = z.object({
  title: nonEmptyString.describe('Judul pengeluaran'),
  category: nonEmptyString.describe('Kategori pengeluaran'),
  expense_date: z
    .string()
    .datetime()
    .describe('Tanggal pengeluaran (ISO 8601 format)'),
  amount: z
    .union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)])
    .transform((val) => Number(val))
    .refine((val) => val > 0, 'Amount harus lebih dari 0'),
  notes: optionalText.describe('Catatan pengeluaran'),
  status: z
    .enum(['ACTIVE', 'VOID', 'PENDING'])
    .default('ACTIVE')
    .describe('Status pengeluaran'),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
