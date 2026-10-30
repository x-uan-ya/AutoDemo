-- AutoDemo persistence schema (Neon / Lakebase Postgres).
-- Idempotent: safe to run repeatedly. Applied via scripts/db-migrate.mjs over
-- the DIRECT (unpooled) connection.

-- Users: email/password accounts. password_hash is a scrypt-encoded string;
-- plaintext passwords are never stored.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email lookups are case-insensitive at the app layer (emails are normalized to
-- lowercase before storage), so a plain unique index on email suffices.

-- Server-side sessions. sid is the opaque session id held in the HttpOnly
-- cookie. csrf_token is the double-submit token bound to the session.
CREATE TABLE IF NOT EXISTS sessions (
  sid        TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- Expiry sweeps and per-user lookups.
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- Demo jobs. The DemoJob is a deeply nested, evolving aggregate, so it is
-- stored as a single JSONB document (`doc`) keyed by id, scoped by owner_id.
-- All mutations are transactional read-modify-write of one row (SELECT ...
-- FOR UPDATE), which serializes concurrent writers across instances. In-flight
-- guards (recording/voice/render/language) live inside doc._inflight and are
-- claimed/released within the same transaction, so duplicate-job protection
-- holds across instances too.
CREATE TABLE IF NOT EXISTS demos (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  doc        JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Owner-scoped listing (plus shared seed demos), newest first.
CREATE INDEX IF NOT EXISTS demos_owner_id_idx ON demos (owner_id);
CREATE INDEX IF NOT EXISTS demos_created_at_idx ON demos (created_at DESC);
