import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);
import { RetryErrorName, DropRetryErrorName } from "@jitsu/functions-lib";
import { getServerEnv } from "../serverEnv";

const serverEnv = getServerEnv();
const MESSAGES_RETRY_COUNT = serverEnv.MESSAGES_RETRY_COUNT ? parseInt(serverEnv.MESSAGES_RETRY_COUNT) : 3;
// MESSAGES_RETRY_BACKOFF_BASE defines base for exponential backoff in minutes.
// For example, if MESSAGES_RETRY_COUNT is 3 and base is 5, then retry delays will be 5, 25, 125 minutes.
const MESSAGES_RETRY_BACKOFF_BASE = serverEnv.MESSAGES_RETRY_BACKOFF_BASE
  ? parseInt(serverEnv.MESSAGES_RETRY_BACKOFF_BASE)
  : 10;
// MESSAGES_RETRY_BACKOFF_MAX_DELAY defines maximum possible retry delay in minutes. Default: 1440 minutes = 24 hours
const MESSAGES_RETRY_BACKOFF_MAX_DELAY = serverEnv.MESSAGES_RETRY_BACKOFF_MAX_DELAY
  ? parseInt(serverEnv.MESSAGES_RETRY_BACKOFF_MAX_DELAY)
  : 1440;

export type retryPolicy = {
  attempts: number;
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
  attempts: MESSAGES_RETRY_COUNT,
  delays: retryDefaultDelays,
};

export const noRetryPolicy: retryPolicy = {
  attempts: 0,
  delays: [],
};

export function getRetryPolicy(e: Error & { retryPolicy?: retryPolicy }): retryPolicy {
  if (e.name !== DropRetryErrorName && e.name !== RetryErrorName) {
    return noRetryPolicy;
  }
  let retryPolicy = retryDefaultPolicy;
  if (e.retryPolicy) {
    retryPolicy = { ...retryPolicy, ...e.retryPolicy };
    retryPolicy.attempts = Math.min(MESSAGES_RETRY_COUNT, retryPolicy.attempts);
    retryPolicy.delays = retryPolicy.delays.map(d => Math.min(MESSAGES_RETRY_BACKOFF_MAX_DELAY, d));
  }
  return retryPolicy;
}

export function retryBackOffTime(retryPolicy: retryPolicy, attempt: number) {
  if (attempt > retryPolicy.attempts) {
    return "";
  }
  const delays = retryPolicy?.delays?.length > 0 ? retryPolicy.delays : retryDefaultDelays;
  const backOffDelayMin = delays[attempt - 1] || delays[delays.length - 1];
  return dayjs().add(backOffDelayMin, "minute").utc().toISOString();
}

export function retryLogMessage(retryPolicy: retryPolicy, retries: number): string {
  const retryTime = retryBackOffTime(retryPolicy, retries + 1);
  return `${retries > 0 ? `Retry attempt: ${retries} of ${retryPolicy.attempts}. ` : ""}${
    retryTime ? `Scheduled retry time: ${retryTime}` : "Putting to dead-letter queue."
  }`;
}

export function retryObject(e: Error & { retryPolicy?: retryPolicy }, retries: number) {
  if (e.name === DropRetryErrorName || e.name === RetryErrorName) {
    const retryPolicy = getRetryPolicy(e);
    const retryTime = retryBackOffTime(retryPolicy, retries + 1);
    return { retry: { left: retryPolicy.attempts - retries, ...(retryTime ? { time: retryTime } : {}) } };
  } else {
    return undefined;
  }
}

export function retryLogMessageIfNeeded(e: Error & { retryPolicy?: retryPolicy }, retries: number) {
  if (e.name === DropRetryErrorName || e.name === RetryErrorName) {
    const retryPolicy = getRetryPolicy(e);
    return retryLogMessage(retryPolicy, retries);
  }
}
