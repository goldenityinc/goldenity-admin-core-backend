import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { firebaseAuth } from '../config/firebase';
import { isJwtAuthPayload } from '../types/auth';

let ioInstance: Server | null = null;

export const buildTenantRoom = (tenantId: string): string => `tenant:${tenantId}`;
// 🔴 CRITICAL FIX 1 (broadcast to branch):
//    Tiap tenant bisa punya banyak branch. Device POS/Tablet di branch A TIDAK PERLU
//    menerima event dari branch B. Tambah room granular per branch supaya broadcast
//    tepat sasaran + juga tidak leak event antar branch.
export const buildBranchRoom = (tenantId: string, branchId: string | bigint | number | null | undefined): string | null => {
  const normalizedTenantId = (tenantId ?? '').toString().trim();
  if (!normalizedTenantId || branchId === null || branchId === undefined || branchId === '') return null;
  return `branch:${normalizedTenantId}:${String(branchId).trim()}`;
};

function extractSocketToken(socket: Socket): string {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim().length > 0) {
    return authToken.trim().replace(/^Bearer\s+/i, '');
  }

  const headerToken = socket.handshake.headers?.authorization;
  if (typeof headerToken === 'string' && headerToken.startsWith('Bearer ')) {
    return headerToken.slice(7).trim();
  }

  return '';
}

async function resolveTenantIdFromToken(token: string): Promise<string> {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      if (isJwtAuthPayload(decoded)) {
        return decoded.tenantId;
      }
    } catch {
      // Fall through to Firebase validation.
    }
  }

  const firebaseUser = await firebaseAuth.verifyIdToken(token);
  const dbUser = await prisma.user.findUnique({
    where: { firebaseUid: firebaseUser.uid },
    select: { tenantId: true },
  });

  return dbUser?.tenantId ?? '';
}

export function initializeSocketServer(server: HttpServer): Server {
  if (ioInstance) {
    return ioInstance;
  }

  ioInstance = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
  });

  ioInstance.use(async (socket, next) => {
    try {
      const token = extractSocketToken(socket);
      if (!token) {
        return next(new Error('Token socket tidak ditemukan'));
      }

      const tenantId = await resolveTenantIdFromToken(token);
      if (!tenantId) {
        return next(new Error('tenantId socket tidak ditemukan'));
      }

      socket.data.tenantId = tenantId;
      return next();
    } catch (error) {
      return next(new Error(error instanceof Error ? error.message : 'Autentikasi socket gagal'));
    }
  });

  ioInstance.on('connection', (socket) => {
    const tenantId = (socket.data.tenantId ?? '').toString().trim();
    if (tenantId) {
      socket.join(buildTenantRoom(tenantId));
    }

    socket.on('join_tenant', (payload: { tenantId?: string; tenant_id?: string } = {}) => {
      const requestedTenantId = (payload.tenantId ?? payload.tenant_id ?? '').toString().trim();
      if (!requestedTenantId || requestedTenantId !== tenantId) {
        socket.emit('socket_error', { message: 'Tenant room tidak valid' });
        return;
      }

      socket.join(buildTenantRoom(requestedTenantId));
      socket.emit('tenant_joined', {
        tenantId: requestedTenantId,
        joinedAt: new Date().toISOString(),
      });
    });

    // 🔴 FIX 1 — JOIN BRANCH ROOM:
    //    Device atau UI management bisa request join room branch_id tertentu supaya
    //    notification tidak bocor ke branch lain dalam tenant yang sama.
    socket.on('join_branch', (payload: { tenantId?: string; tenant_id?: string; branchId?: string; branch_id?: string } = {}) => {
      const requestedTenantId = (payload.tenantId ?? payload.tenant_id ?? '').toString().trim();
      const requestedBranchId = (payload.branchId ?? payload.branch_id ?? '').toString().trim();
      if (!requestedTenantId || !requestedBranchId || requestedTenantId !== tenantId) {
        socket.emit('socket_error', { message: 'Branch room tidak valid' });
        return;
      }
      const branchRoom = buildBranchRoom(requestedTenantId, requestedBranchId);
      if (branchRoom) {
        socket.join(branchRoom);
        socket.emit('branch_joined', {
          tenantId: requestedTenantId,
          branchId: requestedBranchId,
          joinedAt: new Date().toISOString(),
        });
      }
    });
  });

  return ioInstance;
}

// 🔴 FIX 1: Broadcast ke SEMUA socket di room branch (tenantId + branchId).
//          Ini dipanggil oleh publicQrController.createQrOrder bersamaan dengan emitToTenant,
//          supaya Tablet Printer di branch tertentu SELALU dapat notif walau ada device lain online.
export function emitToBranch(
  tenantId: string,
  branchId: string | bigint | number | null | undefined,
  eventName: string,
  payload: Record<string, unknown>,
): void {
  const normalizedTenantId = tenantId.trim();
  const branchRoom = buildBranchRoom(normalizedTenantId, branchId);

  if (!ioInstance) {
    const meta = {
      stage: 'SOCKET_BRANCH_EMIT_SKIP_NO_IO',
      tenantId: normalizedTenantId || undefined,
      branchId: branchId !== undefined && branchId !== null ? String(branchId) : null,
      eventName,
      branchRoom,
    };
    console.warn(
      '[socketServer.emitToBranch] skipped: ioInstance not initialized',
      JSON.stringify(meta),
    );
    return;
  }

  if (!normalizedTenantId || !branchRoom) {
    return;
  }

  try {
    void ioInstance
      .timeout(4000)
      .to(branchRoom)
      .emitWithAck(eventName, payload)
      .catch((err) => {
        const meta = {
          stage: 'SOCKET_BRANCH_EMIT_ACK_MISSING_OR_ERROR',
          tenantId: normalizedTenantId,
          branchRoom,
          eventName,
          message: err instanceof Error ? err.message : String(err ?? ''),
        };
        console.warn(
          '[socketServer.emitToBranch] branch clients did not ACK within timeout',
          JSON.stringify(meta),
        );
      });
  } catch (topErr) {
    const meta = {
      stage: 'SOCKET_BRANCH_EMIT_SYNC_EXCEPTION',
      tenantId: normalizedTenantId,
      branchRoom,
      eventName,
      message: topErr instanceof Error ? topErr.message : String(topErr ?? ''),
    };
    console.warn(
      '[socketServer.emitToBranch] synchronous throw when scheduling branch emit',
      JSON.stringify(meta),
    );
  }
}

export function emitToTenant(tenantId: string, eventName: string, payload: Record<string, unknown>): void {
  const normalizedTenantId = tenantId.trim();

  if (!ioInstance) {
    const meta = {
      stage: 'SOCKET_EMIT_SKIP_NO_IO',
      tenantId: normalizedTenantId || undefined,
      eventName,
      payloadPreview: {
        orderId: payload.orderId ?? null,
        referenceId: payload.referenceId ?? null,
        receiptNumber: payload.receiptNumber ?? null,
        orderStatus: payload.orderStatus ?? null,
        paymentStatus: payload.paymentStatus ?? null,
      },
    };
    console.warn(
      '[socketServer.emitToTenant] skipped: ioInstance not initialized (POS clients will miss the event)',
      JSON.stringify(meta),
    );
    return;
  }

  if (!normalizedTenantId) {
    const meta = {
      stage: 'SOCKET_EMIT_SKIP_BLANK_TENANT',
      eventName,
      payloadPreview: {
        orderId: payload.orderId ?? null,
        referenceId: payload.referenceId ?? null,
        receiptNumber: payload.receiptNumber ?? null,
      },
    };
    console.warn(
      '[socketServer.emitToTenant] skipped: blank tenantId',
      JSON.stringify(meta),
    );
    return;
  }

  try {
    void ioInstance
      .timeout(4000)
      .to(buildTenantRoom(normalizedTenantId))
      .emitWithAck(eventName, payload)
      .catch((err) => {
        const meta = {
          stage: 'SOCKET_EMIT_ACK_MISSING_OR_ERROR',
          tenantId: normalizedTenantId,
          eventName,
          message: err instanceof Error ? err.message : String(err ?? ''),
          stack: err instanceof Error ? err.stack : undefined,
          payloadPreview: {
            orderId: payload.orderId ?? null,
            referenceId: payload.referenceId ?? null,
            receiptNumber: payload.receiptNumber ?? null,
            orderStatus: payload.orderStatus ?? null,
            paymentStatus: payload.paymentStatus ?? null,
            grandTotal: payload.grandTotal ?? null,
          },
        };
        console.warn(
          '[socketServer.emitToTenant] POS did not ACK within timeout (the DB record is COMMITTED, but POS UI may be stale until next refresh)',
          JSON.stringify(meta),
        );
      });
  } catch (topErr) {
    const meta = {
      stage: 'SOCKET_EMIT_SYNC_EXCEPTION',
      tenantId: normalizedTenantId,
      eventName,
      message: topErr instanceof Error ? topErr.message : String(topErr ?? ''),
      stack: topErr instanceof Error ? topErr.stack : undefined,
    };
    console.warn(
      '[socketServer.emitToTenant] synchronous throw when scheduling emit (DB record is still COMMITTED)',
      JSON.stringify(meta),
    );
  }
}