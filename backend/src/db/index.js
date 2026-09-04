import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db;

/**
 * Opens (once) the single SQLite file and applies the schema.
 * `:memory:` is honoured so tests can run against a throwaway database.
 */
export function getDb() {
  if (db) return db;

  if (config.databaseFile !== ':memory:') {
    fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
  }

  db = new Database(config.databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}
