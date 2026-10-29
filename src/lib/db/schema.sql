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
