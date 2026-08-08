import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED';

type TableRow = {
  id: bigint;
  tenant_id: string;
  branch_id: bigint | null;
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

// 🔴 CRITICAL FIX (Cross-Branch Contamination):
//    Parse branch_id dari request (string/bigint/number/unknown) ke bigint|null.
//    Semua table endpoints WAJIB kirim branch_id untuk isolasi per cabang.
function parseBranchId(raw: unknown): bigint | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = raw.toString().trim();
  if (!/^\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

async function cancelOpenOrdersForTable(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tableId: bigint,
): Promise<void> {
  const openOrderIds = await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id
    FROM sales_records
    WHERE tenant_id = ${tenantId}
      AND table_id = ${tableId}
      AND (
        LOWER(COALESCE(payment_status, '')) IN ('unpaid', 'pending_payment', 'open')
        OR LOWER(COALESCE(order_status::text, '')) IN (
          'open',
          'unpaid',
          'pending',
          'pending_payment',
          'preparing',
          'ready_for_pickup',
          'active'
        )
      )
      AND UPPER(COALESCE(order_status::text, '')) NOT IN ('COMPLETED', 'CANCELLED')
    FOR UPDATE
  `;

  if (openOrderIds.length === 0) {
    return;
  }

  await tx.$executeRaw`
    UPDATE sales_records
    SET order_status = 'CANCELLED'::"OrderStatus",
        updated_at = NOW()
    WHERE tenant_id = ${tenantId}
      AND id IN (${Prisma.join(openOrderIds.map((row) => row.id))})
  `;
}

export class TableService {
  // 🔴 CRITICAL FIX 1: List tables WAJIB filter tenant_id AND branch_id.
  //    Sebelumnya HANYA tenant_id → meja cabang A muncul di cabang B (cross-contamination).
  //    Strategi filter:
  //      - Jika branchIdProvided == true dan ada branchId → WHERE (tenant_id AND branch_id)
  //      - Jika branchId TIDAK ADA (role HQ / SUPER_ADMIN tidak kirim / NULL) →
  //        kembalikan TABEL yang branch_id = req.branchId ATAU branch_id NULL (existing legacy tables).
  //      - Tambahkan client-side: TETAP kembalikan data yang cocok agar backward compatible.
  static async listTables(
    tenantId: string,
    branchId: bigint | null,
  ): Promise<TableRow[]> {
    let rows: TableRow[];
    if (branchId != null) {
      // 🔴 GEMBOK GANDA (PASTI): User punya context branch → HANYA lihat milik branchnya + legacy (branch_id=NULL)
      rows = await prisma.$queryRaw<TableRow[]>`
        SELECT id, tenant_id, branch_id, table_number, capacity, status, created_at, updated_at
        FROM tables
        WHERE tenant_id = ${tenantId}
          AND (branch_id = ${branchId} OR branch_id IS NULL)
        ORDER BY table_number ASC
      `;
    } else {
      // Fallback jika branchId TIDAK TERSEDIA (SUPER_ADMIN / HQ role) →
      // kembalikan SEMUA table milik tenant. TAPI client-filter di layer controller / frontend
      // tetap berjalan (Flutter sudah _isRowInScope branch_id filter).
      rows = await prisma.$queryRaw<TableRow[]>`
        SELECT id, tenant_id, branch_id, table_number, capacity, status, created_at, updated_at
        FROM tables
        WHERE tenant_id = ${tenantId}
        ORDER BY COALESCE(branch_id::text, ''), table_number ASC
      `;
    }
    return rows;
  }

  static async createTable(
    tenantId: string,
    branchId: bigint | null,
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
    // 🔴 CRITICAL FIX 2: Simpan branch_id ke row table baru (sebelumnya TIDAK PERNAH disimpan).
    //    Unique constraint sekarang pakai 3 column (tenant + branch + table_number) untuk
    //    memungkinkan meja "1" ada di cabang A dan cabang B sebagai row TERPISAH.
    try {
      const rows = await prisma.$queryRaw<TableRow[]>`
        INSERT INTO tables (tenant_id, branch_id, table_number, capacity, status)
        VALUES (
          ${tenantId},
          ${branchId ?? (null as unknown as Prisma.Sql)},
          ${tableNumber},
          ${capacity},
          ${status}::"TableStatus"
        )
        RETURNING id, tenant_id, branch_id, table_number, capacity, status, created_at, updated_at
      `;

      if (!rows[0]) {
        throw new AppError('Gagal membuat meja', 500);
      }

      return rows[0];
    } catch (error: unknown) {
      const message = (error as Error)?.message ?? '';
      if (message.toLowerCase().includes('unique')) {
        if (branchId != null) {
          throw new AppError(
            `Nomor meja ${tableNumber} sudah digunakan pada cabang ini`,
            409,
          );
        }
        throw new AppError('Nomor meja sudah digunakan pada tenant ini', 409);
      }
      throw error;
    }
  }

  static async updateTable(
    tenantId: string,
    branchId: bigint | null,
    id: bigint,
    payload: { tableNumber?: unknown; capacity?: unknown; status?: unknown },
  ): Promise<TableRow> {
    const nextStatus = payload.status !== undefined ? parseTableStatus(payload.status) : undefined;
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
      if (!nextStatus) {
        throw new AppError('status tidak valid', 400);
      }
      updates.push({ column: 'status', value: nextStatus, cast: '::"TableStatus"' });
    }

    if (updates.length === 0) {
      throw new AppError('Tidak ada field yang diubah', 400);
    }

    // Build SET clause via prisma.sql (safe, no injection):
    // Gunakan Prisma.join agar TIDAK perlu method concat (yang tidak ada di type Prisma.Sql)
    const setPieces: Prisma.Sql[] = [];
    for (const update of updates) {
      if (update.cast) {
        const col = Prisma.raw(`${update.column} = `);
        const val = Prisma.sql`${update.value}`;
        const cast = Prisma.raw(`${update.cast}`);
        // Gabung via join array (100% aman)
        setPieces.push(Prisma.join([col, val, cast], ''));
      } else {
        const col = Prisma.raw(`${update.column} = `);
        const val = Prisma.sql`${update.value}`;
        setPieces.push(Prisma.join([col, val], ''));
      }
    }
    setPieces.push(Prisma.raw(`updated_at = NOW()`));
    const setClause = Prisma.join(setPieces, ', ');

    const branchFilter = branchId != null
      ? Prisma.sql`AND (branch_id = ${branchId} OR branch_id IS NULL)`
      : Prisma.empty;

    const updatedTable = await prisma.$transaction(async (tx) => {
      if (nextStatus === 'AVAILABLE') {
        const tableRows = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT id
          FROM tables
          WHERE id = ${id} AND tenant_id = ${tenantId}
            ${branchFilter}
          LIMIT 1
          FOR UPDATE
        `;

        if (!tableRows[0]) {
          throw new AppError('Meja tidak ditemukan', 404);
        }

        await cancelOpenOrdersForTable(tx, tenantId, id);
      }

      const rows = await tx.$queryRaw<TableRow[]>`
        UPDATE tables
        SET ${setClause}
        WHERE id = ${id} AND tenant_id = ${tenantId}
          ${branchFilter}
        RETURNING id, tenant_id, branch_id, table_number, capacity, status, created_at, updated_at
      `;
      if (!rows[0]) {
        throw new AppError('Meja tidak ditemukan', 404);
      }

      return rows[0];
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    return updatedTable;
  }

  static async deleteTable(
    tenantId: string,
    branchId: bigint | null,
    id: bigint,
  ): Promise<void> {
    let deleted: number;
    if (branchId != null) {
      deleted = await prisma.$executeRaw`
        DELETE FROM tables
        WHERE id = ${id} AND tenant_id = ${tenantId}
          AND (branch_id = ${branchId} OR branch_id IS NULL)
      `;
    } else {
      deleted = await prisma.$executeRaw`
        DELETE FROM tables
        WHERE id = ${id} AND tenant_id = ${tenantId}
      `;
    }

    if (deleted === 0) {
      throw new AppError('Meja tidak ditemukan', 404);
    }
  }
}

export const __tableBranchParseHelper = { parseBranchId };
