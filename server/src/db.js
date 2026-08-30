/* ==========================================================================
   Wells Safety API — storage.

   node:sqlite ships with Node, so this whole server has no npm dependencies.
   Nothing to install, nothing to audit, nothing to break on deploy.
   ========================================================================== */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.DB_FILE || "/data/wellssafety.db";

mkdirSync(dirname(FILE), { recursive: true });

export const db = new DatabaseSync(FILE);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'starter',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'driver',   -- owner | dispatch | driver
  pw_hash     TEXT NOT NULL,
  pw_salt     TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  last_seen   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- The office book (invoices, customers, drivers, settings) as one versioned
-- document. A one-truck outfit does not need row-level sync, and whole-document
-- writes with a version check cannot half-apply.
CREATE TABLE IF NOT EXISTS books (
  account_id  TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 0,
  doc         TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  filed_at    TEXT NOT NULL,
  driver      TEXT,
  customer    TEXT,
  load_ref    TEXT,
  doc         TEXT NOT NULL,
  invoice_id  TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  idx         INTEGER NOT NULL,
  mime        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  path        TEXT NOT NULL
);

-- Shared invoice links for customers.
CREATE TABLE IF NOT EXISTS shares (
  token       TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  invoice_id  TEXT NOT NULL,
  doc         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,
  last_view   TEXT
);

-- Free trial usage. A paid feature works a handful of times before it locks,
-- so the value is felt before the invoice arrives.
CREATE TABLE IF NOT EXISTS trials (
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  first_used  TEXT,
  last_used   TEXT,
  PRIMARY KEY (account_id, feature)
);

-- Customer reviews. Submitted by the public, held until someone approves
-- them, so the site never shows whatever a stranger typed.
CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  company     TEXT,
  role        TEXT,
  rating      INTEGER NOT NULL,
  body        TEXT NOT NULL,
  load_ref    TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  ip_hash     TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_account ON reports(account_id, filed_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_report ON photos(report_id, idx);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_invoice ON shares(account_id, invoice_id);
`);

export const now = () => new Date().toISOString();

/* Clear out expired sessions on boot and hourly. */
export function sweepSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
}
sweepSessions();
setInterval(sweepSessions, 3600_000).unref();
