#!/usr/bin/env node
// Backs up every domain database (one pg_dump per DB, custom format) plus
// the MinIO object store (a tar of its data volume) into backups/<timestamp>/.
// Entirely read-only against the running stack -- nothing here stops,
// restarts, or mutates a live container or volume. See restore-drill.mjs for
// the only script that performs a restore, and it never touches the live
// containers either (it restores into disposable, throwaway ones).
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const POSTGRES_CONTAINER = "malawi-onegov-postgres-1";
const MINIO_VOLUME = "malawi-onegov_onegov-minio-data";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1024 * 1024 * 1024, ...opts });
}

function containerEnv(container, name) {
  return run("docker", ["exec", container, "printenv", name]).toString().trim();
}

/** Reads the true list of per-service databases from the same script that creates them, so this can never drift out of sync with what's actually deployed. */
function databaseNames() {
  const script = readFileSync(path.join(ROOT, "infra/postgres-init/init-multiple-dbs.sh"), "utf8");
  const match = script.match(/for db in ([\w\s]+); do/);
  if (!match) throw new Error("could not find the database list in infra/postgres-init/init-multiple-dbs.sh");
  return match[1].trim().split(/\s+/);
}

function fileSizeKb(filePath) {
  return (statSync(filePath).size / 1024).toFixed(1);
}

const postgresUser = containerEnv(POSTGRES_CONTAINER, "POSTGRES_USER");

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(ROOT, "backups", timestamp);
mkdirSync(outDir, { recursive: true });

console.log(`Backing up to backups/${timestamp}/\n`);

const databases = databaseNames();
for (const db of databases) {
  process.stdout.write(`  pg_dump ${db} ... `);
  const dump = run("docker", ["exec", POSTGRES_CONTAINER, "pg_dump", "-U", postgresUser, "-Fc", db]);
  const dumpPath = path.join(outDir, `${db}.dump`);
  writeFileSync(dumpPath, dump);
  console.log(`${fileSizeKb(dumpPath)} KB`);
}

process.stdout.write("  minio object store (volume archive) ... ");
run("docker", [
  "run",
  "--rm",
  "-v",
  `${MINIO_VOLUME}:/data:ro`,
  "-v",
  `${outDir}:/backup`,
  "alpine",
  "tar",
  "czf",
  "/backup/minio-data.tar.gz",
  "-C",
  "/data",
  ".",
]);
console.log(`${fileSizeKb(path.join(outDir, "minio-data.tar.gz"))} KB`);

writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify({ takenAt: new Date().toISOString(), postgresUser, databases, includesMinio: true }, null, 2)
);

console.log(`\nDone. ${databases.length} databases + MinIO object store backed up to backups/${timestamp}/`);
console.log(`Verify this backup actually restores with: npm run restore-drill`);
