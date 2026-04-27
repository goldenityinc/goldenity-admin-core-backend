import prisma from '../config/database';

type SolutionSeed = {
  name: string;
  code: string;
  description: string;
};

const seeds: SolutionSeed[] = [
  {
    name: 'POS Ecosystem',
    code: 'POS',
    description: 'Point of Sale suite for retail, restaurant, and service operations.',
  },
  {
    name: 'ERP Suite',
    code: 'ERP',
    description: 'Enterprise resource planning for finance, inventory, procurement, and operations.',
  },
  {
    name: 'Clinic Management',
    code: 'CLINIC',
    description: 'Healthcare operations suite for appointments, patient records, and billing workflows.',
  },
];

async function main() {
  for (const seed of seeds) {
    await prisma.solution.upsert({
      where: { code: seed.code },
      update: {
        name: seed.name,
        description: seed.description,
        isActive: true,
      },
      create: {
        name: seed.name,
        code: seed.code,
        description: seed.description,
        isActive: true,
      },
    });
  }

  console.log(`SUCCESS: Seeded ${seeds.length} solutions`);
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
