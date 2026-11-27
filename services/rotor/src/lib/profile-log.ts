/**
 * What a log line says about the result of a profile builder: how big it is, never what is in it. The result is an end user's
 * profile (traits such as an email or a name), which is personal data of the customer's customers and must not sit in the logs.
 */
export function describeProfileResult(result: unknown): string {
  const fields = result && typeof result === "object" ? Object.keys(result as object).length : 0;
  const bytes = Buffer.byteLength(JSON.stringify(result) ?? "");
  return `${fields} top-level field(s), ${bytes} bytes`;
}
