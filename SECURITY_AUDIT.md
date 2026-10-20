# AutoDemo — Security Audit

Date: 2026 (hardening pass)
Scope: Full application. Trust model — every user-provided value and every
explored website is UNTRUSTED.

> This document lists findings and their remediation status. It does **not**
> claim the application is "secure" or "exploit-proof". It documents the
> security controls implemented and the remaining limitations (see end).

Severity key: **CRITICAL** / **HIGH** / **MEDIUM** / **LOW**.
Status: **Fixed** / **Partially fixed** / **Mitigated** / **Open (documented)**.

---

## Summary of findings

| # | Vulnerability | File(s) | Severity | Status |
|---|---|---|---|---|
| 1 | SSRF via user-submitted URL | browser-explorer.ts, url-validator.ts | CRITICAL | Fixed (hardened) |
| 2 | DNS rebinding window between validation and navigation | browser-explorer.ts | HIGH | Mitigated |
| 3 | Redirect to internal host (per-hop) not validated | browser-explorer.ts | HIGH | Fixed |
| 4 | No central URL validator; http:// disallowed by explorer | url-validator.ts | MEDIUM | Fixed |
| 5 | Insecure ID generation (Math.random) | repository.ts, action-planner.ts, planner, feature-discovery, actions route | MEDIUM | Fixed |
| 6 | No resource limits (URL length, actions, concurrency, AI calls) | multiple | HIGH | Fixed |
| 7 | No rate limiting on expensive endpoints | all /api routes | HIGH | Fixed |
| 8 | No authorization / ownership boundary | repository.ts, all routes | HIGH | Mitigated (boundary added; no auth yet) |
| 9 | Path traversal via id used in filesystem paths | recorder.ts, voice/render/i18n services | MEDIUM | Fixed |
| 10 | Internal error message leaked to client | record route (catch), others | MEDIUM | Fixed |
| 11 | No security headers (CSP, XCTO, Referrer-Policy, etc.) | next.config.mjs | MEDIUM | Fixed |
| 12 | Prompt injection from untrusted website content | ai/prompts.ts, verification.ts, planner | HIGH | Mitigated (hardened prompts + structured output) |
| 13 | Playwright isolation hardening | browser-explorer.ts, recorder.ts, playwright-executor.ts | MEDIUM | Fixed |
| 14 | No security-aware logging | — | LOW | Fixed |
| 15 | CORS / CSRF posture undocumented | — | LOW | Mitigated (documented) |
| 16 | Dangerous dev route exposure | dev/action-test | LOW | Already gated (confirmed) |
| 17 | Vulnerable dependencies (Next.js SSRF, source-map-js DoS) | package.json | HIGH | Fixed (non-breaking); Tailwind v3 build-chain open (documented) |

No instances of: `child_process`/`exec`/`eval`/`new Function` (only as rejection
patterns in schemas.ts), `dangerouslySetInnerHTML`, SQL (in-memory repository),
or secrets committed to the repo were found.

---

## Detailed findings

### 1. SSRF via user-submitted URL — CRITICAL — Fixed (hardened)
**Files:** `src/lib/browser/browser-explorer.ts`, `src/lib/browser/url-validator.ts`
**Explanation:** Users submit arbitrary URLs that Playwright opens server-side.
Without validation this allows reaching `localhost`, cloud metadata
(`169.254.169.254`), and private networks (classic SSRF).
**Existing control:** `validateExploreUrl` already enforced https-only, blocked
localhost/`*.local`/`*.internal`, resolved DNS, and rejected
loopback/private/link-local/ULA/CGNAT/multicast/metadata IPs (v4 + v6).
**Fix:** Centralized and extended into `src/lib/security/url-validator.ts`
(re-exported by the old path for compatibility): adds `http://` support per
spec, broadcast address block, explicit `::1`/`0.0.0.0` names, per-redirect
validation, and a resolved-IP pinning result for DNS-rebinding mitigation.
**Status:** Fixed.

### 2. DNS rebinding — HIGH — Mitigated
**File:** `src/lib/browser/browser-explorer.ts`
**Explanation:** A hostname can resolve to a public IP at validation time and a
private IP at navigation time (TOCTOU). Playwright uses the OS resolver for
navigation, so we cannot fully pin the socket to the validated IP without a
custom agent.
**Fix / mitigation:** We (a) validate before navigating, (b) re-validate the
**final** URL after load, and (c) validate **every redirect hop** via a request
listener that aborts navigations to newly-disallowed hosts. A residual race
remains (documented limitation). Production guidance: run the browser in an
egress-restricted network / separate VPC subnet with no access to internal
ranges — defense in depth beyond app code.
**Status:** Mitigated.

### 3. Redirect to internal host — HIGH — Fixed
**File:** `src/lib/browser/browser-explorer.ts`
**Explanation:** A public page could 3xx-redirect (or `<meta>`/JS redirect) to
an internal address. Only the final URL was re-checked.
**Fix:** Added a per-navigation framenavigated/request guard that validates each
main-frame navigation target's host against the SSRF blocklist and aborts if
disallowed, plus the existing final-URL re-validation.
**Status:** Fixed.

### 4. Central URL validator / http:// support — MEDIUM — Fixed
**Fix:** `src/lib/security/url-validator.ts` is the single source of truth;
allows `http://` and `https://`, rejects `file:`,`ftp:`,`javascript:`,`data:`,
`blob:`,`chrome:`,`about:`. The browser `url-validator.ts` re-exports it.
**Status:** Fixed.

### 5. Insecure ID generation — MEDIUM — Fixed
**Files:** `repository.ts`, `action-planner.ts`, `planner/demo-planner.ts`,
`ai/feature-discovery.ts`, `api/demo/[id]/actions/route.ts`.
**Explanation:** IDs were `Math.random().toString(36)` — predictable, not
cryptographically secure. Demo IDs double as access identifiers.
**Fix:** Central `secureId(prefix)` in `src/lib/security/ids.ts` using
`crypto.randomUUID()`. All generators switched.
**Status:** Fixed.

### 6. Resource exhaustion / DoS — HIGH — Fixed
**Explanation:** No caps on URL length, number of actions, concurrent browser
jobs, AI calls, or video duration. A malicious user could exhaust CPU/RAM/cost.
**Fix:** `src/lib/security/limits.ts` defines configurable limits
(`MAX_URL_LENGTH`, `MAX_PAGES_PER_EXPLORATION`, `MAX_CRAWL_DEPTH`,
`MAX_BROWSER_TIME_MS`, `MAX_ACTIONS_PER_DEMO`, `MAX_VIDEO_DURATION_S`,
`MAX_FILE_SIZE_BYTES`, `MAX_CONCURRENT_JOBS`, `MAX_AI_CALLS_PER_JOB`) with env
overrides. URL length enforced in validation; action count enforced in the
executor/recorder; concurrency enforced via a global job slot counter; browser
time enforced via existing per-op timeouts. Browser/temp cleanup already in
`finally` blocks (confirmed) — reinforced.
**Status:** Fixed.

### 7. Rate limiting — HIGH — Fixed
**Fix:** `src/lib/security/rate-limit.ts` — in-memory fixed-window limiter with
a swappable interface (Redis-ready). Applied to `/api/explore`,
`/api/demo/[id]/actions`, `/record`, `/voice`, `/render`, and the language
route. Expensive endpoints get stricter limits. Returns HTTP 429 with
`Retry-After`.
**Status:** Fixed.

### 8. Authorization / ownership — HIGH — Mitigated
**Explanation:** No authentication exists. Any client can act on any `demoId`.
**Fix:** A security boundary (`src/lib/security/authz.ts`) centralizes the
"resolve current principal + assert ownership" check. Today it resolves an
anonymous single-tenant principal and asserts the job exists; when auth is
added, only this module changes. Routes call `assertCanAccessDemo`.
**Status:** Mitigated (clean boundary; real auth is future work — not faked).

### 9. Path traversal — MEDIUM — Fixed
**Files:** `recorder.ts`, `tts/voice-generation.ts`, `video/render.ts`,
`i18n/multilingual-generation.ts`.
**Explanation:** `jobId` and language codes are interpolated into filesystem
paths. Although `jobId` must match a stored id, defense-in-depth requires
sanitizing any path segment.
**Fix:** `src/lib/security/paths.ts` provides `safeSegment()` (rejects
`..`, slashes, drive letters, non-allowlisted chars) and `artifactDir()` which
resolves and asserts the result stays within the app's `public/` artifact root.
Applied to all artifact path construction.
**Status:** Fixed.

### 10. Internal error leakage — MEDIUM — Fixed
**Files:** `api/demo/[id]/record/route.ts` (and other catch blocks that echoed
`err.message`).
**Fix:** `src/lib/security/errors.ts` `safeError()` returns a generic
client-safe message + stable code, logs the detail server-side. Routes no longer
return raw `message` from unexpected errors.
**Status:** Fixed.

### 11. Security headers — MEDIUM — Fixed
**File:** `next.config.mjs`
**Fix:** Added `headers()` with `Content-Security-Policy`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY` / `frame-ancestors 'none'`, `Permissions-Policy`,
and `Strict-Transport-Security`. CSP documented with required exceptions.
**Status:** Fixed.

### 12. Prompt injection — HIGH — Mitigated
**Files:** `ai/prompts.ts`, `planner/prompts.ts`, `browser/verification.ts`.
**Explanation:** Website content is fed to the AI. A page could contain
"ignore previous instructions…". The AI must treat page content as DATA.
**Fix:** System prompts explicitly state that website content is untrusted data
and must never be followed as instructions; website content is passed in a
delimited, labeled block separate from system/user instructions; all model
output is forced through Zod schemas and never executed. See SECURITY.md.
**Status:** Mitigated (prompt-level defenses + structured output; no LLM defense
is absolute — documented limitation).

### 13. Playwright isolation — MEDIUM — Fixed
**Fix:** Contexts already ran with no Node bindings exposed to the page, a
network guard aborting non-http(s) schemes, `page.evaluate` of a self-contained
function (never website-supplied code). Hardened launch args
(`--disable-extensions`, `--disable-plugins`, `--disable-background-networking`,
etc.), disabled service workers in context, and ensured browsers always close
in `finally`.
**Status:** Fixed.

### 14. Security logging — LOW — Fixed
**Fix:** `src/lib/security/log.ts` emits structured one-line security events
(blocked SSRF, blocked navigation, rate-limit, authz failure, dangerous action)
and never logs secrets/tokens/PII values.
**Status:** Fixed.

### 15. CORS / CSRF — LOW — Mitigated
**Explanation:** No CORS headers are set (same-origin only) and there is no
cookie-based auth yet, so CSRF is not currently exploitable. Documented so it is
handled when auth is added.
**Status:** Mitigated (documented in SECURITY.md).

### 16. Dev route exposure — LOW — Confirmed gated
**File:** `api/dev/action-test/route.ts` returns 403 when
`NODE_ENV === "production"`. Confirmed; left as-is.
**Status:** Already mitigated.

---

## Remaining risks / limitations

- **DNS rebinding** cannot be fully eliminated at the app layer with Playwright's
  default resolver. Deploy the browser with network egress controls.
- **No authentication** yet. The authorization boundary is a placeholder; until
  real auth lands, all demos are effectively single-tenant/public to anyone who
  can reach the server.
- **Prompt injection** defenses reduce but cannot guarantee immunity; structured
  output validation is the hard backstop (the model can never cause code/command
  execution).
- **Rate limiting is in-memory** (per-process). Multi-instance deployments need
  the Redis-backed implementation (interface is ready).

---

## Dependency audit (`npm audit`)

Run after the hardening pass. We applied only **non-breaking** fixes and did
**not** run `npm audit fix --force` (which would upgrade Tailwind CSS to a
breaking v4 major).

**Fixed (non-breaking):**

- `next` 16.3.6 → **16.3.8**. Resolves 6 Next.js advisories, most notably
  **Server-Side Request Forgery in Image Optimization** (GHSA-cjq9-62q9-8jv4),
  plus cache-poisoning (GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p), Draft Mode
  leakage (GHSA-3w37-wq28-93x7), and two information-disclosure issues
  (GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x).
- `source-map-js` 1.2.1 → **1.2.2** (via postcss). Resolves high-severity
  event-loop DoS (GHSA-68fv-2mgg-jv7q).

**Remaining (9: 2 moderate, 7 high) — all in the Tailwind CSS v3 build-time
chain:** `braces`, `micromatch`, `fast-glob`, `chokidar`,
`postcss-selector-parser`, `postcss-nested`, and `eslint-config-next`'s
`fast-glob`. Every one is only fixable via `npm audit fix --force`, which
installs the breaking `tailwindcss@4.3.3`.

**Why left open (documented manual-review item):** these are regex
stack-exhaustion / quadratic-parsing DoS bugs in **build-time tooling** that
processes the project's own trusted CSS and file globs during `next build`. They
are not reachable by an untrusted user of the deployed runtime. Upgrading to
Tailwind v4 is a breaking change (new config format, engine) and must be done as
a deliberate, tested migration — not an automated `--force`. Tracked as manual
follow-up. No runtime (prod dependency) vulnerabilities remain after the fixes
above.
