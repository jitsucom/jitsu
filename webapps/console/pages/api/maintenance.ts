import { createRoute } from "../../lib/api";
import { getPublicMaintenanceState } from "../../lib/server/maintenance";

// Database-free endpoint so the maintenance page can render even when the DB is
// unavailable. Always allowed during maintenance.
export default createRoute()
  .GET({ auth: false, allowDuringMaintenance: true })
  .handler(async () => {
    return { maintenance: getPublicMaintenanceState() ?? null };
  })
  .toNextApiHandler();
