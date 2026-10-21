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
- [ ] User/session/rate-limit stores backed by a shared database/Redis (the in-memory defaults are dev-only).
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
