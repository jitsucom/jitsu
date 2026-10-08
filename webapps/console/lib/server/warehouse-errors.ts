/** Workspace-authorized diagnostics may contain SQL/data; redact connection secrets, not query details. */
export function warehouseErrorMessage(error: unknown, config: Record<string, unknown>, fallback: string): string {
  let message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return fallback;
  const secrets = new Set<string>();
  function collect(value: unknown, sensitive = false) {
    if (typeof value === "string") {
      if (sensitive && value) {
        secrets.add(value);
        secrets.add(encodeURIComponent(value));
        secrets.add(JSON.stringify(value).slice(1, -1));
        // Service-account JSON may be echoed as individual fields by a client.
        try {
          collect(JSON.parse(value), true);
        } catch {
          /* Not JSON. */
        }
      }
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value))
        collect(child, sensitive || /password|secret|token|keyfile|private.?key|sslclientkey/i.test(key));
    }
  }
  collect(config);
  for (const secret of [...secrets].sort((a, b) => b.length - a.length))
    message = message.split(secret).join("[redacted]");
  message = message
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/)[^\s/@]+:[^\s/@]*@/gi, "$1[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, "$1 [redacted]")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[redacted]");
  return `${fallback} ${message.slice(0, 4000)}`;
}
