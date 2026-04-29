import { z } from 'zod';

const bigintLikeSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value === '') {
      return value;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    return value;
  },
  z.union([
    z.string().regex(/^\d+$/, 'branchId must be a numeric string'),
    z.null(),
  ]),
);

const optionalText = z.string().trim().min(1).optional().nullable();

export const createProductSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, 'Product name is required'),
  branchId: bigintLikeSchema.optional(),
  barcode: optionalText,
  category: optionalText,
  price: z.number().finite().nonnegative().optional(),
  purchasePrice: z.number().finite().nonnegative().optional().nullable(),
  stock: z.number().int().nonnegative().optional(),
  isService: z.boolean().optional(),
  supplierName: optionalText,
  imageUrl: optionalText,
  isActive: z.boolean().optional(),
  referenceId: optionalText,
});

export const updateProductSchema = createProductSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  {
    message: 'At least one field must be provided',
  },
);

export const assignProductBranchSchema = z.object({
  branchId: z.string().regex(/^\d+$/, 'branchId must be a numeric string'),
});
