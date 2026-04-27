import { Prisma } from '@prisma/client';

export function serializeForJson<T>(value: T): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue: unknown) => {
      if (typeof currentValue === 'bigint') {
        return currentValue.toString();
      }

      if (currentValue instanceof Prisma.Decimal) {
        return currentValue.toNumber();
      }

      return currentValue;
    }),
  ) as unknown;
}