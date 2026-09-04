import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { ApiError, unauthorized } from '../lib/errors.js';

/** Constant-time compare so the password can't be probed a character at a time. */
function matches(supplied, expected) {
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Single-admin auth: one password from the environment, no user table.
 * Accepts `Authorization: Bearer <password>` or an `x-admin-password` header.
 */
export function requireAdmin(req, _res, next) {
  if (!config.adminPassword) {
    return next(
      new ApiError(
        503,
        'admin_not_configured',
        'ADMIN_PASSWORD is not set on the server, so the admin API is disabled.',
      ),
    );
  }

  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const supplied = bearer || req.get('x-admin-password') || '';

  if (!supplied || !matches(supplied, config.adminPassword)) {
    return next(unauthorized());
  }
  return next();
}
