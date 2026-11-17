export const TEST_FAILURE_FALLBACK = "Internal error, see logs for details";

/**
 * The text the "Test connection" dialog shows when the test request itself failed, so there is no test result to show.
 * The server's own message is shown when there is one: the refusal to reuse saved secrets after a host change is a 400
 * that tells the user to enter the secret again, and the generic text hid it. A request that failed without any message
 * keeps the generic text. The services page already shows the message the same way.
 */
export function testFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message.trim() ? message : TEST_FAILURE_FALLBACK;
}
