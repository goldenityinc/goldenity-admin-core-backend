import * as crypto from 'crypto';

const INT32_MAX = 2147483647;

export function clientIdToNumericBigInt(clientId: string | number | bigint | null | undefined): bigint {
  const raw = (clientId ?? '').toString().trim();
  if (raw === '') return BigInt(1);

  if (typeof clientId === 'bigint') return clientId > BigInt(0) ? clientId : BigInt(1);
  if (typeof clientId === 'number' && Number.isFinite(clientId) && clientId > 0) {
    try { return BigInt(Math.floor(clientId)); } catch { /* fallthrough */ }
  }

  if (/^\d+$/.test(raw)) {
    try {
      const b = BigInt(raw);
      if (b > BigInt(0)) return b;
    } catch { /* fallthrough */ }
  }

  const hex = crypto.createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 15);
  let b = BigInt('0x' + (hex || '01'));
  const MOD = BigInt(INT32_MAX);
  if (b > MOD) b = b % MOD;
  if (b <= BigInt(0)) b = BigInt(1);
  return b;
}

export function clientIdToNumber(clientId: string | number | bigint | null | undefined): number {
  try {
    const b = clientIdToNumericBigInt(clientId);
    const n = Number(b);
    if (!Number.isFinite(n) || n <= 0) return 1;
    if (n > INT32_MAX) return Math.floor(n % INT32_MAX);
    return n;
  } catch {
    return 1;
  }
}
