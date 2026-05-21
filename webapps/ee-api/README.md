# ee-api

Enterprise-edition API for Jitsu. Hosts billing/quota endpoints and an internal
**admin UI** (Billing, Admin Workspaces).

## Admin UI

A client-side React app (AntD + Tailwind) gated by Firebase login plus an
allow-list:

- `/login` — Firebase Google sign-in (client SDK).
- `/` — Billing (main page).
- `/admin-workspaces` — Admin Workspaces.

### Auth

Auth is fully client-side — there is no session cookie:

- The browser signs in with the Firebase client SDK (Google popup) and holds
  the ID token; the SDK refreshes it automatically.
- `AuthProvider` resolves the signed-in user and calls `GET /api/admin/whoami`
  to check authorization; the result decides whether the UI, the login page,
  or a "not authorized" screen is shown.
- API endpoints enforce access independently. Wrap any admin endpoint with
  `withFirebaseAdminAuth` (`lib/route-helpers.ts`): it verifies the caller's
  `Authorization: Bearer <idToken>` and admits only a verified Google account
  on the `JITSU_EE_ADMINS` allow-list.

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
