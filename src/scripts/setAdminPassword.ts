/**
 * Buat atau perbarui akun Super Admin dan set password-nya (login tanpa Firebase).
 *
 * Pemakaian (password lewat variabel lingkungan supaya tidak tersimpan di riwayat shell):
 *   ADMIN_NEW_PASSWORD='...' npx ts-node src/scripts/setAdminPassword.ts <email> [nama]
 *
 * - Email sudah ada  → role dijadikan SUPER_ADMIN, aktif, password diganti.
 * - Email belum ada  → dibuat di tenant internal "goldenity-internal".
 * Script tidak pernah mencetak password.
 */
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import prisma from '../config/database';
import { ADMIN_PASSWORD_MIN_LENGTH } from '../services/adminAuthService';

dotenv.config();

const INTERNAL_TENANT_SLUG = 'goldenity-internal';
const INTERNAL_TENANT_NAME = 'Goldenity Internal';

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const nameArg = process.argv.slice(3).join(' ').trim();
  const password = process.env.ADMIN_NEW_PASSWORD ?? '';

  if (!email || !email.includes('@')) {
    throw new Error('Pemakaian: ADMIN_NEW_PASSWORD=... ts-node src/scripts/setAdminPassword.ts <email> [nama]');
  }
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_NEW_PASSWORD wajib diisi, minimal ${ADMIN_PASSWORD_MIN_LENGTH} karakter.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: 'SUPER_ADMIN', isActive: true, passwordHash, ...(nameArg ? { name: nameArg } : {}) },
    });
    console.log(`Password Super Admin diperbarui untuk ${existing.email}.`);
    return;
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: INTERNAL_TENANT_SLUG },
    update: { isActive: true },
    create: { name: INTERNAL_TENANT_NAME, slug: INTERNAL_TENANT_SLUG, isActive: true },
  });

  await prisma.user.create({
    data: {
      email,
      name: nameArg || email.split('@')[0],
      role: 'SUPER_ADMIN',
      tenantId: tenant.id,
      isActive: true,
      passwordHash,
    },
  });
  console.log(`Super Admin baru dibuat: ${email} (tenant ${INTERNAL_TENANT_SLUG}).`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
