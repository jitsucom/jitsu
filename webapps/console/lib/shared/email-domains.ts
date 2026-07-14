export const publicEmailDomains = [
  "gmail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "yandex.com",
  "googlemail.com",
  "mail.ru",
  "yandex.ru",
  "protonmail.com",
  "protonmail.me",
  "icloud.com",
  "hey.com",
];

/**
 * User-facing copy shown when a signup is refused for using a personal email
 * (JITSU-70). Kept here (client-safe) so the server endpoints and the signup
 * form share one wording.
 */
export const WORK_EMAIL_REQUIRED_MESSAGE =
  "Please use your work email to sign up. Personal email addresses (Gmail, Outlook, etc.) aren't accepted.";

/**
 * Whether an email address belongs to a known personal/consumer provider
 * (gmail, yahoo, icloud, …) rather than a company domain. Used to enforce the
 * work-email signup requirement (JITSU-70).
 */
export function isPersonalEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  return !!domain && publicEmailDomains.includes(domain);
}
