import { Prisma } from '@prisma/client';
import prisma from '../config/database';

const TRANSIENT_PRISMA_ERROR_CODES = new Set([
  'P2024',
  'P40001',
  'P1001',
  'P1008',
  'P1017',
  'P2001',
  'P2020',
  'P2025',
  'P2026',
  'P2028',
  'P2033',
  'P2050',
  'P2051',
  'P2055',
]);

const SERIALIZATION_SQLSTATES = new Set(['40001', '40P01', '55P03', '55006', '08001', '08006', '08004']);

type ResolvedClient = typeof prisma;
type AnyTxClient = Parameters<Parameters<ResolvedClient['$transaction']>[0]>[0];

type WithTransactionOptions = {
  maxAttempts?: number;
  initialBackoffMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
};

export function isTransientPrismaError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (TRANSIENT_PRISMA_ERROR_CODES.has(error.code)) {
      return true;
    }
    const meta = (error.meta ?? {}) as Record<string, unknown>;
    const sqlstate = String(meta.sqlstate ?? meta.code ?? '').toUpperCase();
    if (SERIALIZATION_SQLSTATES.has(sqlstate)) {
      return true;
    }
  }
  if (error instanceof Prisma.PrismaClientValidationError) {
    return false;
  }
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientRustPanicError) {
    return true;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return true;
  }
  if (error instanceof Prisma.NotFoundError) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  const upper = message.toUpperCase();
  return (
    upper.includes('DEADLOCK') ||
    upper.includes('SERIALIZATION') ||
    upper.includes('COULD NOT SERIALIZE ACCESS') ||
    upper.includes('CONNECTION POOL') ||
    upper.includes('TIMEOUT') ||
    upper.includes('TIMED OUT') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('ECONNREFUSED') ||
    upper.includes('ECONNRESET') ||
    upper.includes('CONNECTION ABORTED') ||
    upper.includes('LOCK WAIT') ||
    upper.includes('TOO MANY CONNECTIONS')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransaction<T>(
  fn: (tx: AnyTxClient) => Promise<T>,
  options: WithTransactionOptions = {},
): Promise<T> {
  const {
    maxAttempts = 6,
    initialBackoffMs = 75,
    isolationLevel = Prisma.TransactionIsolationLevel.Serializable,
    timeoutMs = 15_000,
  } = options;

  let lastError: unknown = null;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const result = await Promise.race([
        prisma.$transaction<T>(async (tx) => fn(tx), { isolationLevel }),
        new Promise<never>((_, reject) => {
          const id = setTimeout(() => {
            const err = new Error(
              `Prisma transaction exceeded timeout=${timeoutMs}ms after attempt=${attempt}`,
            );
            (err as Error & { code?: string }).code = 'TXN_TIMEOUT';
            reject(err);
          }, timeoutMs);
          id.unref?.();
        }),
      ]);
      return result;
    } catch (error) {
      lastError = error;
      if (!isTransientPrismaError(error)) {
        throw error;
      }
      if (attempt >= maxAttempts) {
        break;
      }
      const backoff = Math.min(
        3000,
        initialBackoffMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 50),
      );
      const safeErr = error instanceof Error
        ? { name: error.name, message: error.message, code: (error as { code?: string }).code }
        : error;
      console.warn(
        '[retryTransaction] transient failure, retrying',
        JSON.stringify({ attempt, maxAttempts, backoffMs: backoff, error: safeErr }),
      );
      await sleep(backoff);
    }
  }

  throw lastError;
}

export type { AnyTxClient, WithTransactionOptions };
