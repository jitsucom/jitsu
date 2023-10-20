import dayjs from "dayjs";
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";

const MESSAGES_RETRY_COUNT = process.env.MESSAGES_RETRY_COUNT ? parseInt(process.env.MESSAGES_RETRY_COUNT) : 3;
// MESSAGES_RETRY_BACKOFF_BASE defines base for exponential backoff in minutes.
// For example, if MESSAGES_RETRY_COUNT is 3 and base is 5, then retry delays will be 5, 25, 125 minutes.
const MESSAGES_RETRY_BACKOFF_BASE = process.env.MESSAGES_RETRY_BACKOFF_BASE
  ? parseInt(process.env.MESSAGES_RETRY_BACKOFF_BASE)
  : 5;
// MESSAGES_RETRY_BACKOFF_MAX_DELAY defines maximum possible retry delay in minutes. Default: 1440 minutes = 24 hours
const MESSAGES_RETRY_BACKOFF_MAX_DELAY = process.env.MESSAGES_RETRY_BACKOFF_MAX_DELAY
  ? parseInt(process.env.MESSAGES_RETRY_BACKOFF_MAX_DELAY)
  : 1440;

export type retryPolicy = {
  retries: number;
  delays: number[];
};

const retryDefaultDelays = (() => {
  const delays: number[] = [];
  for (let i = 0; i < MESSAGES_RETRY_COUNT; i++) {
    delays.push(Math.min(Math.pow(MESSAGES_RETRY_BACKOFF_BASE, i + 1), MESSAGES_RETRY_BACKOFF_MAX_DELAY));
  }
  return delays;
})();

export const retryDefaultPolicy: retryPolicy = {
  retries: MESSAGES_RETRY_COUNT,
  delays: retryDefaultDelays,
};

export function getRetryPolicy(e: Error & { retryPolicy?: retryPolicy }): retryPolicy {
  let retryPolicy = retryDefaultPolicy;
  if (e.retryPolicy) {
    retryPolicy = { ...retryPolicy, ...e.retryPolicy };
    retryPolicy.retries = Math.min(MESSAGES_RETRY_COUNT, retryPolicy.retries);
    retryPolicy.delays = retryPolicy.delays.map(d => Math.min(MESSAGES_RETRY_BACKOFF_MAX_DELAY, d));
  }
  return retryPolicy;
}

export function retryBackOffTime(retryPolicy: retryPolicy, attempt: number) {
  if (attempt > retryPolicy.retries) {
    return "";
  }
  const delays = retryPolicy?.delays?.length > 0 ? retryPolicy.delays : retryDefaultDelays;
  const backOffDelayMin = delays[attempt - 1] || delays[delays.length - 1];
  return dayjs().add(backOffDelayMin, "minute").utc().toISOString();
}

export function retryLogMessage(retryPolicy: retryPolicy, retries: number): string {
  const retryTime = retryBackOffTime(retryPolicy, retries + 1);
  return `${retries > 0 ? `Retry attempt: ${retries} of ${retryPolicy.retries}. ` : ""}${
    retryTime ? `Scheduled retry time: ${retryTime}` : "Putting to dead-letter queue."
  }`;
}

export function retryLogMessageIfNeeded(e: Error & { retryPolicy?: retryPolicy }, retries: number) {
  if (e.name === DropRetryErrorName || e.name === RetryErrorName) {
    const retryPolicy = getRetryPolicy(e);
    return retryLogMessage(retryPolicy, retries);
  }
}
