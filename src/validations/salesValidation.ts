import { z } from 'zod';

const decimalLikeSchema = z.union([z.number(), z.string().trim().min(1)]);
const bigintLikeSchema = z.union([z.number().int(), z.string().trim().regex(/^[-]?\d+$/)]);

const saleItemSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  productName: z.string().trim().min(1).optional(),
  qty: z.coerce.number().int().min(1).default(1),
  note: z.string().trim().min(1).optional().nullable(),
  isService: z.boolean().optional().default(false),
  isCustomItem: z.boolean().optional().default(false),
  customName: z.string().trim().min(1).optional().nullable(),
  customPrice: decimalLikeSchema.optional().nullable(),
}).superRefine((item, ctx) => {
  if (item.isCustomItem) {
    if (!item.customName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'customName wajib diisi untuk custom item',
        path: ['customName'],
      });
    }

    if (item.customPrice === undefined || item.customPrice === null || item.customPrice === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'customPrice wajib diisi untuk custom item',
        path: ['customPrice'],
      });
    }
  }

  if (!item.isCustomItem && !item.productName && !item.productId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'productId atau productName wajib diisi untuk item standar',
      path: ['productId'],
    });
  }
});

export const createSaleSchema = z.object({
  referenceId: z.string().trim().min(1).optional(),
  paymentMethod: z.string().trim().min(1).optional().nullable(),
  paymentType: z.string().trim().min(1).optional().nullable(),
  branchId: bigintLikeSchema.optional().nullable(),
  shiftId: bigintLikeSchema.optional().nullable(),
  orderType: z.enum(['WALK_IN', 'PRE_ORDER', 'DELIVERY']).optional(),
  orderStatus: z.enum(['PENDING', 'PREPARING', 'READY_FOR_PICKUP', 'COMPLETED', 'CANCELLED']).optional(),
  pickupDate: z.union([z.coerce.date(), z.string().datetime()]).optional().nullable(),
  targetPickupBranchId: bigintLikeSchema.optional().nullable(),
  totalPrice: decimalLikeSchema.optional().nullable(),
  totalAmount: decimalLikeSchema.optional().nullable(),
  remainingBalance: decimalLikeSchema.optional().nullable(),
  outstandingBalance: decimalLikeSchema.optional().nullable(),
  receiptNumber: z.string().trim().min(1).optional().nullable(),
  cashierId: z.string().trim().min(1).optional().nullable(),
  cashierName: z.string().trim().min(1).optional().nullable(),
  paymentStatus: z.string().trim().min(1).optional().nullable(),
  customerName: z.string().trim().min(1).optional().nullable(),
  totalDiscount: bigintLikeSchema.optional().nullable(),
  totalTax: bigintLikeSchema.optional().nullable(),
  totalProfit: bigintLikeSchema.optional().nullable(),
  amountPaid: decimalLikeSchema.optional().nullable(),
  items: z.array(saleItemSchema).min(1, 'At least one sale item is required'),
}).superRefine((data, ctx) => {
  if (data.orderType === 'PRE_ORDER' && !data.pickupDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'pickupDate wajib diisi untuk PRE_ORDER',
      path: ['pickupDate'],
    });
  }
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;