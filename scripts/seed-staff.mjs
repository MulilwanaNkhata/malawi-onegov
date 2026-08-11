#!/usr/bin/env node
// Seeds two demo staff accounts directly into identity_db. Registration
// through the public /auth/register endpoint always creates CITIZEN
// accounts by design (staff onboarding is an administrative act, not
// self-service) -- this script stands in for that admin process during
// local development.
//
// Usage (after `docker compose up`, from repo root):
//   cd scripts && npm install && npm run seed:staff
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const DATABASE_URL = process.env.IDENTITY_DATABASE_URL ?? "postgresql://onegov:onegov@localhost:5432/identity_db";
const DEMO_PASSWORD = "Passw0rd!";
// Classic RFC 6238 example secret, reused for both demo accounts so you can
// generate a login code with: node generate-totp.mjs JBSWY3DPEHPK3PXP
const DEMO_MFA_SECRET = "JBSWY3DPEHPK3PXP";

const STAFF_ACCOUNTS = [
  { fullName: "Grace Banda (Registrar Officer)", phone: "+265991000001", role: "REGISTRAR_OFFICER" },
  { fullName: "Chikondi Phiri (Registrar Supervisor)", phone: "+265991000002", role: "REGISTRAR_SUPERVISOR" },
  { fullName: "System Administrator", phone: "+265991000000", role: "SYSTEM_ADMIN" },
];

async function main() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  for (const account of STAFF_ACCOUNTS) {
    await client.query(
      `INSERT INTO "User" (id, "fullName", phone, "passwordHash", role, "mfaSecret", "mfaEnabled", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, true, true, now(), now())
       ON CONFLICT (phone) DO UPDATE SET "passwordHash" = EXCLUDED."passwordHash", role = EXCLUDED.role`,
      [randomUUID(), account.fullName, account.phone, passwordHash, account.role, DEMO_MFA_SECRET]
    );
    console.log(`Seeded ${account.role}: ${account.phone}`);
  }

  await client.end();

  console.log("\nDemo staff accounts ready. Password for all:", DEMO_PASSWORD);
  console.log("MFA secret for all:", DEMO_MFA_SECRET);
  console.log("Get a login code with: node generate-totp.mjs", DEMO_MFA_SECRET);
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
