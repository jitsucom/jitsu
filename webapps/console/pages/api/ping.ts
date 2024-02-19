import { createRoute } from "../../lib/api";
import { initTelemetry, trackTelemetryEvent } from "../../lib/server/telemetry";

export default createRoute()
  .GET({ auth: false })
  .handler(async ({ user }) => {
    const telemetry = await initTelemetry();
    await trackTelemetryEvent("ping");
    return {
      health: "ok",
      telemetryEnabled: !!telemetry,
      deploymentId: telemetry?.deploymentId,
    };
  })
  .toNextApiHandler();
