# Security

AutoDemo turns an untrusted, user-supplied website URL into a narrated demo
video by driving a real browser (Playwright) and several AI models. That means
the application deliberately fetches and renders content it does not control,
and accepts instructions from anonymous callers. This document describes the
threat model, the trust boundaries, the controls in place, and the known
limitations.

This document does **not** claim AutoDemo is "100% secure" or "exploit-proof".
Security is a continuous process; this describes the current posture and where
the sharp edges are.

---

## Trust boundaries

Everything crossing these boundaries is treated as **untrusted**:

1. **The user request.** Every value in an API request (URL, purpose, audience,
   action descriptions, language codes, job ids) is attacker-controlled.
2. **The explored website.** Any page AutoDemo opens — its HTML, text,
   redirects, network behavior, and any text that ends up in an AI prompt — is
   attacker-controlled. A page may try to reach internal networks, exhaust
   resources, or inject instructions into the AI.
3. **AI model output.** Model responses are untrusted structured data. They are
   always validated against Zod schemas and are **never** executed as code or
   shell commands.

Trusted: the AutoDemo server code, its configured limits, and (for now) the
single anonymous tenant. There is no authentication layer yet (see Limitations).

---

## Threats and controls

### Server-Side Request Forgery (SSRF)
The highest-severity risk, because the server opens user-chosen URLs.

- Single source of truth: `src/lib/security/url-validator.ts`.
- Only `http://` and `https://` are allowed. `file:`, `ftp:`, `javascript:`,
  `data:`, `blob:`, `chrome:`, `about:` and all other schemes are rejected.
- `localhost`, `*.local`, `*.internal`, and known metadata hostnames are
  rejected by name.
- The hostname is DNS-resolved and **every** resolved address is checked.
  Loopback, private (RFC 1918), link-local, unique-local (IPv6 fc00::/7),
  CGNAT (100.64/10), multicast, broadcast, unspecified, and cloud metadata
  addresses (169.254.169.254, 100.100.100.200, 192.0.0.192) are rejected for
  both IPv4 and IPv6.
- Redirects and in-page navigations are re-validated per hop; the final landed
  URL is re-validated after load.

### DNS rebinding (residual)
A hostname can resolve to a public IP at validation time and a private IP at
navigation time. We validate up front, re-validate the final URL, and guard
each navigation, but Playwright uses the OS resolver so the socket is not pinned
to the validated IP. **Deploy the browser in a network that has no route to
internal/private ranges** (egress-restricted subnet / separate VPC). See
"Browser Network Isolation" below — this residual risk is NOT closed by
application code and remains open until network-level egress isolation is
deployed and verified.

## Browser Network Isolation

The browser worker (the component that launches Chromium via Playwright to
explore, act on, and record untrusted websites) must run inside an isolated
network environment with enforced egress controls. This is a **deployment
infrastructure requirement**, not something the application code can satisfy on
its own.

### Why application-level URL validation cannot fully eliminate DNS rebinding

AutoDemo validates every user-supplied URL (scheme, hostname, and DNS-resolved
addresses) before launching the browser, re-validates the final URL after load,
and aborts per-request navigations to internal hosts. These are real and
valuable, but they are **defense in depth, not the final security boundary**:

- Chromium performs its own DNS resolution at navigation time. The address we
  validated and the address the browser actually connects to can differ (classic
  time-of-check/time-of-use). An attacker controlling a DNS response can return a
  public IP during validation and a private IP (for example `169.254.169.254` or
  `10.x.x.x`) microseconds later when the browser connects.
- Short-TTL DNS, multi-record round-robin, and redirect timing can all produce a
  resolved address the application never saw.
- We cannot pin the browser's socket to the validated IP with Playwright's
  default resolver.

Therefore the application MUST NOT be described as fully preventing DNS
rebinding. The reliable control is to run the browser where private and internal
addresses are simply **unreachable at the network layer**, so that even a
successful rebind connects to nothing.

### Why browser execution requires network isolation

The browser executes untrusted content (arbitrary third-party sites, their
JavaScript, their redirects). If that process can reach internal infrastructure,
a hostile page or a rebind can turn the browser into a pivot into your private
network, cloud metadata service, databases, or management endpoints. Isolating
the browser worker's egress removes that entire class of pivot regardless of
what the page or DNS does.

### Ranges and endpoints that MUST be unreachable from the browser worker

The network environment must block outbound connections from the browser worker
to all of the following:

- `127.0.0.0/8` (IPv4 loopback)
- `10.0.0.0/8` (RFC1918 private)
- `172.16.0.0/12` (RFC1918 private)
- `192.168.0.0/16` (RFC1918 private)
- `169.254.0.0/16` (IPv4 link-local), **including `169.254.169.254`**
- IPv6 loopback `::1`, link-local `fe80::/10`, and unique-local `fc00::/7`
- Cloud provider metadata endpoints (AWS/GCP/Azure/OpenStack `169.254.169.254`,
  Alibaba `100.100.100.200`, Oracle `192.0.0.192`, and the GCP
  `metadata.google.internal` hostname)
- Internal databases, internal APIs, private VPC services, and any
  infrastructure/management endpoints

Outbound access should be restricted to public HTTP/HTTPS (ports 80/443) only.

### Why cloud metadata endpoints must be blocked

Instance metadata services (reachable at link-local addresses such as
`169.254.169.254`) hand out temporary cloud credentials, instance identity, and
configuration to anything that can make an HTTP request from the host. If the
browser worker can reach them, a hostile page or a DNS rebind can exfiltrate
IAM/role credentials and escalate from "renders a video" to "controls your cloud
account". Blocking these endpoints at the network layer (and, on AWS, enforcing
IMDSv2 and/or disabling IMDS for the browser host) is mandatory. The application
blocklist is a backstop only.

### This is an infrastructure requirement

No application-level code in this repository enforces the above, and none can be
trusted to. The enforcement must be implemented in the cloud/network environment
(security groups, NACLs, egress firewall rules, a locked-down subnet/VPC, and/or
a forward proxy with an allow policy). The application provides optional hooks
(`BROWSER_PROXY_SERVER` / `BROWSER_PROXY_BYPASS`, see `.env.example` and
`src/lib/browser/network-config.ts`) so all browser traffic can be forced
through a controlled egress proxy, but the proxy/firewall — not the app — is the
boundary.

See `DEPLOYMENT.md` for the concrete, provider-agnostic configuration templates
and the deployment checklist.

### Prompt injection
Website text is fed to the AI, so a page may contain "ignore previous
instructions…".

- System prompts state explicitly that website content is untrusted data and
  must never be followed as instructions.
- Untrusted website content is passed inside a delimited, labeled block
  (`<<<WEBSITE_CONTENT>>> … <<<END_WEBSITE_CONTENT>>>`), kept separate from the
  trusted user context (purpose/audience) and system instructions.
- All model output is forced through Zod schemas and is never executed.

No prompt-level defense is absolute. The hard backstop is that model output can
only ever become validated data, never code, a shell command, or an arbitrary
URL to open.

### Resource exhaustion / Denial of Service
Defined in `src/lib/security/limits.ts`, all overridable via environment
variables (see `.env.example`):

- `MAX_URL_LENGTH` — caps submitted URL size.
- `MAX_ACTIONS_PER_DEMO` — caps browser actions per demo.
- `MAX_BROWSER_TIME_MS` — hard wall-clock cap per browser operation.
- `MAX_VIDEO_DURATION_S` — caps rendered video length.
- `MAX_FILE_SIZE_BYTES` — caps any single generated/served file.
- `MAX_CONCURRENT_JOBS` — global gate (`acquireJobSlot()`) on heavy
  browser/record/render jobs; excess requests get 429.
- `MAX_AI_CALLS_PER_JOB` — caps AI/vision/TTS spend attributable to a job.
- `MAX_REQUEST_BODY_BYTES` — caps accepted JSON body size.

Browsers and temp resources are always released in `finally` blocks.

### Rate limiting
`src/lib/security/rate-limit.ts` — in-memory fixed-window limiter behind a
`RateLimitStore` interface so it can be swapped for Redis in a multi-instance
deployment without touching call sites. Per-route buckets: explore (10/60s),
actions (20/60s), record (5/300s), voice (10/300s), render (5/600s), language
(6/600s), default (60/60s). Over-limit requests receive HTTP 429 with
`Retry-After`.

### Authorization
`src/lib/security/authz.ts` centralizes "resolve the current principal and
assert it may access this demo." Today it resolves an anonymous single-tenant
principal and asserts the demo exists. The ownership comparison is written so
that when real authentication is added, only this module changes — routes
already call `assertCanAccessDemo` through `guardDemoRoute`.

### Path traversal
`src/lib/security/paths.ts` — `safeSegment()` rejects `..`, path separators,
null bytes, drive letters, and anything outside a conservative allowlist.
`resolveWithin()` additionally asserts the resolved path stays inside the
`public/` artifact root. Applied to every request-derived path segment (job ids,
language codes, file base names), even though ids are server-generated —
defense in depth.

### Secure identifiers
`src/lib/security/ids.ts` — all ids use `crypto.randomUUID()` via `secureId()` /
`shortSecureId()`. Demo ids double as access identifiers, so they must not be
guessable; `Math.random()` is no longer used for any id.

### Browser isolation
Hardened Chromium launch args (`--disable-extensions`, `--disable-plugins`,
`--disable-background-networking`, `--disable-sync`, `--disable-default-apps`,
and more), service workers blocked in the context, a network guard that aborts
non-`http(s)` requests, and `page.evaluate` only of self-contained first-party
functions — never website-supplied code.

### HTTP security headers
Set in `next.config.mjs`: `Content-Security-Policy` (no `unsafe-eval` in
production — it is added in development only, where Next.js/Turbopack and React
dev tooling require `eval()`; React never uses `eval()` in production),
`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`,
and `Strict-Transport-Security`.

### CORS / CSRF
API routes are same-origin; no CORS headers are emitted, so browsers block
cross-site reads by default. There is no cookie-based session, so there is no
ambient credential for classic CSRF to abuse. **When cookie-based auth is added,
you must also add CSRF protection** (SameSite cookies plus a CSRF token or
origin check on state-changing routes) and an explicit CORS allowlist if the API
is exposed to other origins. Never use a wildcard CORS origin.

### Security logging
`src/lib/security/log.ts` emits structured, single-line security events
(`ssrf_blocked`, `navigation_blocked`, `rate_limited`, `authz_denied`,
`dangerous_action_flagged`, `job_failed`, `invalid_input`, `path_rejected`,
`limit_exceeded`). Secret-like keys are redacted; secret values and PII are
never logged.

### Injection / code execution
No `child_process`, `exec`, `eval`, or `new Function` is used anywhere (the only
matches are rejection patterns in `src/lib/browser/schemas.ts`). No
`dangerouslySetInnerHTML`. No SQL (the repository is in-memory). AI output never
reaches a shell, a filesystem path, or an eval.

---

## Secrets handling

- No secrets are committed to the repository.
- AWS access (Bedrock, Polly) uses the standard AWS credential chain
  (environment, shared config, instance/role) — no hard-coded keys.
- All `process.env` reads are server-side only; nothing secret is exposed to the
  client bundle.
- `.env.example` contains placeholders and documentation only.
- Treat secret-store integrations via runtime resolution rather than embedding
  secret values in config that enters application memory unnecessarily.

---

## Limitations (known residual risk)

- **DNS rebinding is NOT closed by application code.** Playwright's resolver and
  our URL validation are defense in depth only. The risk remains open until the
  browser worker runs in an isolated network with enforced egress controls (see
  "Browser Network Isolation" and `DEPLOYMENT.md`). Do not treat this as resolved
  until that isolation is deployed and verified.
- **Authentication/session/user stores are in-memory** (per process). They are
  lost on restart and not shared across instances; back them with a database/
  Redis before production.
- **Prompt injection** is mitigated, not eliminated; structured-output
  validation is the guarantee that injection cannot cause code execution.
- **Rate limiting and the concurrency gate are per-process** (in-memory).
  Multi-instance deployments need the Redis-backed store.

---

## Testing

Security unit tests live in `src/lib/security/__tests__/` and run with
`npm test`:

- `url-validator.test.ts` — SSRF: blocked schemes (`file:`, `javascript:`,
  `data:`, `ftp:`), internal hostnames (`localhost`, `*.local`, `*.internal`),
  private/loopback/metadata IPs (127.0.0.1, 10/8, 192.168/16, 172.16/12,
  169.254.169.254, CGNAT, IPv6 `::1`/`fe80`/`fd00`), oversized and malformed
  URLs, and the public-address allow path.
- `paths.test.ts` — path traversal (`..`, `../secret.txt`, `..\\secret.txt`,
  embedded separators, null bytes, drive letters), artifact-root containment,
  and public-URL mapping.

Run the full verification suite before release:

```
npm run typecheck
npm test
npm run build
npm audit
```

---

## Reporting a vulnerability

Report suspected vulnerabilities privately to the maintainers rather than
opening a public issue. Include reproduction steps and the affected endpoint or
file. Do not include live credentials or real user data in reports.
