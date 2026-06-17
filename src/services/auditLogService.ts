import prisma from '../config/database';

export interface AuditLogInput {
  tenantId: string;
  userId?: string | null;
  userName?: string | null;
  actionType: string;
  details?: string | null;
}

export class AuditLogService {
  static async createLog(input: AuditLogInput) {
    const tenantId = (input.tenantId ?? '').toString().trim();
    if (!tenantId) {
      return null;
    }

    const actionType = (input.actionType ?? '').toString().trim();
    if (!actionType) {
      return null;
    }

    try {
      return await prisma.audit_logs.create({
        data: {
          tenant_id: tenantId,
          user_id: (input.userId ?? '').toString().trim() || null,
          user_name: (input.userName ?? '').toString().trim() || null,
          action_type: actionType,
          details: (input.details ?? '').toString().trim() || null,
        },
      });
    } catch (error: any) {
      // Skip hard failure when table is not deployed yet.
      if (error?.code === 'P2021') {
        return null;
      }
      throw error;
    }
  }

  static async listLogs(tenantId: string, limit = 100) {
    const normalizedTenantId = (tenantId ?? '').toString().trim();
    if (!normalizedTenantId) {
      return [];
    }

    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(500, Math.trunc(limit)))
      : 100;

    try {
      const rows = await prisma.$queryRaw<Array<{
        id: bigint;
        tenant_id: string;
        user_id: string | null;
        user_name: string | null;
        action_type: string;
        details: string | null;
        created_at: Date | null;
      }>>`
        SELECT
          al.id,
          al.tenant_id,
          al.user_id,
          COALESCE(al.user_name, u.name) AS user_name,
          al.action_type,
          al.details,
          al.created_at
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.tenant_id = ${normalizedTenantId}
        ORDER BY al.created_at DESC, al.id DESC
        LIMIT ${safeLimit}
      `;

      return rows.map((row) => ({
        id: row.id.toString(),
        tenant_id: row.tenant_id,
        user_id: row.user_id,
        user_name: row.user_name,
        action_type: row.action_type,
        details: row.details,
        created_at: row.created_at?.toISOString() ?? null,
      }));
    } catch (error: any) {
      // PostgreSQL undefined_table safeguard for non-migrated env.
      if (error?.code === '42P01') {
        return [];
      }
      throw error;
    }
  }
}
