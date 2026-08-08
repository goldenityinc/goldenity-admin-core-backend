import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { serializeForJson } from '../utils/serializeForJson';
import { TableService, __tableBranchParseHelper } from '../services/tableService';
import { emitToBranch, emitToTenant } from '../services/socketServer';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

// 🔴 CRITICAL FIX (Cross-Branch Contamination):
//    Extract branch_id dari request (user context, query, body, headers).
//    Semua endpoint table WAJIB isolasi per branch. Strategy fallback:
//      1. req.user.branchId  (dari JWT token login cabang)
//      2. req.query.branch_id / eq__branch_id (Flutter table_management_screen L413-414)
//      3. req.body.branch_id / branchId
//      4. req.headers['x-branch-id']
function readBranchId(req: Request): bigint | null {
  const fromUser = req.user?.branchId;
  const fromQuery = (req.query as Record<string, unknown>)?.branch_id
    ?? (req.query as Record<string, unknown>)?.['eq__branch_id']
    ?? (req.query as Record<string, unknown>)?.branchId;
  const fromBody = (req.body as Record<string, unknown>)?.branch_id
    ?? (req.body as Record<string, unknown>)?.branchId;
  const fromHeader = req.headers['x-branch-id'];

  const raw = fromUser ?? fromQuery ?? fromBody ?? fromHeader;
  return __tableBranchParseHelper.parseBranchId(raw);
}

function parseTableId(rawId: unknown): bigint {
  const text = (rawId ?? '').toString().trim();
  if (!/^\d+$/.test(text)) {
    throw new AppError('ID meja tidak valid', 400);
  }
  return BigInt(text);
}

// Broadcast table update ke TARGET BRANCH ONLY (bukan seluruh tenant).
// Ini mencegah user cabang B refresh table UI saat user cabang A update table.
function broadcastTableChanged(
  tenantId: string,
  branchId: bigint | null,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  try {
    if (branchId != null) {
      emitToBranch(tenantId, branchId, eventName, payload);
    }
  } catch (_err) { /* ignore emitter error */ }
  try {
    // HQ / SUPER_ADMIN tidak punya branch, fallback ke tenant scope
    // (tapi client side filter _isRowInScope tetap berjalan di Flutter)
    emitToTenant(tenantId, eventName, payload);
  } catch (_err) { /* ignore */ }
}

export const listTables = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = readBranchId(req);
  const records = await TableService.listTables(tenantId, branchId);
  return res.status(200).json({
    success: true,
    data: serializeForJson(records),
  });
});

export const createTable = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = readBranchId(req);
  const record = await TableService.createTable(tenantId, branchId, {
    tableNumber: req.body.tableNumber ?? req.body.table_number,
    capacity: req.body.capacity,
    status: req.body.status,
  });

  broadcastTableChanged(tenantId, branchId, 'table_created', {
    table: serializeForJson(record),
    tenantId,
    branchId: branchId?.toString() ?? null,
    branch_id: branchId?.toString() ?? null,
  });

  return res.status(201).json({
    success: true,
    data: serializeForJson(record),
  });
});

export const patchTable = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = readBranchId(req);
  const id = parseTableId(req.params.id);
  const record = await TableService.updateTable(tenantId, branchId, id, {
    tableNumber: req.body.tableNumber ?? req.body.table_number,
    capacity: req.body.capacity,
    status: req.body.status,
  });

  broadcastTableChanged(tenantId, branchId, 'table_updated', {
    table: serializeForJson(record),
    tenantId,
    branchId: branchId?.toString() ?? null,
    branch_id: branchId?.toString() ?? null,
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(record),
  });
});

export const deleteTable = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const branchId = readBranchId(req);
  const id = parseTableId(req.params.id);
  await TableService.deleteTable(tenantId, branchId, id);

  broadcastTableChanged(tenantId, branchId, 'table_deleted', {
    tableId: id.toString(),
    tenantId,
    branchId: branchId?.toString() ?? null,
    branch_id: branchId?.toString() ?? null,
  });

  return res.status(200).json({
    success: true,
    message: 'Meja berhasil dihapus',
  });
});
