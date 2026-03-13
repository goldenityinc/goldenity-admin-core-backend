import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

const dotenvResult = dotenv.config();
if (dotenvResult.parsed?.DATABASE_URL) {
  process.env.DATABASE_URL = dotenvResult.parsed.DATABASE_URL;
}

const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});

export default prisma;
