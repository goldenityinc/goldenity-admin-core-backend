import { z } from 'zod';

const decimalLikeSchema = z.union([z.number(), z.string().trim().min(1)]);
const bigintLikeSchema = z.union([z.number().int(), z.string().trim().regex(/^\d+$/)]);

export const openShiftSchema = z.object({
  starting_cash: decimalLikeSchema,
});

export const closeShiftSchema = z.object({
  id: bigintLikeSchema,
  actual_cash: decimalLikeSchema,
  actual_qris: decimalLikeSchema,
  actual_transfer: decimalLikeSchema,
});

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
