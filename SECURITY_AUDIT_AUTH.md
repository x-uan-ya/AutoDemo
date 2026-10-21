# AutoDemo — Authentication & Authorization Security Audit

Scope: closing the authentication/authorization gap. Before this work, any
anonymous caller who knew (or guessed) a `demoId` could read and mutate that
demo. This document records what changed, how the layers fit together, which
endpoints are now protected, what is tested, and what still stands between the
app and a safe public deployment.

> This does NOT claim the application is "secure" because authentication now
> exists. The security boundary is the full stack below — authentication +
> authorization + CSRF + CORS allowlist + secure sessions + rate limiting —
> plus the residual-risk list at the end.

---

## The problem that was fixed

- `resolvePrincipal` always returned an anonymous principal, and
  `assertCanAccessDemo` allowed access whenever the demo merely existed.
- Four state-changing demo routes bypassed the guard entirely: `features`
  (PATCH), `plan/approve` (POST), `actions/approve` (POST), and
  `plan/scene/[sceneId]/regenerate` (POST).
- Server components (`/dashboard`, `/demo/[id]`) read demos directly with no
  auth check and the dashboard listed every demo in the store.

Possession of a `demoId` was effectively authorization. That is now closed:
**authentication + ownership are required, and knowing a `demoId` grants
nothing.**

---

## Files changed

### New — authentication layer (`src/lib/auth/`)
- `password.ts` — scrypt hashing (`node:crypto`, no new deps). Per-password
  random salt; self-describing `scrypt$N$r$p$salt$hash`; constant-time verify;
  strength validation (8–200 chars). Never stores or logs plaintext.
- `user-store.ts` — `UserStore` interface + in-memory implementation.
  Normalizes emails, rejects duplicates, and resists user enumeration by
  spending comparable time (decoy hash) when an email is unknown.
- `session-store.ts` — server-side `SessionStore` (create/get/destroy/rotate),
  absolute expiry (`SESSION_TTL_MS`, default 12h), opaque 256-bit ids.
- `cookies.ts` — cookie helpers. `HttpOnly` session cookie, `Secure` + `__Host-`
  prefix in production, `SameSite=Lax`, `Path=/`; readable CSRF companion
  cookie. Secure is disabled in dev so localhost over http works.
- `session.ts` — `authenticate(request)`: Cookie header → verified session →
  user, or null.
- `server.ts` — `getCurrentUser()` for React Server Components / pages (via
  Next's `cookies()`).
- `csrf.ts` — `verifyCsrf(request, session)` double-submit check; safe methods
  (GET/HEAD/OPTIONS) always pass; constant-time token comparison.
- `client.ts` — `apiFetch()` browser helper: sends cookies and auto-attaches
  the `x-csrf-token` header on unsafe methods.

### New — API routes (`src/app/api/auth/`)
- `register` — create account + open session (rate limited).
- `login` — verify credentials, **rotate the session id** (fixation defense),
  generic failure message (rate limited).
- `logout` — CSRF-checked; destroys the server session and clears cookies.
- `session` (GET) — returns current user + CSRF token for the frontend.

### New — UI
- `src/components/auth-form.tsx`, `src/app/(app)/login/page.tsx`,
  `src/app/(app)/register/page.tsx` — email/password forms with an
  open-redirect-safe `next` parameter.

### New — network boundary
- `src/proxy.ts` (Next.js 16 `proxy` convention, replaces the deprecated
  `middleware`) — CORS allowlist for `/api/*`.

### Changed — enforcement seam
- `src/lib/security/authz.ts` — `resolvePrincipal` now authenticates;
  `AuthenticationError` added; `SEED_OWNER_ID`; `assertCanAccessDemo` requires
  an authenticated principal and matches `ownerId` (seed demos shared).
- `src/lib/security/route-guard.ts` — `guardDemoRoute` order: rate limit → 401
  if unauthenticated → 403 if CSRF fails → 404 if missing/not-owned
  (non-enumerating).
- `src/lib/security/rate-limit.ts` — added `login` and `register` buckets.
- `src/lib/security/log.ts` — added auth/CORS event types.
- `src/lib/repository.ts` — `list(ownerId)`, `create(ownerId, …)`, seed demos
  tagged with `SEED_OWNER_ID`.
- `src/types/index.ts` — `DemoJob.ownerId?: string`.
- Pages: `/dashboard`, `/demo/[id]`, `/create` now require a user and redirect
  to `/login?next=…`.
- The four bypassing routes + `/api/explore` are now guarded.
- Client panels switched from `fetch` to `apiFetch` (CSRF + credentials).

---

## Authentication flow

1. User submits email + password to `/api/auth/register` or `/api/auth/login`.
2. Register hashes the password (scrypt) and stores the user; login verifies
   with a constant-time comparison and a decoy hash for unknown emails.
3. On success a server-side session is created (login **rotates** any existing
   session id to prevent fixation). The opaque session id is set in an
   `HttpOnly` cookie; the CSRF token is set in a readable companion cookie.
4. Subsequent requests carry the cookie automatically. `authenticate(request)`
   resolves it to a user; expired or unknown sessions resolve to null.
5. `/api/auth/logout` destroys the server session (true invalidation) and
   clears cookies.

## Authorization flow

For every demo request the conceptual chain is exactly:

```
authenticate(request) -> userId
  -> assertCanAccessDemo(userId, demo)
     -> continue only if authenticated AND (owner OR shared seed demo)
```

Results: unauthenticated → **401**; authenticated but not the owner → **404**
(indistinguishable from not-found, so other users' demos cannot be enumerated).
Server components apply the same check and `redirect`/`notFound` accordingly.

## CSRF strategy

Double-submit bound to the server session. The session holds the authoritative
CSRF token; the client reads its copy from the readable cookie and echoes it in
`x-csrf-token` on every POST/PUT/PATCH/DELETE. The guard compares them in
constant time. `SameSite=Lax` is the first line of defense; the token is defense
in depth. `apiFetch` wires this automatically. Safe methods are exempt.

## CORS configuration

`src/proxy.ts` guards `/api/*`. The API is credentialed, so wildcard origins are
forbidden. Allowed origins come from `CORS_ALLOWED_ORIGINS` (comma-separated)
plus `NEXT_PUBLIC_APP_URL`. Allowed origins are reflected with
`Access-Control-Allow-Credentials: true`; disallowed preflights get 403 and
disallowed actual requests receive no CORS headers (browser blocks the read).
Same-origin requests (no Origin header) pass through untouched.

## Session strategy

Opaque 256-bit server-side session ids (not JWTs). `HttpOnly` (no JS access, so
XSS cannot steal them; nothing in `localStorage`), `Secure` + `__Host-` in
production, `SameSite=Lax`, absolute expiry. Rotated on login, destroyed on
logout.

## Rate limiting

`login`: 10 / 5 min. `register`: 5 / hour. Tuned to blunt brute force and
credential stuffing without blocking a legitimate user who mistypes.

---

## Endpoints now protected

| Endpoint | Methods | Enforcement |
|---|---|---|
| `/api/demo/[id]/discover` | POST | guard (auth+CSRF+owner) |
| `/api/demo/[id]/features` | PATCH | guard — **was unprotected** |
| `/api/demo/[id]/plan` | POST, PUT | guard |
| `/api/demo/[id]/plan/approve` | POST | guard — **was unprotected** |
| `/api/demo/[id]/plan/scene/[sceneId]/regenerate` | POST | guard — **was unprotected** |
| `/api/demo/[id]/actions` | POST, PUT | guard |
| `/api/demo/[id]/actions/approve` | POST | guard — **was unprotected** |
| `/api/demo/[id]/record` | POST | guard |
| `/api/demo/[id]/voice` | POST, PATCH | guard |
| `/api/demo/[id]/render` | POST | guard |
| `/api/demo/[id]/language/[code]` | POST | guard |
| `/api/demo/[id]/quality-check` | POST, PATCH | guard |
| `/api/explore` | POST | auth + CSRF (no demo; expensive/SSRF-sensitive) |
| `/api/auth/login`,`/register` | POST | public by design, rate limited |
| `/api/auth/logout` | POST | auth + CSRF |
| `/api/auth/session` | GET | safe (read-only) |
| `/api/dev/action-test` | GET | 403 in production (pre-existing) |
| Pages `/dashboard`, `/create`, `/demo/[id]` | — | require user, redirect to `/login` |

Repository re-audit confirmed: **all 12 demo route files import and call
`guardDemoRoute`; no `demoId` endpoint bypasses the auth/authz layer.**

---

## Security tests added (all pass; 75 total in the suite)

- **A** anonymous access → 401
- **B** owner access → allowed
- **C** user A accessing user B's demo → 404 (non-enumerating)
- **D** anonymous mutation → 401
- **E** non-owner mutation → 404
- **F** logout invalidates the session
- **G** unknown and expired sessions rejected
- **H** mutation without a valid CSRF token → 403 (plus wrong-token rejected)
- **I** disallowed CORS origin gets no ACAO header / 403 preflight; allowlisted
  origin reflected with credentials
- **J** login rate limiting trips after the configured attempts

Plus unit tests: password hashing (no plaintext, random salt, constant-time
verify, malformed-hash rejection), session rotation (fixation), user-enumeration
resistance, and seed-demo sharing.

Verification run: `npm run typecheck` clean, `npm test` 75/75 pass,
`npm run build` clean.

---

## Environment variables required / relevant

- `SESSION_TTL_MS` (optional) — session lifetime, default 12h.
- `CORS_ALLOWED_ORIGINS` (optional) — comma-separated extra browser origins
  allowed to call the credentialed API. `NEXT_PUBLIC_APP_URL` is always trusted.
- Cookie `Secure`/`__Host-` flags switch on automatically when
  `NODE_ENV=production` — no manual setting.

No session secret env var is needed: sessions are opaque server-side ids, not
signed tokens. **Secret scan:** no real `.env` is committed (only
`.env.example`), no hardcoded secrets in `src/`, and `.gitignore` covers `.env`
and `.env*.local`. **Nothing needs rotation.**

---

## What still prevents production deployment

1. **In-memory stores.** Users AND sessions live in process memory. They are
   lost on restart and NOT shared across instances — a multi-instance or
   serverless deployment will behave incorrectly (users "logged out" randomly,
   sessions missing). Back the `UserStore` and `SessionStore` with a shared
   database/Redis before production. The interfaces are ready; only the
   implementations change.
2. **No account-recovery / email verification.** There is no password reset,
   email confirmation, or account lockout beyond rate limiting. Add these before
   real users depend on the system.
3. **Rate limiting is per-process** (same in-memory caveat). Use the Redis-backed
   store for correct limits across instances.
4. **HTTPS is assumed in production.** `Secure`/`__Host-` cookies require it; the
   app must be served over TLS or logins will not persist.
5. **scrypt cost is interactive-grade** (N=16384). Re-evaluate parameters for
   your hardware/threat model.
6. Pre-existing residual risks from the earlier hardening pass still apply (see
   `SECURITY.md` / `SECURITY_AUDIT.md`): DNS-rebinding needs network egress
   controls; prompt-injection is mitigated not eliminated.

Authentication + authorization + CSRF + CORS allowlist + secure session
management + rate limiting are now in place and enforced server-side. The items
above are the remaining gates before a safe public deployment — do not treat the
presence of login as sufficient on its own.
