import { Prisma, type LeadStage } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/AppError';
import type { LeadInput } from '../validations/leadValidation';

const CONTACT_STAGES: LeadStage[] = ['CONTACTED', 'INTERVIEW', 'DEMO', 'TRIAL', 'WON'];

function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Kunci untuk mencegah lead dobel saat impor ulang:
 * 1) ID tempat Google Maps (0x..:0x..) jika ada di URL,
 * 2) segmen + 9 digit terakhir nomor telepon,
 * 3) segmen + nama yang dinormalisasi.
 */
export function buildLeadDedupeKey(input: Pick<LeadInput, 'mapsUrl' | 'phone' | 'name' | 'segment'>): string {
  const placeId = (input.mapsUrl ?? '').match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1];
  if (placeId) {
    return `maps:${placeId.toLowerCase()}`;
  }

  const segment = input.segment.trim().toUpperCase();
  const phone = digitsOnly(input.phone);
  if (phone.length >= 8) {
    return `phone:${segment}:${phone.slice(-9)}`;
  }

  const name = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `name:${segment}:${name}`;
}

function toCreateData(input: LeadInput): Prisma.LeadCreateInput {
  const stage = input.stage ?? 'NEW';
  return {
    name: input.name,
    segment: input.segment.trim().toUpperCase(),
    stage,
    tier: input.tier ? input.tier.toUpperCase() : null,
    score: input.score ?? null,
    area: input.area ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    instagram: input.instagram ?? null,
    rating: input.rating ?? null,
    reviewCount: input.reviewCount ?? null,
    outletCount: input.outletCount ?? null,
    source: input.source ? input.source.toUpperCase() : null,
    mapsUrl: input.mapsUrl ?? null,
    notes: input.notes ?? null,
    lostReason: input.lostReason ?? null,
    nextFollowUpAt: input.nextFollowUpAt ?? null,
    lastContactedAt: input.lastContactedAt ?? (CONTACT_STAGES.includes(stage) ? new Date() : null),
    tenantId: input.tenantId ?? null,
    dedupeKey: buildLeadDedupeKey(input),
  };
}

export async function listLeads(params: {
  page: number;
  limit: number;
  stage?: LeadStage;
  segment?: string;
  tier?: string;
  search?: string;
  dueOnly?: boolean;
}) {
  const where: Prisma.LeadWhereInput = {};
  if (params.stage) where.stage = params.stage;
  if (params.segment) where.segment = params.segment.toUpperCase();
  if (params.tier) where.tier = params.tier.toUpperCase();
  if (params.search) {
    where.OR = [
      { name: { contains: params.search, mode: 'insensitive' } },
      { phone: { contains: params.search } },
      { area: { contains: params.search, mode: 'insensitive' } },
      { notes: { contains: params.search, mode: 'insensitive' } },
    ];
  }
  if (params.dueOnly) {
    where.nextFollowUpAt = { lte: new Date() };
    where.stage = where.stage ?? { notIn: ['WON', 'LOST'] };
  }

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { score: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    items,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.limit)),
    },
  };
}

export async function getLeadSummary() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [byStage, bySegment, newThisWeek, dueFollowUps, total] = await Promise.all([
    prisma.lead.groupBy({ by: ['stage'], _count: { _all: true } }),
    prisma.lead.groupBy({ by: ['segment'], _count: { _all: true } }),
    prisma.lead.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.lead.count({ where: { nextFollowUpAt: { lte: now }, stage: { notIn: ['WON', 'LOST'] } } }),
    prisma.lead.count(),
  ]);

  return {
    total,
    newThisWeek,
    dueFollowUps,
    byStage: byStage.map((row) => ({ stage: row.stage, count: row._count._all })),
    bySegment: bySegment
      .map((row) => ({ segment: row.segment, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function createLead(input: LeadInput) {
  try {
    return await prisma.lead.create({ data: toCreateData(input) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('Lead dengan tempat/telepon/nama yang sama sudah ada', 409);
    }
    throw error;
  }
}

export async function updateLead(id: string, input: Partial<LeadInput>) {
  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Lead tidak ditemukan', 404);
  }

  const upper = (value: string | null | undefined) => (typeof value === 'string' ? value.toUpperCase() : value);
  const data: Prisma.LeadUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.segment !== undefined ? { segment: input.segment.trim().toUpperCase() } : {}),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(input.tier !== undefined ? { tier: upper(input.tier) } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.area !== undefined ? { area: input.area } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.instagram !== undefined ? { instagram: input.instagram } : {}),
    ...(input.rating !== undefined ? { rating: input.rating } : {}),
    ...(input.reviewCount !== undefined ? { reviewCount: input.reviewCount } : {}),
    ...(input.outletCount !== undefined ? { outletCount: input.outletCount } : {}),
    ...(input.source !== undefined ? { source: upper(input.source) } : {}),
    ...(input.mapsUrl !== undefined ? { mapsUrl: input.mapsUrl } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.lostReason !== undefined ? { lostReason: input.lostReason } : {}),
    ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : {}),
    ...(input.lastContactedAt !== undefined ? { lastContactedAt: input.lastContactedAt } : {}),
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
  };

  // Pindah tahap ke tahap "sudah dihubungi" mencatat waktu kontak terakhir otomatis.
  if (input.stage && input.stage !== existing.stage && CONTACT_STAGES.includes(input.stage) && input.lastContactedAt === undefined) {
    data.lastContactedAt = new Date();
  }

  // Kunci anti-dobel ikut diperbarui saat nama/telepon/maps/segmen diubah,
  // supaya impor CSV berikutnya tetap mengenali lead ini.
  if (input.name !== undefined || input.phone !== undefined || input.mapsUrl !== undefined || input.segment !== undefined) {
    data.dedupeKey = buildLeadDedupeKey({
      name: input.name ?? existing.name,
      phone: input.phone !== undefined ? input.phone : existing.phone,
      mapsUrl: input.mapsUrl !== undefined ? input.mapsUrl : existing.mapsUrl,
      segment: input.segment ?? existing.segment,
    });
  }

  try {
    return await prisma.lead.update({ where: { id }, data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('Sudah ada lead lain dengan tempat/telepon/nama yang sama', 409);
    }
    throw error;
  }
}

export async function deleteLead(id: string) {
  const existing = await prisma.lead.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw new AppError('Lead tidak ditemukan', 404);
  }
  await prisma.lead.delete({ where: { id } });
}

export async function importLeads(inputs: LeadInput[]) {
  const seen = new Set<string>();
  const rows: Prisma.LeadCreateManyInput[] = [];
  let duplicatesInFile = 0;

  for (const input of inputs) {
    const data = toCreateData(input) as Prisma.LeadCreateManyInput;
    if (data.dedupeKey && seen.has(data.dedupeKey)) {
      duplicatesInFile += 1;
      continue;
    }
    if (data.dedupeKey) seen.add(data.dedupeKey);
    rows.push(data);
  }

  const result = await prisma.lead.createMany({ data: rows, skipDuplicates: true });

  return {
    received: inputs.length,
    created: result.count,
    skippedExisting: rows.length - result.count,
    duplicatesInFile,
  };
}

export const LeadService = {
  listLeads,
  getLeadSummary,
  createLead,
  updateLead,
  deleteLead,
  importLeads,
};
