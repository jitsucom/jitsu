import { db } from "./db";
import { getLog, randomId } from "juava";
import { isTruish } from "../shared/chores";
import { AnalyticsInterface, emptyAnalytics, jitsuAnalytics } from "@jitsu/js/compiled/src";
import { SessionUser } from "../schema";
import { Workspace } from "@prisma/client";
import { NextApiRequest } from "next";
import { AnalyticsContext } from "@jitsu/protocols/analytics";

/**
 * Server telemetry is enabled by default. We need it to see the usage
 * of self-hosted instance. It's disabled for Jitsu Cloud.
 */
export const anonymousTelemetryEnabled = !isTruish(process.env.JITSU_DISABLE_ANONYMOUS_TELEMETRY);
export const anonymousTelemetryJitsuKey =
  process.env.JITSU_SERVER_ANONYMOUS_TELEMETRY_KEY ||
  "n5ZDLVfXZD5JkqpcSly8I66xz3we16sv:YszSaTV83VAc6vNcFuz7Ry9dCHHV8zJY";

/**
 * Frontend telemetry is opposite from server telemetry. It's disabled by default,
 * since we need it ONLY for Jitsu Cloud. We don't need to track UI usage of self-hosted instances
 */
export const productTelemetryHost = process.env.JITSU_PRODUCT_TELEMETRY_HOST; //support old and new env vars
export const productTelemetryEnabled = !!productTelemetryHost;
export const productTelemetryBackendKey = process.env.JITSU_PRODUCT_BACKEND_TELEMETRY_WRITE_KEY;

const log = getLog("telemetry");

const anonymousTelemetry = anonymousTelemetryEnabled
  ? jitsuAnalytics({
      host: "https://use.jitsu.com",
      writeKey: anonymousTelemetryJitsuKey,
    })
  : emptyAnalytics;

function createAnalytics() {
  return productTelemetryEnabled
    ? jitsuAnalytics({
        host: productTelemetryHost,
        writeKey: productTelemetryBackendKey,
        s2s: true,
        //debug: true,
      })
    : emptyAnalytics;
}

type WorkspaceProps = { slug?: string; name?: string };
type WorkspaceIdAndProps = { id: string } & WorkspaceProps;

type TrackEvents =
  | "user_created"
  | "workspace_created"
  | "workspace_onboarded"
  | "workspace_ping"
  | "workspace_access"
  | "create_object";

export interface ProductAnalytics extends AnalyticsInterface {
  identifyUser(sessionUser: TrackedUser): Promise<any>;

  workspace(workspaceId: string, opts?: WorkspaceProps): Promise<any>;

  workspace(workspace: Workspace): Promise<any>;

  /**
   * Typed version of track method
   */
  track(event: TrackEvents, props?: any): Promise<any>;
}

function createProductAnalytics(analytics: AnalyticsInterface, req?: NextApiRequest): ProductAnalytics {
  return {
    ...analytics,
    identifyUser(sessionUser: SessionUser): Promise<void> {
      return analytics.identify(sessionUser.internalId, {
        email: sessionUser.email,
        name: sessionUser.name,
        externalId: sessionUser.externalId,
      });
    },
    workspace(idOrObject: string | Workspace, opts?: WorkspaceProps) {
      if (typeof idOrObject === "string") {
        return analytics.group(idOrObject, opts ? { workspaceSlug: opts.slug, workspaceName: opts.name } : {});
      } else {
        return analytics.group(idOrObject.id, { workspaceSlug: idOrObject.slug, workspaceName: idOrObject.name });
      }
    },
    track(event: TrackEvents, props?: any): Promise<any> {
      const context: AnalyticsContext = {
        ip: (req?.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req?.socket?.remoteAddress,
        //userAgent: req?.headers["user-agent"] as string,
      };
      return analytics.track(event, { ...(props || {}), context });
    },
  };
}

export type TrackedUser = Pick<SessionUser, "internalId" | "email" | "name" | "externalId" | "loginProvider">;

/**
 * Entry point for all analytics events. The method makes sure that all indentify events
 * are properly sent, and calls a `callback` on configured analytics instance.
 */
export function withProductAnalytics(
  callback: (p: ProductAnalytics) => Promise<any>,
  opts: {
    user: TrackedUser;
    workspace?: Workspace | WorkspaceIdAndProps;
    req?: NextApiRequest;
  }
): Promise<any[]> {
  //we create new instance every time since analytics.js saves state in props and not thread safe
  //creating of an instance is cheap operation
  const instance = createProductAnalytics(createAnalytics(), opts?.req);
  const allPromises: Promise<any>[] = [];
  if (opts.user) {
    allPromises.push(instance.identifyUser(opts.user));
  }
  if (opts.workspace) {
    allPromises.push(
      instance.workspace(opts.workspace.id, {
        slug: opts.workspace.slug || undefined,
        name: opts.workspace.name || undefined,
      })
    );
  }
  allPromises.push(
    (async () => {
      try {
        return await callback(instance);
      } catch (e) {
        log.atWarn().withCause(e).log("Failed to send product analytics event");
      }
      return {};
    })()
  );
  return Promise.all(allPromises);
}

let deploymentId = "unknown";

export async function initTelemetry(): Promise<{ deploymentId: string }> {
  if (anonymousTelemetryEnabled) {
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
    const result = await anonymousTelemetry.track(`console.${event}`, {
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
