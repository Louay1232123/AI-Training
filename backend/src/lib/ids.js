import { randomUUID, createHash } from 'node:crypto';
import { config } from '../config.js';

export const newId = () => randomUUID();

export const nowIso = () => new Date().toISOString();

/** One-way hash so a voter's raw IP address never reaches the database. */
export function hashIp(ip) {
  if (!ip) return null;
  return createHash('sha256').update(`${config.ipHashSalt}:${ip}`).digest('hex');
}
