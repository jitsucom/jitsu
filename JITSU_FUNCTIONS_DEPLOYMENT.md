# Functions Server Deployment & Routing

## Database Schema

```sql
CREATE TABLE "FunctionsServer" (
  "workspaceId"      text         NOT NULL,
  "class"            text         NOT NULL,  -- 'free' | 'dedicated' | 'premium'
  "deploymentId"     text,
  "connections"      text[],                 -- connections with functions
  "emptyConnections" text[],                 -- connections without functions (tracked for routing)
  "createdAt"        timestamptz  NOT NULL DEFAULT now(),
  "updatedAt"        timestamptz,
  "shutdownAt"       timestamptz,            -- scheduled termination time
  "deleted"          boolean      DEFAULT false,
  PRIMARY KEY ("workspaceId", "class")
);
```

> **Note:** A row is inserted even for workspaces that have no functions, to keep track of empty connections and enable correct routing.

---

## Class Assignment

| Source | Logic |
|--------|-------|
| Subscription-based | `free` or `dedicated` based on current payment status |
| Forced override | `premium` is always force-assigned, independent of payment status |

---

## Routing Algorithm (Rotor)

1. Look up the `FunctionsServer` record matching the workspace's expected **class**.
2. If found → use that deployment.
3. If not found → fall back to the next **lower** class.
   - This is expected temporarily when a workspace has just upgraded (e.g., `dedicated` record doesn't exist yet, fall back to `free`).
4. If no lower class exists → should not happen → **Drop & Retry**. (or should we fallback to 'legacy' as last resort?)

---

## Corner Cases

### 1. Connection just created with functions

- **Rotor** sees the connection with functions attached.
- **`FunctionsServer` table** has no record of this connection at all.
- **Behavior:** Act as if the backend hasn't received info about this connection yet.
- **Result:** Silently **drop the event**.

### 2. Functions added to a previously empty connection

- **Rotor** knows the connection now has functions.
- **`FunctionsServer` table** still lists the connection in `emptyConnections`.
- **Behavior:** Act as if the backend hasn't received the updated connection config yet.
- **Result:** **Pass the event** to the destination without running functions.

---

## Transition: Free → Dedicated

> Starting point: some workspaces are manually forced to `dedicated` or `premium`. All others are `free`. The goal is to smoothly transition workspaces to `dedicated` deployments.

```
Timeline
────────────────────────────────────────────────────────────────────
  Rotor assumes "dedicated"     Operator creates deployment
  but only "free" exists        and updates FunctionsServer
  → falls back to "free"        → Rotor picks up "dedicated"
────────────────────────────────────────────────────────────────────
```

**Step-by-step:**

1. **Rotor** assumes `dedicated` status based on subscription, but only a `free` record exists in `FunctionsServer`.
2. **Rotor** falls back and selects the `free` deployment.
3. **Operator** detects the workspace should be `dedicated` → initiates creation of a new deployment.
4. **Operator** creates or updates the `FunctionsServer` record **only after** the deployment is fully rolled out or updated.
5. **Operator** excludes the workspace from the `free` deployment only when a safe handoff is confirmed:
   ```sql
   SELECT count(*) FROM "FunctionsServer"
   WHERE "workspaceId" = ?
     AND "deploymentId" <> ?
     AND "createdAt" < now() - interval '5 minutes'
     AND "shutdownAt" IS NULL
     AND deleted = false
   ```
   The 5-minute delay ensures all Rotor instances have an updated view of the table and no longer rely on the `free` deployment.
6. **Rotor** sees the `dedicated` record in `FunctionsServer` and selects the appropriate deployment.

---

## Transition: Dedicated → Free

> When a workspace downgrades, the dedicated deployment needs to be drained before removal.

```
Timeline
────────────────────────────────────────────────────────────────────
  Rotor assumes "free"          Operator adds to free deployment
  but no "free" record          and schedules dedicated shutdown
  → falls back to "dedicated"   → Rotor picks up "free"
────────────────────────────────────────────────────────────────────
```

**Step-by-step:**

1. **Rotor** assumes `free` status based on subscription, but no `free` record exists in `FunctionsServer`.
2. **Rotor** falls back and selects the existing higher-class (`dedicated`) deployment.
3. **Operator** sets `shutdownAt = now() + interval '10 minutes'` for the dedicated deployment that no longer matches the subscription status.
4. **Operator** adds the workspace to the `free` deployment.
5. **Operator** updates `FunctionsServer` with the `free` record **only after** the free deployment is fully updated.
6. **Rotor** sees the `free` record and selects the appropriate deployment.
7. **Operator** deletes the `dedicated` deployment when `shutdownAt < now()`, **but only if** the `free` deployment is not in an intermediate (rolling) state.
8. **Operator** sets `deleted = true` for the removed deployment record.
