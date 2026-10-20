import { logSecurityEvent } from "./log";

/**
 * Authorization / ownership security boundary.
 *
 * Authentication is NOT implemented yet. This module exists so that:
 *   - every demo/job access goes through ONE place that will enforce ownership,
 *   - adding real auth later means changing only this file, and
 *   - we never sprinkle ad-hoc, client-trusting checks across routes.
 *
 * Today it resolves a single anonymous principal and treats all demos as owned
 * by that principal (single-tenant). It is NOT a fake login system — it is a
 * seam. When auth lands, `resolvePrincipal` reads the session and
 * `assertCanAccessDemo` compares `job.ownerId` to the principal.
 */

export interface Principal {
  /** Stable id for the acting principal. "anonymous" until auth exists. */
  id: string;
  authenticated: boolean;
}

/** Resolve the current principal from the request. */
export function resolvePrincipal(_request: Request): Principal {
  // TODO (auth milestone): read a verified session/JWT here.
  return { id: "anonymous", authenticated: false };
}

export class AuthorizationError extends Error {
  constructor(message = "You are not allowed to access this resource.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** A minimal shape of an ownable resource. */
export interface OwnableDemo {
  id: string;
  /** Owner id; optional until auth exists. */
  ownerId?: string;
}

/**
 * Assert the principal may access the given demo. Throws AuthorizationError on
 * denial (routes map it to 403/404). Logs denials.
 *
 * Current policy (no auth): allow when the demo exists. The ownership
 * comparison is already written so it activates automatically once demos carry
 * an ownerId and principals are authenticated.
 */
export function assertCanAccessDemo(
  principal: Principal,
  demo: OwnableDemo | null | undefined,
  route: string
): asserts demo {
  if (!demo) {
    // Do not distinguish "not found" vs "not yours" to the client (avoids
    // enumeration); callers return 404.
    throw new AuthorizationError("Demo not found.");
  }
  if (demo.ownerId && principal.authenticated && demo.ownerId !== principal.id) {
    logSecurityEvent("authz_denied", {
      route,
      demoId: demo.id,
      principal: principal.id,
    });
    throw new AuthorizationError();
  }
}
