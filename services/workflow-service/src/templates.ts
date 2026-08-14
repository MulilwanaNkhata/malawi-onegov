export interface TransitionRule {
  action: string;
  from: string;
  to: string;
  allowedRoles: string[]; // "SYSTEM" = internal/event-triggered, not a human role
}

export interface WorkflowTemplate {
  code: string;
  initialState: string;
  states: string[];
  transitions: TransitionRule[];
}

/**
 * Birth Certificate application journey. This is the concrete instance of
 * the platform's generic workflow engine used by the pilot. Additional
 * service types (e.g. trading licence, driving licence renewal) are added
 * by registering another template here -- the engine itself is unchanged.
 */
export const BIRTH_CERTIFICATE_TEMPLATE: WorkflowTemplate = {
  code: "birth_certificate",
  initialState: "SUBMITTED",
  states: [
    "SUBMITTED",
    "UNDER_REVIEW",
    "ADDITIONAL_INFO_REQUIRED",
    "APPROVED",
    "REJECTED",
    "ISSUED",
  ],
  transitions: [
    { action: "PAYMENT_CONFIRMED", from: "SUBMITTED", to: "UNDER_REVIEW", allowedRoles: ["SYSTEM"] },
    {
      action: "REQUEST_MORE_INFO",
      from: "UNDER_REVIEW",
      to: "ADDITIONAL_INFO_REQUIRED",
      allowedRoles: ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR"],
    },
    {
      action: "RESUBMIT",
      from: "ADDITIONAL_INFO_REQUIRED",
      to: "UNDER_REVIEW",
      allowedRoles: ["CITIZEN", "REGISTRAR_OFFICER"],
    },
    { action: "APPROVE", from: "UNDER_REVIEW", to: "APPROVED", allowedRoles: ["REGISTRAR_SUPERVISOR"] },
    { action: "REJECT", from: "UNDER_REVIEW", to: "REJECTED", allowedRoles: ["REGISTRAR_SUPERVISOR"] },
    {
      action: "REJECT",
      from: "ADDITIONAL_INFO_REQUIRED",
      to: "REJECTED",
      allowedRoles: ["REGISTRAR_SUPERVISOR"],
    },
    { action: "ISSUE", from: "APPROVED", to: "ISSUED", allowedRoles: ["SYSTEM", "REGISTRAR_OFFICER"] },
  ],
};

/**
 * Trading Licence application journey -- the second pilot service, added to
 * prove the platform's core claim: onboarding a new government service is a
 * new template registered here plus one new domain service, not a change to
 * this engine. The state shape happens to mirror the birth certificate
 * template (most approval workflows do), but it is a fully independent
 * template -- a service with a genuinely different approval chain (e.g. one
 * needing a site inspection step) would just define different states.
 *
 * Reuses the existing REGISTRAR_OFFICER/REGISTRAR_SUPERVISOR roles for review
 * to keep the pilot's RBAC surface small; a production rollout would likely
 * introduce agency-specific roles (e.g. COUNCIL_OFFICER) the same way.
 */
export const TRADING_LICENSE_TEMPLATE: WorkflowTemplate = {
  code: "trading_license",
  initialState: "SUBMITTED",
  states: [
    "SUBMITTED",
    "UNDER_REVIEW",
    "ADDITIONAL_INFO_REQUIRED",
    "APPROVED",
    "REJECTED",
    "ISSUED",
  ],
  transitions: [
    { action: "PAYMENT_CONFIRMED", from: "SUBMITTED", to: "UNDER_REVIEW", allowedRoles: ["SYSTEM"] },
    {
      action: "REQUEST_MORE_INFO",
      from: "UNDER_REVIEW",
      to: "ADDITIONAL_INFO_REQUIRED",
      allowedRoles: ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR"],
    },
    {
      action: "RESUBMIT",
      from: "ADDITIONAL_INFO_REQUIRED",
      to: "UNDER_REVIEW",
      allowedRoles: ["CITIZEN", "REGISTRAR_OFFICER"],
    },
    { action: "APPROVE", from: "UNDER_REVIEW", to: "APPROVED", allowedRoles: ["REGISTRAR_SUPERVISOR"] },
    { action: "REJECT", from: "UNDER_REVIEW", to: "REJECTED", allowedRoles: ["REGISTRAR_SUPERVISOR"] },
    {
      action: "REJECT",
      from: "ADDITIONAL_INFO_REQUIRED",
      to: "REJECTED",
      allowedRoles: ["REGISTRAR_SUPERVISOR"],
    },
    { action: "ISSUE", from: "APPROVED", to: "ISSUED", allowedRoles: ["SYSTEM", "REGISTRAR_OFFICER"] },
  ],
};

/**
 * Complaints/support -- the third pilot service, and a deliberately
 * different-shaped process from the two above: no payment step, no
 * approve/reject branch, and CITIZEN holds transitions of their own
 * (CLOSE, REOPEN) rather than only ever submitting and resubmitting. It
 * also has a genuine cycle (RESOLVED/CLOSED -> IN_PROGRESS via REOPEN),
 * which the apply-and-issue shape never needed. Proves the engine generalizes
 * to a real support-ticket lifecycle, not just structurally-identical clones.
 */
export const COMPLAINT_TEMPLATE: WorkflowTemplate = {
  code: "complaint",
  initialState: "OPEN",
  states: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  transitions: [
    { action: "ASSIGN", from: "OPEN", to: "IN_PROGRESS", allowedRoles: ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR"] },
    { action: "RESOLVE", from: "IN_PROGRESS", to: "RESOLVED", allowedRoles: ["REGISTRAR_OFFICER", "REGISTRAR_SUPERVISOR"] },
    { action: "CLOSE", from: "RESOLVED", to: "CLOSED", allowedRoles: ["CITIZEN", "REGISTRAR_SUPERVISOR"] },
    { action: "REOPEN", from: "RESOLVED", to: "IN_PROGRESS", allowedRoles: ["CITIZEN"] },
    { action: "REOPEN", from: "CLOSED", to: "IN_PROGRESS", allowedRoles: ["REGISTRAR_SUPERVISOR"] },
  ],
};

const TEMPLATES: Record<string, WorkflowTemplate> = {
  [BIRTH_CERTIFICATE_TEMPLATE.code]: BIRTH_CERTIFICATE_TEMPLATE,
  [TRADING_LICENSE_TEMPLATE.code]: TRADING_LICENSE_TEMPLATE,
  [COMPLAINT_TEMPLATE.code]: COMPLAINT_TEMPLATE,
};

export function getTemplate(code: string): WorkflowTemplate | undefined {
  return TEMPLATES[code];
}

export function findTransition(
  template: WorkflowTemplate,
  fromState: string,
  action: string
): TransitionRule | undefined {
  return template.transitions.find((t) => t.from === fromState && t.action === action);
}
