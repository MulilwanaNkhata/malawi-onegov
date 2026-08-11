/**
 * Canonical platform contracts (reference copy).
 *
 * Each microservice is independently deployable and does NOT import this
 * package at runtime (no shared-library coupling between services). Instead,
 * each service keeps its own small `src/shared.ts` with only the slice of
 * these contracts it needs. This file is the single source of truth that
 * those per-service copies are kept in sync with -- if you change a role
 * name or event name, update it here first, then propagate.
 */

// ---------------------------------------------------------------------------
// RBAC roles used across the platform
// ---------------------------------------------------------------------------
export const ROLES = {
  CITIZEN: "CITIZEN",
  REGISTRAR_OFFICER: "REGISTRAR_OFFICER", // front-line civil registration staff
  REGISTRAR_SUPERVISOR: "REGISTRAR_SUPERVISOR", // approves/rejects applications
  SYSTEM_ADMIN: "SYSTEM_ADMIN", // platform administration
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// ---------------------------------------------------------------------------
// Domain event names published on the Redis event bus (channel: onegov.events)
// Consumers: notification-service (all), workflow-service (payment.completed)
// ---------------------------------------------------------------------------
export const EVENTS = {
  APPLICATION_SUBMITTED: "application.submitted",
  PAYMENT_COMPLETED: "payment.completed",
  APPLICATION_STATUS_CHANGED: "application.status_changed",
  CERTIFICATE_ISSUED: "certificate.issued",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

export interface DomainEvent<T = Record<string, unknown>> {
  name: EventName;
  occurredAt: string;
  correlationId: string;
  data: T;
}

// ---------------------------------------------------------------------------
// Birth Certificate workflow template (owned by workflow-service, referenced
// here for documentation)
// ---------------------------------------------------------------------------
export const BIRTH_CERTIFICATE_WORKFLOW_CODE = "birth_certificate";

export const BIRTH_CERTIFICATE_STATES = [
  "SUBMITTED",
  "AWAITING_PAYMENT",
  "UNDER_REVIEW",
  "ADDITIONAL_INFO_REQUIRED",
  "APPROVED",
  "REJECTED",
  "ISSUED",
] as const;

// ---------------------------------------------------------------------------
// JWT claims shape issued by identity-service
// ---------------------------------------------------------------------------
export interface AccessTokenClaims {
  sub: string; // user id
  role: Role;
  fullName: string;
  mfa: true; // access tokens are only issued after MFA is satisfied
}
