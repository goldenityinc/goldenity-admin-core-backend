import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

export function internalServiceAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const expectedToken =
    process.env.ADMIN_CORE_INTERNAL_TOKEN?.trim() ||
    process.env.INTERNAL_SERVICE_TOKEN?.trim() ||
    '';

  if (!expectedToken) {
    return next(
      new AppError('ADMIN_CORE_INTERNAL_TOKEN is not configured', 500),
    );
  }

  const providedToken = (req.headers['x-internal-token'] || '')
    .toString()
    .trim();

  if (!providedToken || providedToken !== expectedToken) {
    return next(new AppError('Unauthorized internal service call', 401));
  }

  return next();
}