import { Prisma, PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

const dotenvResult = dotenv.config();
if (dotenvResult.parsed?.DATABASE_URL) {
  process.env.DATABASE_URL = dotenvResult.parsed.DATABASE_URL;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PRISMA_LOG_LEVELS: Array<'query' | 'info' | 'warn' | 'error'> = ['warn', 'error'];
if (process.env.NODE_ENV !== 'production') {
  PRISMA_LOG_LEVELS.push('info');
  if (process.env.ENABLE_QUERY_LOG === '1' || process.env.ENABLE_QUERY_LOG === 'true') {
    PRISMA_LOG_LEVELS.push('query');
  }
}

const prisma = new PrismaClient({
  log: PRISMA_LOG_LEVELS,
  transactionOptions: {
    maxWait: parsePositiveInt(process.env.PRISMA_TX_MAX_WAIT_MS, 8000),
    timeout: parsePositiveInt(process.env.PRISMA_TX_TIMEOUT_MS, 20000),
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  },
  errorFormat: process.env.NODE_ENV === 'production' ? 'minimal' : 'pretty',
});

export default prisma;
