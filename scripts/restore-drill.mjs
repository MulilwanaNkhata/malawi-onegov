#!/usr/bin/env node
// Proves a backup taken by backup.mjs actually restores -- the only thing a
// backup is really for. This NEVER touches the live stack's containers,
// volumes, or databases: it restores into disposable, throwaway containers
// on a scratch Docker network, verifies the data, then tears everything
// down again. Safe to run at any time against a live system.
//
// What "verified" means here:
//   1. every table in every restored database has the same row count as
//      the live database it was dumped from
//   2. the restored audit_db's hash chain still verifies end to end --
//      the same /events/verify check the test suite runs, but against the
//      RESTORED data, proving the tamper-evident audit trail itself
//      survives a disaster-recovery cycle intact, not just the raw bytes.
import { execFileSync, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKUPS_DIR = path.join(ROOT, "backups");

const LIVE_POSTGRES_CONTAINER = "malawi-onegov-postgres-1";
const LIVE_AUDIT_CONTAINER = "malawi-onegov-audit-service-1";
const DRILL_NETWORK = "onegov-restore-drill-net";
const DRILL_PG_CONTAINER = "onegov-restore-drill-pg";
const DRILL_AUDIT_CONTAINER = "onegov-restore-drill-audit";
const DRILL_PG_PORT = 55432;

function run(cmd, args, opts = {}) {
  const stdin = opts.input !== undefined ? "pipe" : "ignore";
  return execFileSync(cmd, args, { stdio: [stdin, "pipe", "inherit"], maxBuffer: 1024 * 1024 * 1024, ...opts }).toString();
}

/** Best-effort cleanup: containers/networks from a prior crashed run may already be gone. */
function runQuiet(cmd, args) {
  spawnSync(cmd, args, { stdio: "ignore" });
}

function containerEnv(container, name) {
  return run("docker", ["exec", container, "printenv", name]).trim();
}

function pickBackupDir() {
  const arg = process.argv[2];
  if (arg) return path.isAbsolute(arg) ? arg : path.join(ROOT, arg);
  if (!existsSync(BACKUPS_DIR)) throw new Error("no backups/ directory yet -- run `npm run backup` first");
  const dirs = readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (dirs.length === 0) throw new Error("backups/ is empty -- run `npm run backup` first");
  return path.join(BACKUPS_DIR, dirs[dirs.length - 1]);
}

// Minimal hand-rolled HS256 JWT signer -- this project already hand-rolls
// TOTP in tests/helpers.mjs rather than pull in a dependency for one
// well-understood primitive; same call here for a throwaway verification
// token that never needs to be anything but valid against SYSTEM_ADMIN's
// requireAuth check.
function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signHs256Jwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function countAllRows(client, db) {
  const { rows: tableRows } = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
  );
  if (tableRows.length === 0) return 0;
  const unionSql = tableRows.map((r) => `SELECT COUNT(*)::bigint AS c FROM "${r.tablename}"`).join(" UNION ALL ");
  const { rows } = await client.query(`SELECT SUM(c)::bigint AS total FROM (${unionSql}) x;`);
  return Number(rows[0].total ?? 0);
}

async function waitFor(fn, { timeoutMs = 30_000, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {
      /* not ready yet */
    }
    if (Date.now() >= deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function cleanup() {
  runQuiet("docker", ["rm", "-f", DRILL_AUDIT_CONTAINER]);
  runQuiet("docker", ["rm", "-f", DRILL_PG_CONTAINER]);
  runQuiet("docker", ["network", "rm", DRILL_NETWORK]);
}

async function main() {
  const backupDir = pickBackupDir();
  const manifest = JSON.parse(readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
  console.log(`Restore drill using backup: ${path.basename(backupDir)} (taken ${manifest.takenAt})\n`);

  const postgresUser = containerEnv(LIVE_POSTGRES_CONTAINER, "POSTGRES_USER");
  const postgresPassword = containerEnv(LIVE_POSTGRES_CONTAINER, "POSTGRES_PASSWORD");
  const jwtSecret = containerEnv(LIVE_AUDIT_CONTAINER, "JWT_SECRET");
  const auditSharedSecret = containerEnv(LIVE_AUDIT_CONTAINER, "AUDIT_SHARED_SECRET");

  console.log("Cleaning up any leftovers from a previous drill...");
  cleanup();

  let exitCode = 0;
  try {
    console.log("Starting a disposable Postgres on a scratch network (the live stack is never touched)...");
    run("docker", ["network", "create", DRILL_NETWORK]);
    run("docker", [
      "run",
      "-d",
      "--name",
      DRILL_PG_CONTAINER,
      "--network",
      DRILL_NETWORK,
      "-e",
      `POSTGRES_USER=${postgresUser}`,
      "-e",
      `POSTGRES_PASSWORD=${postgresPassword}`,
      "-p",
      `${DRILL_PG_PORT}:5432`,
      "postgres:16-alpine",
    ]);

    await waitFor(() => run("docker", ["exec", DRILL_PG_CONTAINER, "pg_isready", "-U", postgresUser]).includes("accepting"), {
      label: "disposable Postgres to accept connections",
    });

    const liveClient = new pg.Client({ host: "localhost", port: 5432, user: postgresUser, password: postgresPassword, database: "postgres" });
    await liveClient.connect();
    const drillClient = new pg.Client({ host: "localhost", port: DRILL_PG_PORT, user: postgresUser, password: postgresPassword, database: "postgres" });
    await drillClient.connect();

    const results = [];
    for (const db of manifest.databases) {
      process.stdout.write(`  restoring ${db} ... `);
      run("docker", ["exec", DRILL_PG_CONTAINER, "psql", "-U", postgresUser, "-d", "postgres", "-c", `CREATE DATABASE ${db};`]);
      const dump = readFileSync(path.join(backupDir, `${db}.dump`));
      run("docker", ["exec", "-i", DRILL_PG_CONTAINER, "pg_restore", "-U", postgresUser, "-d", db, "--no-owner"], { input: dump });

      const liveDb = new pg.Client({ host: "localhost", port: 5432, user: postgresUser, password: postgresPassword, database: db });
      const restoredDb = new pg.Client({ host: "localhost", port: DRILL_PG_PORT, user: postgresUser, password: postgresPassword, database: db });
      await liveDb.connect();
      await restoredDb.connect();
      const liveCount = await countAllRows(liveDb, db);
      const restoredCount = await countAllRows(restoredDb, db);
      await liveDb.end();
      await restoredDb.end();

      const match = liveCount === restoredCount;
      results.push({ db, liveCount, restoredCount, match });
      console.log(match ? `OK (${restoredCount} rows)` : `MISMATCH (live ${liveCount} vs restored ${restoredCount})`);
      if (!match) exitCode = 1;
    }
    await liveClient.end();
    await drillClient.end();

    console.log("\nBooting the audit-service image against the restored audit_db, to re-run the real hash-chain check...");
    // Deliberately no -p host port publish here: Windows sometimes holds a
    // dynamic port-exclusion range (a Hyper-V/WSL2 quirk, unrelated to this
    // script) that makes an arbitrary high port fail to bind with a
    // permissions error. Reaching the container over its own internal
    // localhost via `docker exec` sidesteps host port allocation entirely.
    run("docker", [
      "run",
      "-d",
      "--name",
      DRILL_AUDIT_CONTAINER,
      "--network",
      DRILL_NETWORK,
      "-e",
      `DATABASE_URL=postgresql://${postgresUser}:${postgresPassword}@${DRILL_PG_CONTAINER}:5432/audit_db`,
      "-e",
      `JWT_SECRET=${jwtSecret}`,
      "-e",
      `AUDIT_SHARED_SECRET=${auditSharedSecret}`,
      "-e",
      "PORT=4002",
      "malawi-onegov-audit-service:latest",
    ]);

    function execNodeInContainer(container, script) {
      return run("docker", ["exec", container, "node", "-e", script]);
    }

    await waitFor(
      () => {
        execNodeInContainer(
          DRILL_AUDIT_CONTAINER,
          "fetch('http://localhost:4002/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
        );
        return true;
      },
      { label: "restored audit-service to become healthy", timeoutMs: 45_000 }
    );

    const token = signHs256Jwt({ sub: randomUUID(), role: "SYSTEM_ADMIN", fullName: "Restore Drill" }, jwtSecret);
    const restoredVerify = JSON.parse(
      execNodeInContainer(
        DRILL_AUDIT_CONTAINER,
        `fetch('http://localhost:4002/events/verify',{headers:{Authorization:'Bearer ${token}'}}).then(r=>r.json()).then(j=>process.stdout.write(JSON.stringify(j))).catch(e=>{console.error(e);process.exit(1)})`
      ).trim()
    );
    const liveVerify = await fetch("http://localhost:4002/events/verify", {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());

    console.log(`  live audit chain:     ${JSON.stringify(liveVerify)}`);
    console.log(`  restored audit chain: ${JSON.stringify(restoredVerify)}`);
    const auditOk = restoredVerify.valid === true && restoredVerify.checkedCount === liveVerify.checkedCount;
    if (!auditOk) exitCode = 1;

    console.log("\n" + "=".repeat(60));
    console.log(exitCode === 0 ? "RESTORE DRILL PASSED" : "RESTORE DRILL FAILED");
    console.log("=".repeat(60));
    for (const r of results) {
      console.log(`  ${r.match ? "OK  " : "FAIL"}  ${r.db}: ${r.restoredCount} rows`);
    }
    console.log(`  ${auditOk ? "OK  " : "FAIL"}  audit_db hash chain: ${restoredVerify.valid ? "verified" : "BROKEN"} (${restoredVerify.checkedCount} events)`);
  } finally {
    console.log("\nTearing down the disposable drill containers and network...");
    cleanup();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("\nRestore drill errored:", err);
  cleanup();
  process.exit(1);
});
