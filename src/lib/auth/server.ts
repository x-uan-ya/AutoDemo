import { getSessionStore } from "./session-store";
import { getUserStore, type User } from "./user-store";
import { readSessionId } from "./cookies";

/**
 * Server-component / page authentication helper.
 *
 * API routes use `authenticate(request)` (reads the Request's Cookie header).
 * React Server Components and route handlers that use Next's dynamic `cookies()`
 * store use this variant, which reads the session id the same way but via the
 * framework cookie store.
 */

export async function getCurrentUser(): Promise<User | null> {
  const sid = await readSessionId();
  if (!sid) return null;

  const session = await getSessionStore().get(sid);
  if (!session) return null;

  const user = await getUserStore().findById(session.userId);
  return user ?? null;
}
