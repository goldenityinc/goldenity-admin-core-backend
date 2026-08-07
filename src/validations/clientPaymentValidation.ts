import { z } from 'zod';

export const paymentStatusEnum = z.enum(['Paid', 'NotPaid']);

export type PaymentStatus = z.infer<typeof paymentStatusEnum>;

export const upsertClientPaymentCellSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== 'object') return value;
    const obj = value as Record<string, unknown>;
    const aliases: Record<string, string> = {
      client_id: 'clientId',
      customer_id: 'clientId',
      product_id: 'productId',
      period_month: 'periodMonth',
      period_year: 'periodYear',
      payment_status: 'status',
      receipt_images: 'receiptImages',
      amount_idr: 'amount',
      total_amount: 'amount',
      note: 'notes',
    };
    const result: Record<string, unknown> = { ...obj };
    for (const [from, to] of Object.entries(aliases)) {
      if (from in result && !(to in result)) {
        result[to] = result[from];
      }
    }
    if (typeof result.status === 'string') {
      const s = (result.status as string).toString().trim().replace(/[\s_-]+/g, '');
      if (s.toLowerCase() === 'paid') result.status = 'Paid';
      else if (s.toLowerCase() === 'notpaid' || s.toLowerCase() === 'unpaid' || s.toLowerCase() === 'pending') result.status = 'NotPaid';
    }
    if (typeof result.receiptImages === 'string') {
      const raw = (result.receiptImages as string).trim();
      if (raw === '') result.receiptImages = [];
      else {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            result.receiptImages = parsed.filter((x) => typeof x === 'string' && x.trim() !== '');
          } else if (typeof parsed === 'string') {
            result.receiptImages = [parsed];
          }
        } catch {
          result.receiptImages = [raw].filter((x) => x.trim() !== '');
        }
      }
    }
    if (result.amount === undefined || result.amount === null) {
      if (result.amountIDR !== undefined && result.amountIDR !== null) result.amount = result.amountIDR;
      else if (result.amount_idr !== undefined && result.amount_idr !== null) result.amount = result.amount_idr;
    }
    return result;
  },
  z.object({
    clientId: z.union([
      z.number().int(),
      z.string().min(1, 'clientId tidak boleh kosong'),
      z.bigint(),
    ]).transform((val) => (typeof val === 'bigint' ? val.toString() : val)),
    productId: z
      .string()
      .min(1, 'productId tidak boleh kosong')
      .describe('ID produk/layanan (bisa string UUID/sku/kode internal)'),
    periodMonth: z
      .union([z.number().int(), z.string().regex(/^\d+$/)])
      .transform((val) => Number(val))
      .refine((val) => val >= 1 && val <= 12, 'periodMonth harus 1 sampai 12')
      .describe('Bulan periode (1-12)'),
    periodYear: z
      .union([z.number().int(), z.string().regex(/^\d+$/)])
      .transform((val) => Number(val))
      .refine((val) => val >= 2000 && val <= 2100, 'periodYear tidak valid')
      .describe('Tahun periode'),
    status: paymentStatusEnum
      .default('NotPaid')
      .describe('Status pembayaran'),
    amount: z
      .union([
        z.number().min(0),
        z.string().regex(/^\d+(\.\d+)?$/).transform((val) => Number(val)),
      ])
      .refine((val) => val >= 0, 'amount harus >= 0')
      .describe('Jumlah nominal pembayaran'),
    receiptImages: z
      .array(z.string().min(1, 'Setiap gambar receiptImages tidak boleh kosong'))
      .default([])
      .describe('Array URL gambar bukti pembayaran'),
    notes: z.string().optional().nullable().describe('Catatan opsional'),
  })
);

export type UpsertClientPaymentCellInput = z.infer<typeof upsertClientPaymentCellSchema>;

export const matrixQuerySchema = z.object({
  year: z
    .union([z.number().int(), z.string().regex(/^\d+$/)])
    .transform((val) => Number(val))
    .refine((val) => val >= 2000 && val <= 2100, 'year tidak valid')
    .describe('Tahun untuk matrix pembayaran'),
  productId: z
    .string()
    .min(1, 'productId filter tidak boleh kosong')
    .optional()
    .describe('Filter opsional berdasarkan productId (UUID/sku/kode)'),
});

export type MatrixQueryInput = z.infer<typeof matrixQuerySchema>;
