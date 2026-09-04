import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Single admin, no user table. Set ADMIN_PASSWORD in the environment.
  adminPassword: process.env.ADMIN_PASSWORD ?? '',

  // Salt for hashing voter IPs so we never store a raw address.
  ipHashSalt: process.env.IP_HASH_SALT ?? 'cricket-polls-dev-salt',

  // Soft backup guard. Stadium wifi puts a whole stand behind one NAT address,
  // so this is a generous per-poll ceiling, not a one-vote-per-IP rule.
  maxVotesPerIpPerPoll: int(process.env.MAX_VOTES_PER_IP_PER_POLL, 40),

  databaseFile:
    process.env.DATABASE_FILE ?? path.join(backendRoot, 'data', 'cricket-polls.sqlite'),

  // Comma-separated list, or '*' to allow any origin (fine for a public poll API).
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};

export const CHANNELS = ['web', 'whatsapp', 'telegram', 'app'];
export const POLL_STATUSES = ['draft', 'live', 'closed'];
