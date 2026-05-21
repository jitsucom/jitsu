/**
 * Admin allow-list. `process.env.JITSU_EE_ADMINS` is a comma-separated list of email
 * patterns; `*` matches any run of characters. Example:
 *
 *   JITSU_EE_ADMINS=alice@gmail.com,*@jitsu.com
 *
 * Set `JITSU_EE_ADMINS=*` to allow every authenticated user. When `JITSU_EE_ADMINS` is empty no
 * one is allowed in.
 */

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .trim()
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&") // escape regex specials, keep `*`
    .replace(/\*/g, ".*"); // glob wildcard
  return new RegExp(`^${escaped}$`, "i");
}

export function getAdminPatterns(): string[] {
  return (process.env.JITSU_EE_ADMINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export function isAdminEmail(email: string | undefined | null): boolean {
  if (!email) {
    return false;
  }
  const normalized = email.trim();
  return getAdminPatterns().some(pattern => patternToRegExp(pattern).test(normalized));
}
