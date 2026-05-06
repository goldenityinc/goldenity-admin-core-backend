export const ROLE_PERMISSION_MODULE_KEYS = [
  'dasbor',
  'penjualan',
  'kas_bon',
  'inventaris',
  'daftar_belanja',
  'riwayat',
  'data_pelanggan',
  'laporan_keuangan',
  'laporan_shift',
  'pengeluaran',
  'data_supplier',
  'pengaturan',
  'manajemen_user',
  'laporan_pajak',
  'manajemen_kategori',
  'manajemen_role',
  'servis_perbaikan',
] as const;

export type RolePermissionModuleKey = (typeof ROLE_PERMISSION_MODULE_KEYS)[number];
