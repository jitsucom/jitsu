# Anonymous authentication limits (JITSU-16)

The guard runs before validation and authentication, so failed and malformed
attempts count. Counters use the existing PostgreSQL rate limiter and are shared
across console replicas. No migration is required. IP addresses are hashed in
counter keys. The gateway must overwrite `X-Real-IP`; direct deployments must
set `AUTH_TRUST_X_REAL_IP=false` (the stock Docker Compose file does), which charges
the address of the connection instead. Set it to `true` only when every request reaches the
console through a proxy that sets `X-Real-IP`, and the console port cannot be reached any
other way: the Compose file publishes it on every interface, so bind it to `127.0.0.1`
first. Client-supplied X-Forwarded-For is ignored.

| Bucket | Default per IP/minute | Routes |
| --- | --- | --- |
| lookup | 60 | `auth/check-email`, `auth/signup-email-check`, `fb-auth/sign-in-methods` |
| login | 60 | NextAuth `signin/*` and `callback/*` (GET and POST), dynamic OIDC `authorize` and `callback`, `fb-auth/create-user` |
| session | 300 | `fb-auth/create-session`, `fb-auth/audit-login` |

The limits use the existing weighted sliding-window algorithm. All methods and
providers share their bucket; query parameters cannot allocate new buckets.
NextAuth session polling, CSRF/provider discovery, logout, and authenticated OIDC
session renewal keep their existing behavior. Firebase's client-side password
login goes directly to Firebase and remains subject to Firebase's own controls.

Configure `AUTH_ATTEMPT_RATE_LIMIT` (lookup/login) and `AUTH_SESSION_RATE_LIMIT`
as positive integers. The existing `MINUTE_RATE_LIMIT_ENABLED=false` switch also
disables these guards. Corporate NATs share an IP budget: monitor 429s and tune
the limits if necessary. No production burst test is required.

When the counter store fails, database-dependent auth routes return 503 with
`Retry-After: 5`. Endpoints already designed to work without the console database
(signup policy checks, Firebase provider lookup/session minting/login auditing)
use a bounded, in-memory fallback during maintenance or a store outage. It uses
the same window math, logs degraded operation, and fails closed at 10,000 active
keys instead of evicting live counters. This fallback is per process: its effective
budget grows with replica count, resets on restart, and is separate from the
normal PostgreSQL budget. It preserves operator login during database maintenance.

Throttling returns 429 with `Retry-After` and the standard rate-limit headers.
Responses are marked `Cache-Control: no-store`. Roll out the console independently
of ingest; verify normal Firebase and OAuth login, session refresh and logout on
the beta deployment before promoting it.

NextAuth client requests retain 429/503 and include its required absolute `url`
pointing to the sign-in page with an error code. Direct NextAuth browser callbacks
and form submissions use a 303 redirect to that page instead. Both paths display
the throttling or temporary-unavailability message; redirect targets use the
configured console origin, never the request's Host or callback URL.
