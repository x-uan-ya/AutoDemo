import { getSessionStore, type SessionRecord } from "./session-store";
import { getUserStore, type User } from "./user-store";
import { readSessionIdFromRequest } from "./cookies";

/**
 * Request-level authentication helpers.
 *
 * `authenticate(request)` is the single place that turns an incoming request
 * into an authenticated user (or null). It verifies the session id against the
 * server-side store, checks expiry, and confirms the referenced user still
 * exists. Everything else (authz, CSRF) builds on its result.
 */

export interface AuthContext {
  user: User;
  session: SessionRecord;
  sid: string;
}

/**
 * Resolve the authenticated user for a request, or null if unauthenticated,
 * the session is unknown/expired, or the user no longer exists.
 */
export async function authenticate(request: Request): Promise<AuthContext | null> {
  const sid = readSessionIdFromRequest(request);
  if (!sid) return null;

  const session = await getSessionStore().get(sid);
  if (!session) return null;

  const user = await getUserStore().findById(session.userId);
  if (!user) return null;

  return { user, session, sid };
}
