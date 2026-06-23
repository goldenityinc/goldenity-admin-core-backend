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

const optionalBooleanLike = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().optional());

export const createProductSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1, 'Product name is required'),
  unit: optionalText,
  unitName: optionalText,
  unit_name: optionalText,
  branchId: bigintLikeSchema.optional(),
  branch_id: bigintLikeSchema.optional(),
  barcode: optionalText,
  category: optionalText,
  categoryId: bigintLikeSchema.optional(),
  category_id: bigintLikeSchema.optional(),
  price: z.number().finite().nonnegative().optional(),
  purchasePrice: z.number().finite().nonnegative().optional().nullable(),
  purchase_price: z.number().finite().nonnegative().optional().nullable(),
  stock: z.number().int().nonnegative().optional(),
  isService: z.boolean().optional(),
  is_service: z.boolean().optional(),
  supplierName: optionalText,
  supplier_name: optionalText,
  imageUrl: optionalText,
  image_url: optionalText,
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
  referenceId: optionalText,
  reference_id: optionalText,
});

export const updateProductSchema = createProductSchema.partial().extend({
  branch_id: bigintLikeSchema.optional(),
  is_available: optionalBooleanLike,
  isAvailable: optionalBooleanLike,
  is_active: optionalBooleanLike,
}).refine(
  (data) => Object.keys(data).length > 0,
  {
    message: 'At least one field must be provided',
  },
);

export const assignProductBranchSchema = z.object({
  branchId: z.string().regex(/^\d+$/, 'branchId must be a numeric string'),
});
