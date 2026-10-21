# Deployment & Network Isolation

This document describes the required deployment security model for AutoDemo,
with a focus on isolating the **browser worker** — the component that launches
Chromium (via Playwright) to open, act on, and record untrusted third-party
websites.

> No infrastructure-as-code exists in this repository yet. The templates below
> are starting points. **The actual enforcement must happen in your cloud /
> network environment** (security groups, NACLs, firewall egress rules, subnet/
> VPC design, and/or a forward proxy). Application code cannot enforce network
> isolation and must not be relied on to.

---

## Why the browser worker must be isolated

The browser executes untrusted content. Application-level SSRF/URL validation
(see `SECURITY.md` → SSRF and "Browser Network Isolation") is defense in depth,
but it **cannot fully eliminate DNS rebinding**: Chromium resolves hostnames at
navigation time and may connect to a different (private/internal) address than
the one the application validated. The reliable control is an environment where
private and internal addresses are simply **unreachable from the browser**.

---

## Required deployment security model

```
          ┌─────────────────────────────┐
          │        Main Application       │   (Next.js: API, auth, UI)
          │  - sessions, authz, CSRF      │
          └──────────────┬───────────────┘
                         │ job dispatch (internal, authenticated)
                         ▼
          ┌─────────────────────────────┐
          │        Browser Worker         │   (Playwright + Chromium)
          │  - runs untrusted websites    │
          └──────────────┬───────────────┘
                         │ egress ONLY
                         ▼
   ┌───────────────────────────────────────────────┐
   │ Isolated subnet / VPC                           │
   │  + outbound network firewall / security controls│
   │  + explicit egress policy (public 80/443 only)  │
   └───────────────────────────────────────────────┘
```

The browser worker must be able to reach the **public internet over HTTP/HTTPS
only**, and must be unable to reach any private/internal destination.

### Running the worker separately

The browser-launching code is isolated in `src/lib/browser/` (explorer,
executor, recorder) behind the repository/job model, so it can be deployed as a
separate service/process from the main Next.js app. Its network behavior is
externally configurable via environment variables (no code changes needed):

- `BROWSER_PROXY_SERVER` — force all browser egress through a controlled forward
  proxy (e.g. `http://egress-proxy.internal:3128`). The proxy then enforces the
  allow policy regardless of DNS.
- `BROWSER_PROXY_BYPASS` — optional proxy bypass list.

See `src/lib/browser/network-config.ts`. If no proxy is set, the subnet/VPC
firewall must enforce the egress policy directly.

---

## Destinations that MUST be unreachable from the browser worker

Block outbound connections from the browser worker to:

- `127.0.0.0/8` (loopback)
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918 private)
- `169.254.0.0/16` (link-local), **including `169.254.169.254`**
- IPv6 `::1` (loopback), `fe80::/10` (link-local), `fc00::/7` (unique-local)
- Cloud metadata endpoints: `169.254.169.254` (AWS/GCP/Azure/OpenStack),
  `100.100.100.200` (Alibaba), `192.0.0.192` (Oracle), and
  `metadata.google.internal`
- Internal databases, internal APIs, private VPC services, and any
  infrastructure/management endpoints

Allow outbound ONLY to public HTTP/HTTPS (ports 80/443).

---

## Deployment checklist

Security-critical items (do not expose the browser worker to the public internet
until BOTH of these are checked and verified):

- [ ] Browser worker runs in an isolated subnet/VPC with network-level egress restrictions.
- [ ] Browser worker cannot reach private RFC1918 ranges, link-local addresses, cloud metadata endpoints, internal databases, or internal services.

Supporting items:

- [ ] Browser worker runs as a separate service/process from the main app (not sharing a network namespace with internal services).
- [ ] Egress allowed to public 80/443 only; everything else denied by default.
- [ ] Cloud instance metadata hardened on the worker host (AWS: IMDSv2 required or IMDS disabled; equivalents on other clouds).
- [ ] `BROWSER_PROXY_SERVER` set if egressing through a controlled forward proxy; proxy enforces the allow policy.
- [ ] App served over HTTPS in production (required for `Secure` / `__Host-` session cookies).
- [ ] Production/multi-instance deployment uses Redis-backed rate limiting.
- [ ] Production/multi-instance deployment uses Redis-backed concurrency control.
- [ ] Redis connectivity and failure behavior have been tested.
- [ ] User/session stores backed by a shared database/Redis (the in-memory defaults are dev-only).
- [ ] Egress isolation verified from inside the worker (see "Verifying" below).

---

## Verifying the isolation (from inside the worker)

After deploying, confirm from a shell on the browser worker that private/metadata
targets are NOT reachable (each should hang/time out or be refused — never
succeed):

```
# Cloud metadata — MUST fail
curl -m 3 http://169.254.169.254/latest/meta-data/ ; echo "exit=$?"

# RFC1918 samples — MUST fail
curl -m 3 http://10.0.0.1/      ; echo "exit=$?"
curl -m 3 http://192.168.0.1/   ; echo "exit=$?"
curl -m 3 http://172.16.0.1/    ; echo "exit=$?"

# Loopback — MUST fail
curl -m 3 http://127.0.0.1/     ; echo "exit=$?"

# Public — SHOULD succeed
curl -m 5 https://example.com/  ; echo "exit=$?"
```

Treat any success against a private/metadata target as a blocking failure.

---

## Shared State / Redis

AutoDemo's **rate limiter** and **heavy-job concurrency gate** are shared
coordination state. By default they live in process memory, which is only
correct for a single process.

### Why in-memory rate limiting is unsafe across multiple instances

A fixed-window limiter keeps a per-key counter. If each of N instances keeps its
own counter, a client spread across them can make up to N times the intended
requests before any single instance trips its limit. The effective limit becomes
roughly `max * N` — the protection silently weakens exactly as you scale out.

### Why the concurrency gate must also be shared

The gate caps simultaneous heavy jobs (browser exploration, recording,
rendering) to protect CPU, memory, and cost. A per-process counter means each
instance allows `MAX_CONCURRENT_JOBS` independently, so N instances allow
`MAX_CONCURRENT_JOBS * N` heavy jobs at once — potentially overwhelming shared
resources (and your AI/API spend).

### Why Redis is the source of shared coordination

Redis executes operations atomically and is reachable by every instance, so it
is the single source of truth. AutoDemo uses atomic Lua scripts:

- **Rate limit**: `INCR` + `PEXPIRE` in one script — concurrent instances cannot
  race between read and write, and keys self-expire (stale windows disappear).
- **Concurrency gate**: a sorted set of leases keyed by a unique lease id, with
  an expiry score. Acquire prunes expired leases, checks capacity, and adds a
  lease atomically. Release removes only the caller's own lease id, so one
  worker can never free another's slot. Each lease has a TTL, so a crashed
  worker's slot is reclaimed automatically.

### Required environment variables

See `.env.example` for full notes. Summary:

- `REDIS_URL` — connection string (e.g. `rediss://:password@host:6379/0`). Its
  presence enables the Redis backend.
- `REDIS_TLS` — `true` to force TLS (or use a `rediss://` URL).
- `SHARED_STATE_BACKEND` — explicit `redis` | `memory` override.
- `JOB_SLOT_TTL_MS` — concurrency lease TTL (default 600000); must exceed your
  longest heavy job.

The `ioredis` package must be installed where Redis is used (it is an
`optionalDependency`): `npm install ioredis`.

### Redis failure behavior (fail-closed)

If Redis is configured but unavailable, AutoDemo does **not** fall back to "no
limit":

- **Rate limiter**: a store error makes the check return "not allowed" with a
  short retry-after. An outage cannot be used to bypass limits.
- **Concurrency gate**: acquire returns no slot (the route responds "server
  busy", HTTP 503) rather than granting unbounded concurrency. Release is
  best-effort; if Redis is down at release time, the lease TTL reclaims the slot.

A security event is logged in both cases.

### Startup behavior

A startup hook (`src/instrumentation.ts`) logs the active backend and, in
production, **refuses to start** with per-process limits unless you explicitly
set `SHARED_STATE_BACKEND=memory` (single-instance opt-in, which logs a loud
warning). This prevents accidentally deploying multi-instance with unsafe
limits.

### Running locally

Do nothing — with no `REDIS_URL`, the app uses the in-memory backend, which is
correct for a single dev process and for the test suite. To exercise the Redis
path locally, run a Redis (e.g. `docker run -p 6379:6379 redis`), install
`ioredis`, and set `REDIS_URL=redis://localhost:6379/0`.

### Configuring production

Provision a Redis (managed or self-hosted, TLS + auth), install `ioredis`, set
`REDIS_URL` (and `REDIS_TLS=true` if not using `rediss://`), and ensure every
instance points at the SAME Redis. Verify connectivity and the fail-closed
behavior (stop Redis and confirm requests are denied / jobs report busy, not
allowed through).

---

## Provider-agnostic configuration templates

These are starting points, NOT drop-in enforcement. Adapt to your provider and
have them reviewed. Enforcement lives in the network layer.

### AWS (security group / VPC sketch)

- Place the browser worker in a **dedicated private subnet**.
- Egress to the internet via a NAT gateway, with a security group / NACL that:
  - Allows outbound TCP 80 and 443 to `0.0.0.0/0`.
  - Denies outbound to RFC1918 and `169.254.0.0/16` (link-local/metadata).
  - Has no route to internal/peered VPC CIDRs (no routes, or explicit denies).
- Enforce **IMDSv2** (`HttpTokens: required`) or disable IMDS on the worker
  instance; metadata hop limit = 1.
- Do not attach the worker to internal security groups for databases/services.

Terraform sketch (illustrative — not complete, review before use):

```hcl
# Browser worker egress: public web only.
resource "aws_security_group" "browser_worker" {
  name        = "autodemo-browser-worker"
  description = "Untrusted browser egress: public HTTP/HTTPS only"
  vpc_id      = var.vpc_id

  egress {
    description = "HTTPS to public internet"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    description = "HTTP to public internet"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  # No egress rule permits RFC1918 / 169.254.0.0/16 — and the subnet route
  # table MUST NOT route to internal/peered CIDRs. Security groups are
  # allow-only; use NACLs to add explicit denies for private ranges as
  # defense in depth.
}

resource "aws_instance" "browser_worker" {
  # ...
  metadata_options {
    http_tokens   = "required" # IMDSv2
    http_endpoint = "enabled"  # or "disabled" if metadata is not needed
    http_put_response_hop_limit = 1
  }
}
```

NACL deny sketch (explicit egress denies as defense in depth):

```
# Deny outbound to private + link-local ranges (lower rule numbers = evaluated first)
deny  10.0.0.0/8
deny  172.16.0.0/12
deny  192.168.0.0/16
deny  169.254.0.0/16
deny  127.0.0.0/8
allow 0.0.0.0/0  tcp 80,443
```

### Kubernetes (NetworkPolicy sketch)

Run the browser worker in its own namespace and apply a default-deny egress
policy that permits only DNS and public web, while denying private CIDRs:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: browser-worker-egress
  namespace: autodemo-browser
spec:
  podSelector: { matchLabels: { app: browser-worker } }
  policyTypes: ["Egress"]
  egress:
    # DNS to the cluster resolver only.
    - to: []
      ports:
        - { protocol: UDP, port: 53 }
        - { protocol: TCP, port: 53 }
    # Public internet HTTP/HTTPS, EXCEPT private/link-local ranges.
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 169.254.0.0/16
              - 127.0.0.0/8
      ports:
        - { protocol: TCP, port: 80 }
        - { protocol: TCP, port: 443 }
```

> NetworkPolicy `ipBlock.except` covers IPv4; ensure IPv6 private/link-local
> ranges (`::1`, `fe80::/10`, `fc00::/7`) are blocked too, via a CNI that
> supports IPv6 policy or a host firewall. A CNI that enforces egress policy
> (Calico, Cilium) is required — the policy object alone does nothing without an
> enforcing CNI.

### Forward-proxy option (any platform)

Run a forward proxy (e.g. Squid) with an allow policy (public destinations,
ports 80/443, deny private/metadata), give the worker no other egress route, and
set `BROWSER_PROXY_SERVER` to the proxy. The proxy enforces the policy
regardless of DNS rebinding.

---

## Status of the DNS-rebinding risk

**Open until network-level egress isolation is deployed AND verified.** The
application-level controls reduce but do not eliminate it. Do not claim this risk
is closed based on application code.
