import prisma from '../config/database';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

function generateRandomPassword(length = 12): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    result += charset[randomIndex];
  }

  return result;
}

function sanitizeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export class AppInstanceService {
  private static resolveTenantPrismaWorkingDirectory(): string {
    const configuredDir = process.env.TENANT_PRISMA_PROJECT_DIR?.trim();
    const candidates = [
      configuredDir,
      path.resolve(process.cwd(), '..', 'goldenity-pos-api-bridge'),
      process.cwd(),
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      const schemaPath = path.resolve(candidate, 'prisma', 'schema.prisma');
      if (!fs.existsSync(schemaPath)) {
        continue;
      }
      return candidate;
    }

    throw new Error(
      'Provisioning DB tenant gagal: prisma/schema.prisma tidak ditemukan. Set TENANT_PRISMA_PROJECT_DIR ke path project yang berisi Prisma schema.',
    );
  }

  private static async runTenantBootstrapScript(tenantDbUrl: string): Promise<void> {
    const bootstrapScriptPath = path.resolve(process.cwd(), 'setup_tenant_db.js');
    if (!fs.existsSync(bootstrapScriptPath)) {
      return;
    }

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [bootstrapScriptPath, tenantDbUrl],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });

    if (result.code !== 0) {
      throw new Error(
        `Bootstrap schema tenant gagal (exitCode=${result.code}). stderr=${result.stderr.trim()} stdout=${result.stdout.trim()}`,
      );
    }
  }


  static readonly SyncModeValues = ['CLOUD_FIRST', 'LOCAL_FIRST', 'LOCAL_SERVER'] as const;

  static parseEndDateInput(input: string | null | undefined): Date | null | undefined {
    if (input === undefined) return undefined;
    if (input === null) return null;
    const raw = input.trim();
    if (!raw) return null;

    // Accept YYYY-MM-DD (treat as end of day UTC).
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
      return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  static async create(data: {
    tenantId: string;
    solutionId: string;
    tier: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
    syncMode?: (typeof AppInstanceService.SyncModeValues)[number];
    status?: 'ACTIVE' | 'SUSPENDED';
    dbConnectionString?: string | null;
    appUrl?: string | null;
    endDate?: string | null;
  }) {
    let resolvedDbConnectionString = data.dbConnectionString;

    if (!resolvedDbConnectionString) {
      const [tenant, solution] = await Promise.all([
        prisma.tenant.findUnique({
          where: { id: data.tenantId },
          select: { slug: true },
        }),
        prisma.solution.findUnique({
          where: { id: data.solutionId },
          select: { code: true },
        }),
      ]);

      if (!tenant) {
        throw new Error('Tenant not found when generating dbConnectionString');
      }

      if (!solution) {
        throw new Error('Solution not found when generating dbConnectionString');
      }

      const host = process.env.DB_HOST_TEMPLATE ?? 'localhost:5432';
      const randomPassword = generateRandomPassword(12);
      const databaseName = `${sanitizeIdentifier(tenant.slug)}_${sanitizeIdentifier(solution.code)}_db`;

      resolvedDbConnectionString = `postgresql://admin:${randomPassword}@${host}/${databaseName}`;
    }

    const appInstance = await prisma.appInstance.create({
      data: {
        tenantId: data.tenantId,
        solutionId: data.solutionId,
        tier: data.tier,
        ...(data.syncMode !== undefined ? { syncMode: data.syncMode } : {}),
        status: data.status ?? 'ACTIVE',
        dbConnectionString: resolvedDbConnectionString,
        appUrl: data.appUrl,
        ...(data.endDate !== undefined ? { endDate: AppInstanceService.parseEndDateInput(data.endDate) } : {}),
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });

    try {
      await AppInstanceService.provisionTenantDatabase({
        tenantId: data.tenantId,
        appInstanceId: appInstance.id,
        dbConnectionString: resolvedDbConnectionString ?? null,
      });
    } catch (error) {
      await prisma.appInstance.delete({ where: { id: appInstance.id } }).catch(() => null);
      throw error;
    }

    return appInstance;
  }

  static async list(options: {
    page: number;
    limit: number;
    tenantId?: string;
    solutionId?: string;
    status?: 'ACTIVE' | 'SUSPENDED';
    tier?: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
  }) {
    const skip = (options.page - 1) * options.limit;

    const where = {
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.solutionId ? { solutionId: options.solutionId } : {}),
      ...(options.status ? { status: options.status } : {}),
      ...(options.tier ? { tier: options.tier } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.appInstance.findMany({
        where,
        skip,
        take: options.limit,
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          solution: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.appInstance.count({ where }),
    ]);

    return {
      items,
      meta: {
        page: options.page,
        limit: options.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / options.limit)),
      },
    };
  }

  static async getById(id: string) {
    return prisma.appInstance.findUnique({
      where: { id },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });
  }

  static async update(
    id: string,
    data: {
      tier?: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
      syncMode?: (typeof AppInstanceService.SyncModeValues)[number];
      status?: 'ACTIVE' | 'SUSPENDED';
      dbConnectionString?: string | null;
      appUrl?: string | null;
      endDate?: string | null;
    }
  ) {
    const current = await prisma.appInstance.findUnique({
      where: { id },
      select: { id: true, tenantId: true, dbConnectionString: true },
    });

    const { endDate, syncMode, ...restData } = data;

    const updated = await prisma.appInstance.update({
      where: { id },
      data: {
        ...restData,
        ...(syncMode !== undefined ? { syncMode } : {}),
        ...(endDate !== undefined ? { endDate: AppInstanceService.parseEndDateInput(endDate) } : {}),
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });

    const nextDbUrl = (updated.dbConnectionString ?? '').trim();
    const previousDbUrl = (current?.dbConnectionString ?? '').trim();
    const shouldProvision =
      nextDbUrl.length > 0 &&
      data.dbConnectionString !== undefined &&
      (nextDbUrl !== previousDbUrl || previousDbUrl.length > 0);

    if (shouldProvision) {
      await AppInstanceService.provisionTenantDatabase({
        tenantId: updated.tenantId,
        appInstanceId: updated.id,
        dbConnectionString: updated.dbConnectionString,
      });
    }

    return updated;
  }

  static async remove(id: string) {
    return prisma.appInstance.delete({
      where: { id },
    });
  }

  private static async provisionTenantDatabase(params: {
    tenantId: string;
    appInstanceId: string;
    dbConnectionString: string | null;
  }): Promise<void> {
    const tenantDbUrl = (params.dbConnectionString ?? '').trim();
    if (!tenantDbUrl) {
      throw new Error(
        `Provisioning DB tenant gagal: dbConnectionString kosong (tenantId=${params.tenantId}, appInstanceId=${params.appInstanceId}).`,
      );
    }

    const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const prismaProjectDir = AppInstanceService.resolveTenantPrismaWorkingDirectory();

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(
        npxCommand,
        ['prisma', 'db', 'push', '--skip-generate'],
        {
          cwd: prismaProjectDir,
          env: {
            ...process.env,
            DATABASE_URL: tenantDbUrl,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: false,
        },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });
    });

    if (result.code !== 0) {
      throw new Error(
        `Provisioning DB tenant gagal (tenantId=${params.tenantId}, appInstanceId=${params.appInstanceId}, cwd=${prismaProjectDir}, exitCode=${result.code}). stderr=${result.stderr.trim()} stdout=${result.stdout.trim()}`,
      );
    }

    await AppInstanceService.runTenantBootstrapScript(tenantDbUrl);
  }
}
