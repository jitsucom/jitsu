import { getErrorMessage } from "juava";
import { withFirebaseAdminAuth } from "../../../lib/route-helpers";
import { syncStatCache, SyncCacheGranularity } from "../sync-cache";

/**
 * On-demand `newjitsuee.stat_cache` refresh for the admin UI.
 *
 * Streams newline-delimited JSON — one {@link SyncCacheProgress} object per line,
 * plus a final `{ type: "error", message }` line if the refresh fails — so the
 * caller can render live progress. `?full=true` rebuilds the last 12 months;
 * otherwise only the current period is refreshed.
 */
export default withFirebaseAdminAuth(async (req, res) => {
  const full = req.query.full === "true" || req.query.full === "1";
  const granularity: SyncCacheGranularity = req.query.granularity === "day" ? "day" : "month";

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("X-Accel-Buffering", "no");

  const write = (event: unknown) => res.write(JSON.stringify(event) + "\n");
  try {
    for await (const event of syncStatCache({ full, granularity })) {
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
