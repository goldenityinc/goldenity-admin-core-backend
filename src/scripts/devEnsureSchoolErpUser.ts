import prisma from '../config/database';
import { hashPassword } from '../utils/password';

async function main(): Promise<void> {
  const tenantSlug = (process.env.TENANT_SLUG ?? 'company-anggi-1').trim();
  const email = (process.env.USER_EMAIL ?? 'anggi@local.test').trim().toLowerCase();
  const password = process.env.USER_PASSWORD ?? '123456';
  const name = (process.env.USER_NAME ?? 'Anggi (School ERP)').trim();
  const role = (process.env.USER_ROLE ?? 'TENANT_ADMIN').trim();

  if (!tenantSlug) {
    throw new Error('TENANT_SLUG wajib diisi');
  }
  if (!email) {
    throw new Error('USER_EMAIL wajib diisi');
  }
  if (!password) {
    throw new Error('USER_PASSWORD wajib diisi');
  }

  const tenant = await prisma.tenant.findFirst({
    where: {
      slug: tenantSlug,
    },
    select: { id: true, slug: true, name: true, isActive: true },
  });

  if (!tenant) {
    throw new Error(`Tenant tidak ditemukan: ${tenantSlug}`);
  }
  if (!tenant.isActive) {
    throw new Error(`Tenant tidak aktif: ${tenantSlug}`);
  }

  const passwordHash = await hashPassword(password);

  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { id: true, tenantId: true, allowedSolutions: true },
  });

  const allowedSolutions = Array.from(
    new Set([...(existingUser?.allowedSolutions ?? []), 'SCHOOL_ERP']),
  );

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      username: email,
      tenantId: tenant.id,
      role: role as any,
      allowedSolutions,
      passwordHash,
      isActive: true,
    },
    create: {
      name,
      email,
      username: email,
      tenantId: tenant.id,
      role: role as any,
      allowedSolutions,
      passwordHash,
      isActive: true,
    },
    select: {
      id: true,
      email: true,
      name: true,
      tenantId: true,
      role: true,
      allowedSolutions: true,
      isActive: true,
    },
  });

  console.log('OK', { tenant, user });
}

main()
  .catch((err) => {
    console.error('FAILED', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
