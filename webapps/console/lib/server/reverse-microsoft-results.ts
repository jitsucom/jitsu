import { z } from "zod";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { ReverseSyncOptions } from "@jitsu/warehouse-query/src/schema";
import { contentHash } from "@jitsu/destination-functions/src/reverse-etl/identity";
import {
  MicrosoftAudienceOptions,
  MicrosoftConversionOptions,
  MicrosoftId,
  microsoftAudienceState,
} from "@jitsu/destination-functions/src/functions/microsoft-ads/meta";
import {
  microsoftGoals,
  microsoftReadClient,
  MicrosoftReadError,
} from "@jitsu/destination-functions/src/functions/microsoft-ads/discovery";
import {
  microsoftReportRange,
  parseMicrosoftReport,
  pollMicrosoftReport,
  readMicrosoftAudience,
  submitMicrosoftReport,
} from "@jitsu/destination-functions/src/functions/microsoft-ads/results";
import { downloadMicrosoftReport } from "@jitsu/destination-functions/src/functions/microsoft-ads/report-download";
import type { MicrosoftResults } from "@jitsu/destination-functions/src/functions/microsoft-ads/results-meta";
import { microsoftReadAuth } from "./reverse-microsoft-options";
import { assertModelsEnabled } from "./reverse-etl-models";
import type { NangoConfig } from "./oauth/nango-config";
import { ApiError } from "../shared/errors";

const ticket = z.object({
  binding: z.string(),
  reportId: z.string().min(1).max(40),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  goalId: MicrosoftId,
});
const signing = { algorithm: "HS256", issuer: "jitsu-microsoft-report", audience: "jitsu-microsoft-results" } as const;
export function reportTicket(value: z.infer<typeof ticket>, secret: string) {
  if (!secret) throw new ApiError("Report signing is not configured", { status: 503 });
  return jwt.sign(ticket.parse(value), secret, { ...signing, expiresIn: "1h" });
}
export function readReportTicket(value: string, binding: string, secret: string) {
  try {
    const parsed = ticket.parse(
      jwt.verify(value, secret, { algorithms: ["HS256"], issuer: signing.issuer, audience: signing.audience })
    );
    if (parsed.binding !== binding) throw new Error();
    return parsed;
  } catch {
    throw new ApiError(
      "This report expired or its destination changed. Refresh Microsoft results to start a fresh report.",
      { status: 409 }
    );
  }
}

/** No writes to sync/task/target state; reporting continuations are signed and reauthorized on every request. */
export async function reverseMicrosoftResults(
  prisma: PrismaClient,
  workspaceId: string,
  syncId: string,
  continuation: string | undefined,
  deps: {
    nango: NangoConfig;
    developerToken?: string;
    secret: string;
    request?: typeof fetch;
    download?: typeof downloadMicrosoftReport;
  }
): Promise<MicrosoftResults> {
  await assertModelsEnabled(prisma, workspaceId);
  const link = await prisma.configurationObjectLink.findFirst({
    where: { id: syncId, workspaceId, type: "reverse-sync", deleted: false },
    include: { to: true, workspace: true },
  });
  if (
    !link ||
    link.workspace.deleted ||
    link.to.deleted ||
    link.to.workspaceId !== workspaceId ||
    link.to.type !== "destination"
  )
    throw new ApiError("Reverse sync not found in this workspace", { status: 404 });
  const config = link.to.config as Record<string, unknown>;
  if (config.destinationType !== "microsoft-ads") throw new ApiError("Microsoft Ads sync not found", { status: 404 });
  const auth = await microsoftReadAuth(config, link.toId, deps.nango, deps.developerToken, deps.request);
  const accountId = MicrosoftId.parse(auth.accountId);
  const customerId = MicrosoftId.parse(auth.customerId);
  const common = { accountId, observedAt: new Date().toISOString() };
  const unavailable = (message: string): MicrosoftResults => ({ ...common, kind: "unavailable", message });
  const options = ReverseSyncOptions.parse(link.data);
  const read = microsoftReadClient(auth, deps.request);
  try {
    if (options.stream === "audience") {
      const settings = MicrosoftAudienceOptions.parse(options.streamOptions);
      let targetId: string;
      let managed: { marker: string; accountId: string } | undefined;
      if (settings.audience.kind === "existing") targetId = settings.audience.audienceId;
      else {
        const state = await prisma.source_state.findUnique({
          where: { sync_id_stream: { sync_id: syncId, stream: microsoftAudienceState } },
        });
        if (!state) return unavailable("The managed audience has not been created yet. Run the sync first.");
        const saved = z
          .object({
            version: z.literal(1),
            binding: z.string(),
            marker: z.string().regex(/^jitsu-retl-[a-f0-9]{64}$/),
            phase: z.enum(["prepared", "submitting", "ready"]),
            audienceId: MicrosoftId.optional(),
          })
          .safeParse(state.state);
        if (
          !saved.success ||
          saved.data.binding !==
            contentHash({
              workspace: workspaceId,
              sync: syncId,
              destination: link.toId,
              accountId,
              customerId,
              settings,
            })
        )
          return unavailable(
            "Saved audience state does not match this sync. Preserve the state and check its destination settings."
          );
        if (saved.data.phase !== "ready" || !saved.data.audienceId)
          return unavailable(
            "Audience creation is not yet confirmed. Let the runner resolve the saved request without resetting state."
          );
        targetId = saved.data.audienceId;
        managed = { marker: saved.data.marker, accountId };
      }
      return { ...common, kind: "audience", ...(await readMicrosoftAudience(read, targetId, managed)) };
    }
    if (options.stream !== "offline-conversions")
      return unavailable("This Microsoft stream does not support result reporting.");
    const { conversionName: goal } = MicrosoftConversionOptions.parse(options.streamOptions);
    const binding = contentHash({ workspaceId, syncId, destinationId: link.toId, config, goal });
    const prior = continuation ? readReportTicket(continuation, binding, deps.secret) : undefined;
    const goals = (await microsoftGoals(read)).filter(g => g.Name === goal);
    if (goals.length !== 1)
      return unavailable(
        "The configured offline conversion goal could not be uniquely found. Check its exact name and account permissions."
      );
    if (prior && prior.goalId !== goals[0].Id)
      return unavailable(
        "The conversion goal changed since this report started. Refresh Microsoft results to start a fresh report."
      );
    if (!prior) {
      const range = microsoftReportRange();
      // Validate the signing configuration before submitting a report.
      if (!deps.secret) throw new ApiError("Report signing is not configured", { status: 503 });
      const reportId = await submitMicrosoftReport(read, accountId, range);
      return {
        ...common,
        ...range,
        goal,
        kind: "pending",
        continuation: reportTicket({ binding, reportId, goalId: goals[0].Id, ...range }, deps.secret),
      };
    }
    const range = { start: prior.start, end: prior.end };
    const status = await pollMicrosoftReport(read, prior.reportId);
    if (status.Status === "Pending") return { ...common, ...range, goal, kind: "pending", continuation: continuation! };
    const totals = status.ReportDownloadUrl
      ? parseMicrosoftReport(
          await (deps.download ?? downloadMicrosoftReport)(status.ReportDownloadUrl),
          accountId,
          goal
        )
      : [];
    return { ...common, ...range, goal, kind: "conversions", totals };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      error instanceof MicrosoftReadError
        ? error.message
        : "Microsoft returned an unsupported results response. Check Microsoft Advertising or try again later.",
      { status: 409 }
    );
  }
}
