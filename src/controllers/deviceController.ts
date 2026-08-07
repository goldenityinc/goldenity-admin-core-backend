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
