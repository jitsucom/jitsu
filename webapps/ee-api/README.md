# ee-api

Enterprise-edition API for Jitsu. Hosts billing/quota endpoints and an internal
**admin UI** (Billing, Admin Workspaces).

## Admin UI

The admin UI is gated by Firebase login plus an allow-list:

- `/login` — Firebase Google sign-in.
- `/` — Billing (main page).
- `/admin-workspaces` — Admin Workspaces.

### Env vars

| Var | Purpose |
| --- | --- |
| `FIREBASE_AUTH` | JSON5 `{ admin, client }` — Firebase admin credentials + client config. |
| `FIREBASE_ADMIN` + `FIREBASE_CLIENT_CONFIG` | Alternative to `FIREBASE_AUTH`: the two halves as separate JSON5 vars. |
| `JITSU_EE_ADMINS` | Comma-separated email patterns that may access the UI. `*` is a wildcard. |

`JITSU_EE_ADMINS` example:

```
JITSU_EE_ADMINS=alice@gmail.com,*@jitsu.com
```

`JITSU_EE_ADMINS=*` allows every authenticated user. When `JITSU_EE_ADMINS` is
empty, no one is allowed in.

## Dev

```bash
pnpm ee-api:dev
```

Serves at `https://ee.jitsu.localhost` (branch-suffixed — see root `CLAUDE.md`).
