import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { TableService } from '../services/tableService';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

function parseTableId(rawId: unknown): bigint {
  const text = (rawId ?? '').toString().trim();
  if (!/^\d+$/.test(text)) {
    throw new AppError('ID meja tidak valid', 400);
  }
  return BigInt(text);
}

export const listTables = asyncHandler(async (req: Request, res: Response) => {
  const records = await TableService.listTables(readTenantId(req));
  return res.status(200).json({
    success: true,
    data: serializeForJson(records),
  });
});

export const createTable = asyncHandler(async (req: Request, res: Response) => {
  const record = await TableService.createTable(readTenantId(req), {
    tableNumber: req.body.tableNumber ?? req.body.table_number,
    capacity: req.body.capacity,
    status: req.body.status,
  });

  return res.status(201).json({
    success: true,
    data: serializeForJson(record),
  });
});

export const patchTable = asyncHandler(async (req: Request, res: Response) => {
  const id = parseTableId(req.params.id);
  const record = await TableService.updateTable(readTenantId(req), id, {
    tableNumber: req.body.tableNumber ?? req.body.table_number,
    capacity: req.body.capacity,
    status: req.body.status,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(record),
  });
});

export const deleteTable = asyncHandler(async (req: Request, res: Response) => {
  const id = parseTableId(req.params.id);
  await TableService.deleteTable(readTenantId(req), id);

  return res.status(200).json({
    success: true,
    message: 'Meja berhasil dihapus',
  });
});
