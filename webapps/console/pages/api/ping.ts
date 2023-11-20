import { createRoute } from "../../lib/api";
import { initTelemetry, trackTelemetryEvent } from "../../lib/server/telemetry";

export default createRoute()
  .GET({ auth: false })
  .handler(async () => {
    const { deploymentId } = await initTelemetry();
    await trackTelemetryEvent("ping");
    return {
      health: "ok",
      deploymentId,
    };
  })
  .toNextApiHandler();
