import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { serializeForJson } from '../utils/serializeForJson';
import { DeviceRole } from '@prisma/client';

function readTenantId(req: Request): string {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    throw new AppError('Tenant context is required', 401);
  }
  return tenantId;
}

function parseBranchId(rawId: string | number | undefined | null): bigint | null {
  if (rawId === undefined || rawId === null || rawId === '') {
    return null;
  }
  return BigInt(String(rawId));
}

function validateDeviceRole(role: string): DeviceRole {
  const validRoles: DeviceRole[] = ['CASHIER', 'CHECKER_PRINTER', 'BOTH'];
  if (!validRoles.includes(role as DeviceRole)) {
    throw new AppError(
      `Invalid deviceRole. Must be one of: ${validRoles.join(', ')}`,
      400,
    );
  }
  return role as DeviceRole;
}

function generateDeviceUuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const registerDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const {
    deviceUuid,
    macAddress,
    deviceName,
    deviceRole,
    printerTargetId,
    branchId,
  } = req.body;

  if (!deviceName) {
    throw new AppError('deviceName is required', 400);
  }
  if (!deviceRole) {
    throw new AppError('deviceRole is required', 400);
  }

  const validRole = validateDeviceRole(deviceRole);
  const finalDeviceUuid = deviceUuid?.trim() || generateDeviceUuid();
  const parsedBranchId = parseBranchId(branchId);

  const existingDevice = await prisma.branchDevice.findUnique({
    where: { deviceUuid: finalDeviceUuid },
  });

  let device;

  if (existingDevice) {
    if (existingDevice.tenantId !== tenantId) {
      throw new AppError('Device does not belong to this tenant', 403);
    }

    device = await prisma.branchDevice.update({
      where: { deviceUuid: finalDeviceUuid },
      data: {
        macAddress: macAddress ?? existingDevice.macAddress,
        deviceName: deviceName ?? existingDevice.deviceName,
        deviceRole: validRole,
        printerTargetId: printerTargetId ?? existingDevice.printerTargetId,
        branchId: parsedBranchId !== null ? parsedBranchId : existingDevice.branchId,
        lastSeenAt: new Date(),
      },
    });
  } else {
    device = await prisma.branchDevice.create({
      data: {
        tenantId,
        branchId: parsedBranchId,
        deviceUuid: finalDeviceUuid,
        macAddress: macAddress ?? null,
        deviceName,
        deviceRole: validRole,
        printerTargetId: printerTargetId ?? null,
        isDefaultPrinter: false,
        isActive: true,
        lastSeenAt: new Date(),
      },
    });
  }

  return res.status(existingDevice ? 200 : 201).json({
    success: true,
    message: existingDevice ? 'Device updated successfully' : 'Device registered successfully',
    data: serializeForJson(device),
  });
});

export const deviceHeartbeat = asyncHandler(async (req: Request, res: Response) => {
  const { uuid } = req.params;

  if (!uuid) {
    throw new AppError('Device UUID is required', 400);
  }

  const device = await prisma.branchDevice.findUnique({
    where: { deviceUuid: uuid },
  });

  if (!device) {
    throw new AppError('Device not found', 404);
  }

  if (req.user?.tenantId && device.tenantId !== req.user.tenantId) {
    throw new AppError('Device does not belong to this tenant', 403);
  }

  await prisma.branchDevice.update({
    where: { deviceUuid: uuid },
    data: { lastSeenAt: new Date() },
  });

  return res.status(200).json({
    success: true,
    ok: true,
    message: 'Heartbeat received',
  });
});

export const listBranchDevices = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const { branchId } = req.params;

  if (!branchId) {
    throw new AppError('Branch ID is required', 400);
  }

  const parsedBranchId = parseBranchId(branchId);
  if (parsedBranchId === null) {
    throw new AppError('Invalid Branch ID', 400);
  }

  const devices = await prisma.branchDevice.findMany({
    where: {
      tenantId,
      branchId: parsedBranchId,
      isActive: true,
    },
    orderBy: [
      { isDefaultPrinter: 'desc' },
      { createdAt: 'asc' },
    ],
  });

  return res.status(200).json({
    success: true,
    data: serializeForJson(devices),
  });
});

export const getDefaultPrinterDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const { branchId } = req.params;

  if (!branchId) {
    throw new AppError('Branch ID is required', 400);
  }

  const parsedBranchId = parseBranchId(branchId);
  if (parsedBranchId === null) {
    throw new AppError('Invalid Branch ID', 400);
  }

  let defaultPrinter = await prisma.branchDevice.findFirst({
    where: {
      tenantId,
      branchId: parsedBranchId,
      isActive: true,
      isDefaultPrinter: true,
    },
  });

  if (!defaultPrinter) {
    defaultPrinter = await prisma.branchDevice.findFirst({
      where: {
        tenantId,
        branchId: parsedBranchId,
        isActive: true,
        deviceRole: { in: ['CHECKER_PRINTER', 'BOTH'] },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  if (!defaultPrinter) {
    return res.status(404).json({
      success: false,
      message: 'No printer device found for this branch',
      data: null,
    });
  }

  return res.status(200).json({
    success: true,
    data: serializeForJson(defaultPrinter),
  });
});

// 🔴 CRITICAL FIX 2: DELETE DEVICE (Soft Delete agar tidak crash FK constraint)
//    Model OrderAcknowledgement punya field targetDeviceUuid TAPI TIDAK ada @relation FK
//    (hanya field string biasa). Tapi untuk SAFETY & backward compatibility,
//    KITA GUNAKAN SOFT DELETE: SET isActive=false, BUKAN hard DELETE.
//    Keuntungan:
//    - History data device TIDAK hilang (bisa audit, deactivate kapan saja)
//    - Tidak ada risiko Foreign Key violation 500 error (jika nanti FK relation ditambah)
//    - listBranchDevices otomatis filter isActive=true → device langsung hilang dari UI
export const deleteDevice = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = readTenantId(req);
  const rawIdentifier = (req.params.uuid ?? req.params.id ?? '').toString().trim();

  if (!rawIdentifier) {
    throw new AppError('Device UUID or ID is required', 400);
  }

  let foundDevice = null;

  // Strategy 1: Cari via deviceUuid (unique string) — ini yang paling umum di gunakan UI
  if (!/^\d+$/.test(rawIdentifier)) {
    foundDevice = await prisma.branchDevice.findUnique({
      where: { deviceUuid: rawIdentifier },
    });
  } else {
    // Strategy 2: Jika pure angka → mungkin PK BigInt id, coba cari via PK
    try {
      const pk = BigInt(rawIdentifier);
      foundDevice = await prisma.branchDevice.findUnique({
        where: { id: pk },
      });
    } catch {
      foundDevice = null;
    }
    // Fallback strategy 3: Walaupun pure angka, bisa jadi kebetulan deviceUuid berupa angka string
    if (!foundDevice) {
      foundDevice = await prisma.branchDevice.findUnique({
        where: { deviceUuid: rawIdentifier },
      });
    }
  }

  if (!foundDevice) {
    throw new AppError('Device not found', 404);
  }

  if (foundDevice.tenantId !== tenantId) {
    throw new AppError('Device does not belong to this tenant', 403);
  }

  // Jika sudah tidak aktif, langsung return success idempotent
  if (!foundDevice.isActive) {
    return res.status(200).json({
      success: true,
      message: 'Device already removed',
      softDeleted: true,
      idempotent: true,
      data: serializeForJson(foundDevice),
    });
  }

  // SOFT DELETE: set isActive=false + updatedAt = now.
  // TIDAK menggunakan prisma.delete() karena risiko FK constraint di kemudian hari.
  const updated = await prisma.branchDevice.update({
    where: { id: foundDevice.id },
    data: {
      isActive: false,
      // Reset default printer flag supaya jika device di-reactivate nanti,
      // tidak otomatis jadi default printer lagi tanpa user explicit set.
      isDefaultPrinter: false,
      lastSeenAt: foundDevice.lastSeenAt ?? new Date(),
    },
  });

  return res.status(200).json({
    success: true,
    message: 'Device successfully removed (soft-deleted)',
    softDeleted: true,
    data: serializeForJson(updated),
  });
});
