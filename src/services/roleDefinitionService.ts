import prisma from '../config/database';

export type PermissionEntry = { c: boolean; r: boolean; u: boolean; d: boolean };
export type PermissionsMap = Record<string, PermissionEntry>;

// ─── Daftar semua modul yang dikenal oleh sistem ───────────────────────────
const ALL_MODULES = [
  'penjualan', 'inventaris', 'daftar_belanja', 'riwayat',
  'kas_bon', 'data_pelanggan', 'laporan_keuangan', 'pengeluaran',
  'data_supplier', 'laporan_pajak', 'pengaturan', 'manajemen_user',
  'manajemen_kategori',
] as const;

const NO_ACCESS: PermissionEntry = { c: false, r: false, u: false, d: false };
const FULL_ACCESS: PermissionEntry = { c: true, r: true, u: true, d: true };

function buildFullAccess(): PermissionsMap {
  return Object.fromEntries(ALL_MODULES.map((m) => [m, { ...FULL_ACCESS }]));
}

/**
 * Seed 3 default roles (Admin, Kasir, Pajak) untuk tenant baru.
 * Menggunakan upsert sehingga aman dipanggil berulang kali — tidak akan
 * menimpa role yang sudah dikustomisasi user (update: {} pada branch update).
 */
export const seedDefaultRoles = async (tenantId: string): Promise<void> => {
  const kasirPerms: PermissionsMap = Object.fromEntries(
    ALL_MODULES.map((m) => [m, { ...NO_ACCESS }]),
  );
  // Sesuai hardcode lama: kasir bisa aksi di penjualan, daftar_belanja, riwayat, data_pelanggan
  kasirPerms['penjualan']     = { c: true, r: true, u: false, d: false };
  kasirPerms['daftar_belanja'] = { c: true, r: true, u: true, d: false };
  kasirPerms['riwayat']        = { c: false, r: true, u: false, d: false };
  kasirPerms['data_pelanggan'] = { c: false, r: true, u: false, d: false };

  const pajakPerms: PermissionsMap = Object.fromEntries(
    ALL_MODULES.map((m) => [m, { ...NO_ACCESS }]),
  );
  pajakPerms['laporan_pajak'] = { c: false, r: true, u: false, d: false };
  pajakPerms['penjualan']     = { c: false, r: true, u: false, d: false }; // Dasbor = penjualan view

  const defaults = [
    { name: 'Admin',  permissions: buildFullAccess(), description: 'Akses penuh ke semua fitur' },
    { name: 'Kasir',  permissions: kasirPerms,        description: 'Akses operasional kasir harian' },
    { name: 'Pajak',  permissions: pajakPerms,        description: 'Akses laporan pajak saja' },
  ];

  for (const r of defaults) {
    await prisma.customRole.upsert({
      where: { tenantId_name: { tenantId, name: r.name } },
      update: {}, // Jangan timpa customisasi user yang sudah ada
      create: {
        tenantId,
        name: r.name,
        description: r.description,
        isDefault: true,
        permissions: r.permissions,
      },
    });
  }
};

export const listCustomRoles = (tenantId: string) =>
  prisma.customRole.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });

export const getCustomRole = (tenantId: string, id: string) =>
  prisma.customRole.findFirst({ where: { id, tenantId } });

export const createCustomRole = (
  tenantId: string,
  name: string,
  permissions: PermissionsMap,
  description?: string,
) =>
  prisma.customRole.create({
    data: { tenantId, name, description, permissions },
  });

export const updateCustomRole = async (
  tenantId: string,
  id: string,
  data: { name?: string; description?: string; permissions?: PermissionsMap },
) => {
  const existing = await prisma.customRole.findFirst({ where: { id, tenantId } });
  if (!existing) return null;
  return prisma.customRole.update({ where: { id }, data });
};

export const deleteCustomRole = async (tenantId: string, id: string) => {
  const existing = await prisma.customRole.findFirst({ where: { id, tenantId } });
  if (!existing) return null;
  return prisma.customRole.delete({ where: { id } });
};

/**
 * Assign custom role ke user. Hanya bisa dilakukan di tier Professional/Enterprise.
 * Melepas binding ke enum role lama tidak dipaksakan di sini —
 * keduanya bisa co-exist selama transisi arsitektur.
 */
export const assignCustomRoleToUser = async (
  tenantId: string,
  userId: string,
  customRoleId: string | null,
) => {
  const user = await prisma.user.findFirst({ where: { id: userId, tenantId } });
  if (!user) return null;
  if (customRoleId !== null) {
    const role = await prisma.customRole.findFirst({ where: { id: customRoleId, tenantId } });
    if (!role) return null;
  }
  return prisma.user.update({ where: { id: userId }, data: { customRoleId } });
};
