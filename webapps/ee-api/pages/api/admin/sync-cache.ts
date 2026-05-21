import { getErrorMessage } from "juava";
import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { syncStatCache } from "../sync-cache";

/**
 * On-demand `newjitsuee.stat_cache` refresh for the admin UI.
 *
 * `POST` only — it mutates the cache. Streams newline-delimited JSON: one
 * {@link SyncCacheProgress} object per line, plus a final `{ type: "error",
 * message }` line if the refresh fails, so the caller can render live progress.
 * `?full=true` rebuilds the last 12 months; otherwise only the current month.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const full = req.query.full === "true" || req.query.full === "1";

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  const write = (event: unknown) => res.write(JSON.stringify(event) + "\n");
  try {
    for await (const event of syncStatCache({ full })) {
      write(event);
    }
  } catch (e) {
    write({ type: "error", message: getErrorMessage(e) });
  }
  res.end();
});

export const config = {
  maxDuration: 300,
};
