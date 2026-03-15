import prisma from '../config/database';

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

  static async create(data: {
    tenantId: string;
    solutionId: string;
    tier: 'Standard' | 'Professional' | 'Enterprise' | 'Custom';
    status?: 'ACTIVE' | 'SUSPENDED';
    dbConnectionString?: string | null;
    appUrl?: string | null;
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

    return prisma.appInstance.create({
      data: {
        tenantId: data.tenantId,
        solutionId: data.solutionId,
        tier: data.tier,
        status: data.status ?? 'ACTIVE',
        dbConnectionString: resolvedDbConnectionString,
        appUrl: data.appUrl,
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });
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
      status?: 'ACTIVE' | 'SUSPENDED';
      dbConnectionString?: string | null;
      appUrl?: string | null;
    }
  ) {
    return prisma.appInstance.update({
      where: { id },
      data,
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        solution: { select: { id: true, name: true, code: true } },
      },
    });
  }

  static async remove(id: string) {
    return prisma.appInstance.delete({
      where: { id },
    });
  }
}
