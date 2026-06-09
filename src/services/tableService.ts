import prisma from '../config/database';
import { AppError } from '../utils/AppError';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';

type TableRow = {
  id: bigint;
  tenant_id: string;
  table_number: string;
  capacity: number;
  status: TableStatus;
  created_at: Date;
  updated_at: Date;
};

const VALID_TABLE_STATUSES = new Set<TableStatus>([
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
]);

function parseTableStatus(value: unknown): TableStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase() as TableStatus;
  if (!VALID_TABLE_STATUSES.has(normalized)) {
    throw new AppError(`Status meja tidak valid: ${value}`, 400);
  }
  return normalized;
}

function parseCapacity(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new AppError('Capacity harus berupa angka bulat > 0', 400);
  }
  return numeric;
}

export class TableService {
  static async listTables(tenantId: string): Promise<TableRow[]> {
    const rows = await prisma.$queryRaw<TableRow[]>`
      SELECT id, tenant_id, table_number, capacity, status, created_at, updated_at
      FROM tables
      WHERE tenant_id = ${tenantId}
      ORDER BY table_number ASC
    `;

    return rows;
  }

  static async createTable(
    tenantId: string,
    payload: { tableNumber?: unknown; capacity?: unknown; status?: unknown },
  ): Promise<TableRow> {
    const tableNumber = (payload.tableNumber ?? '').toString().trim();
    if (!tableNumber) {
      throw new AppError('tableNumber wajib diisi', 400);
    }

    const capacity = parseCapacity(payload.capacity);
    if (capacity === undefined) {
      throw new AppError('capacity wajib diisi', 400);
    }

    const status = parseTableStatus(payload.status) ?? 'AVAILABLE';

    try {
      const rows = await prisma.$queryRaw<TableRow[]>`
        INSERT INTO tables (tenant_id, table_number, capacity, status)
        VALUES (${tenantId}, ${tableNumber}, ${capacity}, ${status}::"TableStatus")
        RETURNING id, tenant_id, table_number, capacity, status, created_at, updated_at
      `;

      if (!rows[0]) {
        throw new AppError('Gagal membuat meja', 500);
      }

      return rows[0];
    } catch (error: unknown) {
      const message = (error as Error)?.message ?? '';
      if (message.toLowerCase().includes('unique')) {
        throw new AppError('Nomor meja sudah digunakan pada tenant ini', 409);
      }
      throw error;
    }
  }

  static async updateTable(
    tenantId: string,
    id: bigint,
    payload: { tableNumber?: unknown; capacity?: unknown; status?: unknown },
  ): Promise<TableRow> {
    const updates: Array<{ column: string; value: unknown; cast?: string }> = [];

    if (payload.tableNumber !== undefined) {
      if (payload.tableNumber === null) {
        throw new AppError('tableNumber tidak boleh kosong', 400);
      }
      const tableNumber = payload.tableNumber.toString().trim();
      if (!tableNumber) {
        throw new AppError('tableNumber tidak boleh kosong', 400);
      }
      updates.push({ column: 'table_number', value: tableNumber });
    }

    if (payload.capacity !== undefined) {
      const capacity = parseCapacity(payload.capacity);
      if (capacity === undefined) {
        throw new AppError('capacity tidak valid', 400);
      }
      updates.push({ column: 'capacity', value: capacity });
    }

    if (payload.status !== undefined) {
      const status = parseTableStatus(payload.status);
      if (!status) {
        throw new AppError('status tidak valid', 400);
      }
      updates.push({ column: 'status', value: status, cast: '::"TableStatus"' });
    }

    if (updates.length === 0) {
      throw new AppError('Tidak ada field yang diubah', 400);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const update of updates) {
      values.push(update.value);
      const index = values.length;
      setClauses.push(`${update.column} = $${index}${update.cast ?? ''}`);
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);
    const idIndex = values.length;
    values.push(tenantId);
    const tenantIndex = values.length;

    const sql = `
      UPDATE tables
      SET ${setClauses.join(', ')}
      WHERE id = $${idIndex} AND tenant_id = $${tenantIndex}
      RETURNING id, tenant_id, table_number, capacity, status, created_at, updated_at
    `;

    const rows = await prisma.$queryRawUnsafe<TableRow[]>(sql, ...values);
    if (!rows[0]) {
      throw new AppError('Meja tidak ditemukan', 404);
    }

    return rows[0];
  }

  static async deleteTable(tenantId: string, id: bigint): Promise<void> {
    const deleted = await prisma.$executeRaw`
      DELETE FROM tables
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `;

    if (deleted === 0) {
      throw new AppError('Meja tidak ditemukan', 404);
    }
  }
}
