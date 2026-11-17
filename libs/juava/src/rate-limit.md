# Shared sliding-window limiter

`rate-limit.ts` is the dependency-free source used by console and vendored at a
pinned commit by `jitsucom/jitsu-cloud-billing`. Change policy here, not in the
billing copy; update billing with `pnpm rate-limit:sync <full-jitsu-commit-sha>`.

The module owns window boundaries, weighted current/previous counts,
Retry-After, expiry and opportunistic cleanup. Storage adapters must atomically
increment the current counter (including denied attempts), return the previous
count, and honor the supplied expiry. A failed increment must throw.

Keep counters through **two complete windows plus five minutes of grace**:
the current window's counter remains an input throughout the next window.
The old one-window-plus-five-minutes expiry was insufficient for hourly limits.
Use different bucket keys for different window durations and synchronize
application clocks across replicas.

This is an approximate weighted sliding window, not an exact timestamp log.
Denied requests count and may extend the wait under continued retries.
Console keeps its existing key format and PostgreSQL table. Billing keeps its
own KV-store adapter; no shared database ownership or schema migration is needed.
