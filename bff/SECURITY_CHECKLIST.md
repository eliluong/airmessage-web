# BFF Security + Deployment Checklist

Use this checklist before enabling BFF mode beyond local development.

## 1) Session and transport boundary
- [ ] `BFF_SESSION_SECRET` is a strong random value (not committed).
- [ ] `BFF_COOKIE_SECURE=true` in deployments using HTTPS.
- [ ] `BFF_TRUST_PROXY=true` when running behind TLS-terminating reverse proxy.
- [ ] Browser and BFF are same-origin when possible (preferred).

## 2) Session persistence
- [ ] `BFF_SESSION_STORE_MODE=redis` in persistent environments.
- [ ] `BFF_REDIS_URL` points to a reachable Redis instance.
- [ ] `BFF_SESSION_TTL_SECONDS` is set to your desired idle-expiry policy.
- [ ] Redis key prefix is namespaced per environment (`BFF_REDIS_KEY_PREFIX`).

## 3) Upstream host policy
- [ ] `BFF_UPSTREAM_ALLOWLIST_ENFORCED=true` in production.
- [ ] `BFF_UPSTREAM_ALLOWED_HOSTS` and/or `BFF_UPSTREAM_ALLOWED_CIDRS` include only intended BlueBubbles targets.
- [ ] Disallowed hosts are rejected with `BFF_UPSTREAM_HOST_NOT_ALLOWED`.

## 4) Request protections
- [ ] `BFF_RATE_LIMIT_ENABLED=true`.
- [ ] Login limits (`BFF_RATE_LIMIT_AUTH_*`) match your abuse tolerance.
- [ ] Proxy limits (`BFF_RATE_LIMIT_PROXY_*`) match normal traffic ceilings.
- [ ] CSRF is enforced on all mutating `/bff` routes.

## 5) Metrics and observability
- [ ] `/bff/metrics` is restricted (set `BFF_METRICS_BEARER_TOKEN` or internal network ACLs).
- [ ] Dashboards/alerts cover:
  - auth failures (`bff_auth_failures_total`)
  - upstream request latency (`bff_upstream_latency_seconds`)
  - upstream error classes (`bff_upstream_errors_total`)
  - realtime reconnect churn (`bff_realtime_reconnect_total`)

## 6) Redaction verification
- [ ] Run `npm test -- --runInBand test/bff/observability/logger.test.ts`.
- [ ] Confirm logs do not expose `password`, `guid`, `Authorization`, or cookies.
- [ ] Confirm query auth params are redacted if logged.

## 7) Reverse proxy / TLS guidance
- [ ] TLS is terminated at reverse proxy (nginx/caddy/traefik).
- [ ] Only the reverse proxy is exposed publicly.
- [ ] BFF listens on internal interface/port.
- [ ] BlueBubbles upstream is reachable only from trusted network segments when possible.
