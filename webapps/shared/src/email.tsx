import dayjs from "dayjs";
import { z } from "zod";
import utc from "dayjs/plugin/utc";
import { Resend } from "resend";
import { render } from "@react-email/render";
import { EmailTemplate, UnsubscribeLinkProps } from "./types";
import { requireDefined } from "juava";
import { Simplify } from "type-fest";

dayjs.extend(utc);

/**
 * Parse an email address into a name and email. Accepts 'John Doe <john.doe@gmail.com>' or just
 * john.doe@gmail.com
 * @param input
 */
function parseEmailAddress(input: string): { name?: string; email: string } {
  const match = input.match(/^\s*(.*)\s*<([^<>]+)>\s*$/);
  if (match) {
    return { name: match[1].trim(), email: match[2].trim() };
  }

  return { email: input.trim() };
}

export const EmailEnvSettings = z.object({
  EMAIL_RESEND_KEY: z.string(),
  EMAIL_MARKETING_DOMAIN: z.string(),
  EMAIL_TRANSACTIONAL_DOMAIN: z.string(),
  EMAIL_TRANSACTIONAL_SENDER: z.string(),
  EMAIL_TRANSACTIONAL_REPLY_TO: z.string(),
  EMAIL_MARKETING_SENDER: z.string(),
  EMAIL_MARKETING_REPLY_TO: z.string(),
  BCC_EMAIL: z.string().email(),
});

export type EmailEnvSettings = z.infer<typeof EmailEnvSettings>;

export function getEmailEnvSettings(): EmailEnvSettings {
  requireDefined(process.env.EMAIL_RESEND_KEY, "RESEND_KEY is required");
  return EmailEnvSettings.parse(process.env);
}

export function isEmailAvailable(): boolean {
  return !!process.env.EMAIL_RESEND_KEY;
}

export function newId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function getDomainFromEmail(email: string): string {
  return parseEmailAddress(email).email.split("@")[1];
}

function firstDefined<T>(...args: (T | undefined)[]): T {
  return args.find(arg => arg !== undefined) as T;
}

type DiscriminatedUnion<T1, T2> =
  | (T1 & { [K in Exclude<keyof T2, keyof T1>]?: never })
  | (T2 & { [K in Exclude<keyof T1, keyof T2>]?: never });

export type EmailSendingResult = Simplify<
  DiscriminatedUnion<{ sent: false; reasonNotSent: string }, { sent: true; subject: string; messageId: string }>
>;

export async function sendEmail<P extends UnsubscribeLinkProps>(
  template: EmailTemplate<P>,
  props: P,
  to: string | string[],
  opts: { dryRun: boolean } = { dryRun: false }
): Promise<EmailSendingResult> {
  if (!isEmailAvailable()) {
    console.warn("Email is not available, skipping sending email");
    return { sent: false, reasonNotSent: "Email is not available" };
  }
  const env = getEmailEnvSettings();
  const resend = new Resend(env.EMAIL_RESEND_KEY);
  const isMarketingEmail = firstDefined(template.isMarketingEmail, false);
  const from = template.from || (isMarketingEmail ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);
  const replyTo = template.replyTo || (isMarketingEmail ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);

  const domain = getDomainFromEmail(from);
  const scheduledAt = template.scheduleAt ? template.scheduleAt(new Date()) : undefined;
  let subject = template.subject(props);
  if (opts?.dryRun) {
    subject = `[Test - for ${to}] ${subject}`;
    to = env.BCC_EMAIL;
  }
  console.log(
    `Sending email to ${to}, scheduled at ${
      scheduledAt || "NOW"
    }. From: ${from}, replyTo: ${replyTo}. Subject: ${subject}`
  );

  const ReactBody = template;

  const result = await resend.emails.send({
    from,
    replyTo,
    to,
    bcc: template.bcc || env.BCC_EMAIL,
    subject,
    react: <ReactBody {...props} />,
    text: template.plaintext ? template.plaintext(props) : await render(<ReactBody {...props} />, { plainText: true }),
    headers: {
      "Message-ID": `${newId()}@${domain}`,
    },
    scheduledAt: scheduledAt ? scheduledAt.toISOString() : undefined,
  });
  if (result.error) {
    throw new Error(`Error sending email: ${JSON.stringify(result.error)}`);
  }
  return {
    sent: true,
    subject,
    messageId: result.data?.id || "",
  };
}
