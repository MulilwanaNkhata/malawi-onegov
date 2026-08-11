// Slice of libs/shared/src/contracts.ts relevant to this service.
// Kept local so this service has zero build-time dependency on other
// packages in the monorepo and can be deployed independently.

export const ROLES = {
  CITIZEN: "CITIZEN",
  REGISTRAR_OFFICER: "REGISTRAR_OFFICER",
  REGISTRAR_SUPERVISOR: "REGISTRAR_SUPERVISOR",
  SYSTEM_ADMIN: "SYSTEM_ADMIN",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
