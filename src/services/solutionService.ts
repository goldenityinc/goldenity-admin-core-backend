import prisma from '../config/database';

export class SolutionService {

  static async create(data: {
    name: string;
    code: string;
    description?: string;
    isActive?: boolean;
  }) {
    return prisma.solution.create({
      data: {
        name: data.name,
        code: data.code,
        description: data.description,
        isActive: data.isActive ?? true,
      },
    });
  }

  static async list(options: {
    page: number;
    limit: number;
    search?: string;
    isActive?: boolean;
  }) {
    const skip = (options.page - 1) * options.limit;

    const where = {
      ...(options.isActive !== undefined ? { isActive: options.isActive } : {}),
      ...(options.search
        ? {
            OR: [
              { name: { contains: options.search, mode: 'insensitive' as const } },
              { code: { contains: options.search, mode: 'insensitive' as const } },
              { description: { contains: options.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.solution.findMany({
        where,
        skip,
        take: options.limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.solution.count({ where }),
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
    return prisma.solution.findUnique({ where: { id } });
  }

  static async update(
    id: string,
    data: {
      name?: string;
      code?: string;
      description?: string;
      isActive?: boolean;
    }
  ) {
    return prisma.solution.update({
      where: { id },
      data,
    });
  }

  static async remove(id: string) {
    return prisma.solution.delete({
      where: { id },
    });
  }
}
