export type JwtAuthPayload = {
  userId: string;
  tenantId: string;
  role?: string;
};

export function isJwtAuthPayload(value: unknown): value is JwtAuthPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<JwtAuthPayload>;

  return (
    typeof candidate.userId === 'string' && candidate.userId.length > 0 &&
    typeof candidate.tenantId === 'string' && candidate.tenantId.length > 0 &&
    (candidate.role === undefined || typeof candidate.role === 'string')
  );
}
