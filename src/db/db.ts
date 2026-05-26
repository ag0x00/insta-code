/**
 * SQLite database singleton using bun:sqlite.
 * Opens with WAL mode + busy_timeout for concurrent read safety.
 */

import { Database } from "bun:sqlite";
import { config } from "../shared/config";

let _db: Database | null = null;

/**
 * Opens a bun:sqlite Database at the given path with WAL mode and
 * a 5-second busy timeout. Safe to call multiple times — returns the
 * same instance.
 */
export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/**
 * Lazily-opened singleton keyed off config.DB_PATH.
 * Use this in all application code.
 */
export function getDb(): Database {
  if (!_db) {
    _db = openDb(config.DB_PATH);
  }
  return _db;
}

/**
 * Close the singleton (useful in tests to release the DB handle).
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
