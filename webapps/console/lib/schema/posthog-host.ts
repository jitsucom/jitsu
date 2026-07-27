export const POSTHOG_HTTPS_PREFIX = "https://";

export function posthogHostToDomain(host?: string): string {
  return host?.startsWith(POSTHOG_HTTPS_PREFIX) ? host.slice(POSTHOG_HTTPS_PREFIX.length) : host ?? "";
}

export function posthogDomainToHost(domain: string): string {
  return domain ? `${POSTHOG_HTTPS_PREFIX}${domain}` : "";
}
