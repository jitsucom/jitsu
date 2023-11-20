import { db } from "./db";
import { getLog, randomId } from "juava";
import { isTruish } from "../shared/chores";
import { emptyAnalytics, jitsuAnalytics } from "@jitsu/js/compiled/src";

/**
 * Server telemetry is enabled by default. We need it to see the usage
 * of self-hosted instance. It's disabled for Jitsu Cloud.
 */
export const serverTelemetryEnabled = !isTruish(process.env.DISABLE_JITSU_TELEMETRY);
export const serverTelemetryJitsuKey =
  process.env.JITSU_SERVER_TELEMETRY_KEY || "n5ZDLVfXZD5JkqpcSly8I66xz3we16sv:YszSaTV83VAc6vNcFuz7Ry9dCHHV8zJY";

/**
 * Frontend telemetry is opposite from server telemetry. It's disabled by default,
 * since we need it ONLY for Jitsu Cloud. We don't need to track UI usage of self-hosted instances
 */
export const frontendTelemetryHost = process.env.TELEMETRY_HOST || process.env.JITSU_FRONTEND_TELEMETRY_HOST; //support old and new env vars

export const frontendTelemetryEnabled = !!frontendTelemetryHost;

//support old and new env vars. Do we ever need to use telemetry key?
export const frontendTelemetryWriteKey =
  process.env.TELEMETRY_WRITE_KEY || process.env.JITSU_FRONTEND_TELEMETRY_WRITE_KEY;

const log = getLog("telemetry");

const jitsu = serverTelemetryEnabled
  ? jitsuAnalytics({
      host: "https://use.jitsu.com",
      writeKey: serverTelemetryJitsuKey,
      debug: true,
    })
  : emptyAnalytics;

let deploymentId = "unknown";

export async function initTelemetry(): Promise<{ deploymentId: string }> {
  if (serverTelemetryEnabled) {
    try {
      const instanceIdVal = await db.prisma().globalProps.findFirst({ where: { name: "deploymentId" } });
      if (instanceIdVal) {
        deploymentId = (instanceIdVal.value as any).id;
      } else {
        deploymentId = randomId();
        log.atInfo().log("Initializing telemetry with deploymentId: " + deploymentId);
        await db.prisma().globalProps.create({ data: { name: "deploymentId", value: { id: deploymentId } } });
      }
    } catch (e) {
      log.atWarn().withCause(e).log("Failed to initialize telemetry");
    }
  }
  return { deploymentId };
}

export async function trackTelemetryEvent(event: string, props: any = {}): Promise<void> {
  try {
    const result = await jitsu.track(`console.${event}`, {
      ...props,
      deploymentId,
      source: "console",
      nodeVersion: process.versions.node,
      host: process.env.HOST,
      onVercel: isTruish(process.env.VERCEL),
    });
    log.atDebug().log(`Sent ${event} to telemetry server. Result`, JSON.stringify(result, null, 2));
  } catch (e) {
    log.atWarn().withCause(e).log(`Failed to send ${event} to telemetry server`);
  }
}
