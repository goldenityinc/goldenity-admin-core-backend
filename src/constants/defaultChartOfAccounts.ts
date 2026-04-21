import type { AccountCategoryType, AccountNormalBalance } from '@prisma/client';

export type DefaultChartOfAccountEntry = {
  code: string;
  name: string;
  category: AccountCategoryType;
  normalBalance: AccountNormalBalance;
  description?: string;
  isSystem?: boolean;
  parentCode?: string;
};

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultChartOfAccountEntry[] = [
  {
    code: '1101',
    name: 'Kas Besar',
    category: 'ASSET',
    normalBalance: 'DEBIT',
    description: 'Kas tunai utama operasional perusahaan.',
    isSystem: true,
  },
  {
    code: '1102',
    name: 'Bank',
    category: 'ASSET',
    normalBalance: 'DEBIT',
    description: 'Saldo rekening bank operasional.',
    isSystem: true,
  },
  {
    code: '1201',
    name: 'Piutang Usaha',
    category: 'ASSET',
    normalBalance: 'DEBIT',
    description: 'Piutang dari transaksi penjualan kredit.',
    isSystem: true,
  },
  {
    code: '1301',
    name: 'Persediaan',
    category: 'ASSET',
    normalBalance: 'DEBIT',
    description: 'Nilai persediaan barang dagang.',
    isSystem: true,
  },
  {
    code: '2101',
    name: 'Utang Usaha',
    category: 'LIABILITY',
    normalBalance: 'CREDIT',
    description: 'Kewajiban kepada supplier atau vendor.',
    isSystem: true,
  },
  {
    code: '3101',
    name: 'Modal Saham',
    category: 'EQUITY',
    normalBalance: 'CREDIT',
    description: 'Setoran modal pemilik atau investor.',
    isSystem: true,
  },
  {
    code: '3201',
    name: 'Laba Ditahan',
    category: 'EQUITY',
    normalBalance: 'CREDIT',
    description: 'Akumulasi laba bersih yang tidak dibagikan.',
    isSystem: true,
  },
  {
    code: '4101',
    name: 'Pendapatan Penjualan',
    category: 'REVENUE',
    normalBalance: 'CREDIT',
    description: 'Pendapatan utama dari penjualan barang atau jasa.',
    isSystem: true,
  },
  {
    code: '5101',
    name: 'Harga Pokok Penjualan',
    category: 'EXPENSE',
    normalBalance: 'DEBIT',
    description: 'Beban pokok atas barang yang terjual.',
    isSystem: true,
  },
  {
    code: '6101',
    name: 'Biaya Operasional',
    category: 'EXPENSE',
    normalBalance: 'DEBIT',
    description: 'Biaya operasional umum di luar HPP.',
    isSystem: true,
  },
];