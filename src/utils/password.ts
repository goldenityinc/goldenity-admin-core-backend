import bcrypt from 'bcryptjs';

const DEFAULT_SALT_ROUNDS = 12;

function resolveSaltRounds(): number {
  const parsed = Number.parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '', 10);

  if (Number.isNaN(parsed)) {
    return DEFAULT_SALT_ROUNDS;
  }

  return Math.min(Math.max(parsed, 4), 14);
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, resolveSaltRounds());
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  if (!plainPassword || !passwordHash) {
    return false;
  }

  return bcrypt.compare(plainPassword, passwordHash);
}
