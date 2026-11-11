import { z } from "zod";
import { OpenAiApiError } from "./client";
import { OpenAiAdsCall, OpenAiWait, openAiAdsRequest, realWait, retryAfterSeconds } from "./ads-client";
import type { OpenAiAudienceIdentifier } from "./audience-identifiers";

// Statuses are open strings at OpenAI (the spec does not enumerate them), so anything unknown means "not finished".
const audience = z.object({
  id: z.string(),
  status: z.string(),
  description: z.string().nullish(),
  membership_revision: z.number().int().optional(),
});
const operation = z.object({
  operation_id: z.string(),
  custom_audience_id: z.string(),
  operation: z.string(),
  status: z.string(),
  failure_reason: z.object({ code: z.string().optional() }).nullish(),
});
const audienceList = z.object({
  data: z.array(audience),
  has_more: z.boolean().optional(),
  last_id: z.string().nullish(),
});
export type OpenAiAudienceObject = z.infer<typeof audience>;
export type OpenAiOperation = z.infer<typeof operation>;
export type OpenAiMembershipAction = "add" | "remove";

/** The wait ran out. Says nothing about whether the work finished, so the caller must reconcile, never resubmit. */
export class OpenAiWaitTimeout extends Error {
  constructor(what: string) {
    super(`OpenAI ${what} did not reach a final state in time`);
  }
}
/** The audience cannot take members (failed, archived). */
export class OpenAiAudienceUnusable extends Error {
  constructor(readonly audienceStatus: string) {
    super("The OpenAI audience cannot be used; check it in Ads Manager");
  }
}

const readyStatuses = new Set(["ready", "too_small"]);
const unusableStatuses = new Set(["failed", "archived"]);
const code = (error: unknown) => (error instanceof OpenAiApiError ? error.code : undefined);

/** Seconds of delay before the next poll: 1 s growing by half each time, never above 10 s. */
const pollDelay = (attempt: number) => Math.min(1000 * 1.5 ** attempt, 10_000);

export async function adAccountId(call: OpenAiAdsCall): Promise<string> {
  return z.object({ id: z.string().min(1) }).parse(await openAiAdsRequest(call, "GET", "/ad_account")).id;
}

/** Not replayable at OpenAI (no Idempotency-Key): the caller saves its intent first and never calls this twice. */
export async function createAudience(
  call: OpenAiAdsCall,
  input: { name: string; description: string }
): Promise<OpenAiAudienceObject> {
  return audience.parse(await openAiAdsRequest(call, "POST", "/custom_audiences", { body: input }));
}

export async function getAudience(call: OpenAiAdsCall, id: string): Promise<OpenAiAudienceObject> {
  return audience.parse(await openAiAdsRequest(call, "GET", `/custom_audiences/${encodeURIComponent(id)}`));
}

/**
 * Audience ids whose description contains the marker. The list has no name filter, so scan newest first, a page at a
 * time, until the end. Used only after a create whose answer was lost.
 */
export async function findAudiencesByMarker(call: OpenAiAdsCall, marker: string, maxPages = 50): Promise<string[]> {
  const found: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = audienceList.parse(
      await openAiAdsRequest(
        call,
        "GET",
        `/custom_audiences?limit=100&order=desc${after ? `&after=${encodeURIComponent(after)}` : ""}`
      )
    );
    for (const item of result.data) if (item.description?.includes(marker)) found.push(item.id);
    if (!result.has_more) return found;
    after = result.last_id ?? undefined;
    if (!after) throw new Error("OpenAI audience discovery returned incomplete pagination");
  }
  throw new Error("OpenAI audience discovery exceeded its page limit");
}

/** Polls until the audience can take members (about 17 s after create in practice). */
export async function waitForAudienceReady(
  call: OpenAiAdsCall,
  id: string,
  options: { timeoutMs?: number; wait?: OpenAiWait } = {}
): Promise<OpenAiAudienceObject> {
  const wait = options.wait ?? realWait;
  const deadline = wait.now() + (options.timeoutMs ?? 5 * 60_000);
  for (let attempt = 0; ; attempt++) {
    const current = await getAudience(call, id);
    if (readyStatuses.has(current.status)) return current;
    if (unusableStatuses.has(current.status)) throw new OpenAiAudienceUnusable(current.status);
    if (wait.now() >= deadline) throw new OpenAiWaitTimeout("audience");
    await wait.sleep(pollDelay(attempt), call.signal);
  }
}

/**
 * Runs one retry loop for calls that are safe to repeat: `503 operation_unavailable` (also what an Add gets before the
 * audience is ready, with nothing accepted), `409 mutation_conflict` and 429, with the same key, inside a budget.
 * Anything else, including a lost connection, is thrown for the caller to classify.
 */
async function retrying<T>(call: OpenAiAdsCall, wait: OpenAiWait, budgetMs: number, run: () => Promise<T>): Promise<T> {
  const deadline = wait.now() + budgetMs;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retryable =
        error instanceof OpenAiApiError &&
        error.hasEnvelope &&
        (error.status === 429 ||
          (error.status === 503 && code(error) === "custom_audience_operation_unavailable") ||
          (error.status === 409 && code(error) === "custom_audience_mutation_conflict"));
      if (!retryable || wait.now() >= deadline) throw error;
      const hinted = retryAfterSeconds(error as OpenAiApiError);
      // A hint of 0 must not turn into a tight loop: wait at least half a second.
      await wait.sleep(hinted !== undefined ? Math.max(hinted * 1000, 500) : pollDelay(attempt), call.signal);
    }
  }
}

/**
 * Submit an Add or Remove. The same key and body return the original operation, so this is also how a lost response
 * is recovered; never call it with a new key for work that may already have been accepted.
 */
export async function submitMembership(
  call: OpenAiAdsCall,
  audienceId: string,
  action: OpenAiMembershipAction,
  identifiers: OpenAiAudienceIdentifier[],
  idempotencyKey: string,
  options: { wait?: OpenAiWait; retryBudgetMs?: number } = {}
): Promise<OpenAiOperation> {
  const wait = options.wait ?? realWait;
  return retrying(call, wait, options.retryBudgetMs ?? 5 * 60_000, async () =>
    operation.parse(
      await openAiAdsRequest(call, "POST", `/custom_audiences/${encodeURIComponent(audienceId)}/${action}`, {
        body: { identifiers },
        idempotencyKey,
        timeoutMs: 120_000,
      })
    )
  );
}

/** Polls an operation to `succeeded` or `failed`. Unknown statuses keep waiting; running out of time throws. */
export async function waitForOperation(
  call: OpenAiAdsCall,
  audienceId: string,
  operationId: string,
  options: { timeoutMs?: number; wait?: OpenAiWait } = {}
): Promise<OpenAiOperation> {
  const wait = options.wait ?? realWait;
  const deadline = wait.now() + (options.timeoutMs ?? 10 * 60_000);
  const base = `/custom_audiences/${encodeURIComponent(audienceId)}/operations/${encodeURIComponent(operationId)}`;
  for (let attempt = 0; ; attempt++) {
    let current: OpenAiOperation | undefined;
    try {
      current = operation.parse(await openAiAdsRequest(call, "GET", base));
    } catch (error) {
      // An interrupted Add or Remove is resumed by id (no key, no body), then polled as before.
      if (
        error instanceof OpenAiApiError &&
        error.status === 409 &&
        code(error) === "custom_audience_operation_recovery_required"
      )
        await openAiAdsRequest(call, "POST", `${base}/resume`);
      // A status call that is temporarily unavailable or rate limited says nothing about the operation.
      else if (
        !(error instanceof OpenAiApiError && error.hasEnvelope && (error.status === 429 || error.status === 503))
      )
        throw error;
    }
    if (current && (current.status === "succeeded" || current.status === "failed")) return current;
    if (wait.now() >= deadline) throw new OpenAiWaitTimeout("operation");
    await wait.sleep(pollDelay(attempt), call.signal);
  }
}
