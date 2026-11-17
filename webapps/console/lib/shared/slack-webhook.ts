/**
 * Slack incoming webhooks live on hooks.slack.com. The notification code POSTs from the server to the stored URL,
 * so any other host would let a workspace member make the server call arbitrary addresses (and read the answer).
 */
export function isSlackWebhookUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname === "hooks.slack.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === ""
  );
}
