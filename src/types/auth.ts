export type JwtAuthPayload = {
  userId: string;
  tenantId: string;
  role?: string;
  tier?: string | null;
  addons?: string[];
};

export function isJwtAuthPayload(value: unknown): value is JwtAuthPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<JwtAuthPayload>;

  return (
    typeof candidate.userId === 'string' && candidate.userId.length > 0 &&
    typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0 &&
    (candidate.role === undefined || typeof candidate.role === 'string') &&
    (candidate.tier === undefined || candidate.tier === null || typeof candidate.tier === 'string') &&
    (candidate.addons === undefined || (Array.isArray(candidate.addons) && candidate.addons.every((item) => typeof item === 'string')))
  );
}
