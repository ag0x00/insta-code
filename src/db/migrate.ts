#!/usr/bin/env bun
/**
 * Idempotent migration runner.
 * Reads src/db/schema.sql and executes all DDL statements against the
 * configured database. Safe to run multiple times (uses IF NOT EXISTS).
 *
 * Usage: bun run migrate
 */

import { join } from "path";
import { openDb } from "./db";
import { config } from "../shared/config";

const SCHEMA_PATH = join(import.meta.dir, "schema.sql");

export async function runMigration(dbPath: string = config.DB_PATH): Promise<void> {
  const sql = await Bun.file(SCHEMA_PATH).text();
  const db = openDb(dbPath);

  // Strip all SQL comments (both line-start and inline) before splitting on ";".
  // This avoids splitting on semicolons that appear inside comment text.
  const stripped = sql
    .split("\n")
    .map((line) => {
      // Remove inline and full-line SQL comments: everything from "--" onwards
      const commentIdx = line.indexOf("--");
      return commentIdx >= 0 ? line.substring(0, commentIdx) : line;
    })
    .join("\n");

  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    // PRAGMA journal_mode and busy_timeout are already applied by openDb;
    // skip them here to avoid redundant execution.
    if (/^PRAGMA\s+(journal_mode|busy_timeout)/i.test(stmt)) continue;
    db.run(stmt);
  }

  console.log(`[migrate] Schema applied to ${dbPath}`);
  db.close();
}

// Run when invoked directly
if (import.meta.main) {
  await runMigration();
}
