import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { firebaseAuth } from '../config/firebase';
import { isJwtAuthPayload } from '../types/auth';

let ioInstance: Server | null = null;

export const buildTenantRoom = (tenantId: string): string => `tenant:${tenantId}`;

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
  });

  return ioInstance;
}

export function emitToTenant(tenantId: string, eventName: string, payload: Record<string, unknown>): void {
  if (!ioInstance) {
    return;
  }

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return;
  }

  ioInstance.to(buildTenantRoom(normalizedTenantId)).emit(eventName, payload);
}