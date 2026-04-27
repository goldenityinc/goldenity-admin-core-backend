import { AccountCategoryType } from '@prisma/client';
import prisma from '../config/database';

const ACCOUNT_CATEGORY_SEED: Array<{
  code: AccountCategoryType;
  name: string;
  description: string;
  sortOrder: number;
}> = [
  {
    code: AccountCategoryType.ASSET,
    name: 'Asset',
    description: 'Kelompok akun harta atau sumber daya ekonomi milik tenant.',
    sortOrder: 10,
  },
  {
    code: AccountCategoryType.LIABILITY,
    name: 'Liability',
    description: 'Kelompok akun kewajiban atau utang tenant kepada pihak lain.',
    sortOrder: 20,
  },
  {
    code: AccountCategoryType.EQUITY,
    name: 'Equity',
    description: 'Kelompok akun modal, ekuitas pemilik, dan laba ditahan.',
    sortOrder: 30,
  },
  {
    code: AccountCategoryType.REVENUE,
    name: 'Revenue',
    description: 'Kelompok akun pendapatan usaha dan pendapatan lain-lain.',
    sortOrder: 40,
  },
  {
    code: AccountCategoryType.EXPENSE,
    name: 'Expense',
    description: 'Kelompok akun beban pokok, operasional, dan biaya lain-lain.',
    sortOrder: 50,
  },
];

async function main() {
  for (const category of ACCOUNT_CATEGORY_SEED) {
    await prisma.accountCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        isActive: true,
      },
      create: {
        code: category.code,
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        isActive: true,
      },
    });
  }

  console.log(`SUCCESS: Seeded ${ACCOUNT_CATEGORY_SEED.length} account categories`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('FAILED:', message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });