import { logSecurityEvent } from "./log";
import { authenticate } from "@/lib/auth/session";

/**
 * Authorization / ownership security boundary.
 *
 * This module is the ONE place that:
 *   - turns a request into an authenticated principal (via the session layer),
 *   - enforces demo ownership,
 * so routes never sprinkle ad-hoc, client-trusting checks.
 *
 * Authentication is now implemented: `resolvePrincipal` verifies the session
 * cookie against the server-side session store. `assertCanAccessDemo` requires
 * an authenticated principal and compares `job.ownerId` to it.
 *
 * Seed/sample demos carry the reserved owner id SEED_OWNER_ID and are readable
 * by any authenticated user (they are shared sample data, not private).
 */

/** Reserved owner id for seeded sample demos (shared, non-private). */
export const SEED_OWNER_ID = "seed";

export interface Principal {
  /** Stable id for the acting principal. "anonymous" when unauthenticated. */
  id: string;
  authenticated: boolean;
}

export const ANONYMOUS: Principal = { id: "anonymous", authenticated: false };

/**
 * Resolve the current principal from the request by verifying the session.
 * Returns an unauthenticated principal when there is no valid session.
 */
export async function resolvePrincipal(request: Request): Promise<Principal> {
  const auth = await authenticate(request);
  if (!auth) return ANONYMOUS;
  return { id: auth.user.id, authenticated: true };
}

/** Error thrown when a request has no authenticated principal. */
export class AuthenticationError extends Error {
  constructor(message = "Authentication is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
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
 * Assert the principal is authenticated AND may access the given demo.
 *
 * Order of checks (deliberate):
 *   1. No authenticated principal  -> AuthenticationError (route -> 401).
 *   2. Demo missing                -> AuthorizationError  (route -> 404).
 *   3. Owned by someone else       -> AuthorizationError  (route -> 404,
 *      non-enumerating: we never reveal that a demo exists but is not yours).
 *
 * Seed demos (ownerId === SEED_OWNER_ID) are shared sample data and are
 * accessible to any authenticated user. A demo with no ownerId is treated as
 * private-but-unclaimed and only accessible to... no one but seed logic; in
 * practice every created demo is assigned an owner, so a missing ownerId is a
 * defensive "deny" for authenticated non-owners.
 *
 * Knowledge of a demoId is NEVER sufficient — authentication + ownership is.
 */
export function assertCanAccessDemo(
  principal: Principal,
  demo: OwnableDemo | null | undefined,
  route: string
): asserts demo {
  if (!principal.authenticated) {
    logSecurityEvent("authz_denied", { route, reason: "unauthenticated" });
    throw new AuthenticationError();
  }
  if (!demo) {
    // Do not distinguish "not found" vs "not yours" to the client.
    throw new AuthorizationError("Demo not found.");
  }

  // Shared sample data is readable by any authenticated user.
  if (demo.ownerId === SEED_OWNER_ID) return;

  if (demo.ownerId !== principal.id) {
    logSecurityEvent("authz_denied", {
      route,
      demoId: demo.id,
      principal: principal.id,
      reason: "not_owner",
    });
    throw new AuthorizationError();
  }
}
