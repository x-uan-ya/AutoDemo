/**
 * Apply the AutoDemo schema to Neon / Lakebase Postgres.
 *
 * Uses the DIRECT (unpooled) connection string — migrations need session state
 * that the PgBouncer-pooled connection does not support. Reads from
 * DATABASE_URL_UNPOOLED, falling back to DATABASE_URL if the unpooled one is
 * absent. Loads env from .env.local (what `neon env pull` writes).
 *
 * Run: node --env-file=.env.local scripts/db-migrate.mjs
 *   (or `npm run db:migrate`)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "..", "src", "lib", "db", "schema.sql");

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    "No DATABASE_URL_UNPOOLED or DATABASE_URL in the environment. " +
      "Run with: node --env-file=.env.local scripts/db-migrate.mjs"
  );
  process.exit(1);
}

const sql = readFileSync(schemaPath, "utf8");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: true },
});

try {
  await client.connect();
  await client.query(sql);
  console.log("Schema applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
