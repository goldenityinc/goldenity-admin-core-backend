import dotenv from 'dotenv';
import admin from '../config/firebase';
import prisma from '../config/database';

dotenv.config();

const INTERNAL_TENANT_SLUG = 'goldenity-internal';
const INTERNAL_TENANT_NAME = 'Goldenity Internal';

async function main() {
  const emailArg = process.argv[2]?.trim();
  if (!emailArg) {
    throw new Error('Usage: ts-node src/scripts/setSuperAdmin.ts <user-email>');
  }

  const userRecord = await admin.auth().getUserByEmail(emailArg);

  await admin.auth().setCustomUserClaims(userRecord.uid, {
    role: 'SUPER_ADMIN',
    superAdmin: true,
  });

  const internalTenant = await prisma.tenant.upsert({
    where: { slug: INTERNAL_TENANT_SLUG },
    update: {
      name: INTERNAL_TENANT_NAME,
      isActive: true,
    },
    create: {
      name: INTERNAL_TENANT_NAME,
      slug: INTERNAL_TENANT_SLUG,
      isActive: true,
    },
  });

  const fallbackName =
    userRecord.displayName?.trim() ||
    userRecord.email?.split('@')[0] ||
    'Super Admin';

  const existingUserByEmail = userRecord.email
    ? await prisma.user.findUnique({
        where: { email: userRecord.email },
      })
    : null;

  if (existingUserByEmail && existingUserByEmail.firebaseUid !== userRecord.uid) {
    await prisma.user.update({
      where: { id: existingUserByEmail.id },
      data: {
        firebaseUid: userRecord.uid,
        email: userRecord.email ?? emailArg,
        name: existingUserByEmail.name || fallbackName,
        role: 'SUPER_ADMIN',
        tenantId: internalTenant.id,
        isActive: true,
      },
    });
  } else {
    await prisma.user.upsert({
      where: { firebaseUid: userRecord.uid },
      update: {
        email: userRecord.email ?? emailArg,
        name: fallbackName,
        role: 'SUPER_ADMIN',
        tenantId: internalTenant.id,
        isActive: true,
      },
      create: {
        firebaseUid: userRecord.uid,
        email: userRecord.email ?? emailArg,
        name: fallbackName,
        role: 'SUPER_ADMIN',
        tenantId: internalTenant.id,
        isActive: true,
      },
    });
  }

  // Optional: force refresh token on next sign-in to ensure claims are updated.
  await admin.auth().revokeRefreshTokens(userRecord.uid);

  console.log('SUCCESS: SUPER_ADMIN claim applied');
  console.log(`Email: ${emailArg}`);
  console.log(`UID: ${userRecord.uid}`);
  console.log(`Tenant: ${INTERNAL_TENANT_NAME} (${internalTenant.id})`);
  console.log('Database user record synced.');
  console.log('Please logout and login again on frontend to refresh ID token.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error('FAILED:', message);
  prisma.$disconnect().catch(() => undefined);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
