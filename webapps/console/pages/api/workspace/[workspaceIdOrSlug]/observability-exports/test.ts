import { createRoute, verifyAccessWithRole } from "../../../../../lib/api";
import { z } from "zod";
import { db } from "../../../../../lib/server/db";
import { requireDefined } from "juava";
import { getServerLog } from "../../../../../lib/server/log";
import {
  containsMaskedHeaderValues,
  ObservabilityExportsSettings,
  observabilityExportsNamespace,
  unmaskObservabilityExportsSettings,
  defaultObservabilityExportsSettings,
} from "../../../../../lib/shared/observability-exports";
import { encodeOtlpLogsRequest, OTLP_SEVERITY } from "../../../../../lib/server/otlp-logs";
import { sendOtlpTestRequest } from "../../../../../lib/server/otlp-test-request";

const log = getServerLog("observability-exports-test");

export default createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceIdOrSlug: z.string() }),
    // The client sends its current (possibly unsaved) form values; masked header
    // values are resolved against the stored settings so the user can test
    // without re-typing credentials
    body: ObservabilityExportsSettings,
    result: z.object({
      ok: z.boolean(),
      status: z.number().optional(),
      response: z.string().optional(),
      error: z.string().optional(),
    }),
  })
  .handler(async ({ query: { workspaceIdOrSlug }, user, body }) => {
    const workspace = requireDefined(
      await db
        .prisma()
        .workspace.findFirst({ where: { OR: [{ id: workspaceIdOrSlug }, { slug: workspaceIdOrSlug }] } }),
      `Workspace ${workspaceIdOrSlug} not found`
    );
    await verifyAccessWithRole(user, workspace.id, "editEntities");
    // freshest row wins deterministically — duplicates can exist, see index.ts
    const row = await db.prisma().workspaceOptions.findFirst({
      where: { workspaceId: workspace.id, namespace: observabilityExportsNamespace },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    const parsed = row ? ObservabilityExportsSettings.safeParse(row.value) : undefined;
    const stored = parsed?.success ? parsed.data : defaultObservabilityExportsSettings;
    const requested = ObservabilityExportsSettings.parse(body);
    // Masked header values resolve to stored secrets, and stored secrets may only
    // ever travel to the stored endpoint: resolving them for a request-supplied
    // endpoint would let any editor exfiltrate a credential they can't read back
    if (containsMaskedHeaderValues(requested) && requested.endpoint !== stored.endpoint) {
      return {
        ok: false,
        error: "The endpoint differs from the saved one. Re-enter header values to test a new endpoint, or save first.",
      };
    }
    const settings = unmaskObservabilityExportsSettings(requested, stored);
    if (!settings.endpoint) {
      return { ok: false, error: "OTLP logs endpoint is not configured" };
    }

    const timestamp = new Date();
    const payload = encodeOtlpLogsRequest({
      resourceAttributes: {
        "service.name": "jitsu-live-events",
      },
      scopeName: "jitsu",
      logRecords: [
        {
          timestamp,
          severityNumber: OTLP_SEVERITY.info.number,
          severityText: OTLP_SEVERITY.info.text,
          body: {
            message: "Jitsu observability exports test log. Your endpoint and credentials work.",
            sentAt: timestamp.toISOString(),
          },
          attributes: {
            "jitsu.workspace.id": workspace.id,
            "jitsu.live_event.type": "test",
            "jitsu.test": true,
          },
        },
      ],
    });

    return await sendOtlpTestRequest(settings, new Uint8Array(payload), {
      onFailure: e => log.atWarn().withCause(e).log(`Test log delivery failed for workspace ${workspace.id}`),
    });
  })
  .toNextApiHandler();
