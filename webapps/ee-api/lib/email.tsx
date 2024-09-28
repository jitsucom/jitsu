import { store } from "./services";
import dayjs from "dayjs";
import { z } from "zod";
import utc from "dayjs/plugin/utc";
import { Resend } from "resend";
import { EmailComponent, UnsubscribeLinkProps } from "../components/email-component";
import WelcomeEmail from "../emails/welcome";
import { requireDefined } from "juava";

dayjs.extend(utc);
export const UnsubscribeCodes = z.object({
  codes: z.array(
    z.object({
      code: z.string(),
      expirationTime: z.string(),
    })
  ),
});

export async function isUnsubscribed(email: string): Promise<boolean> {
  const key = `unsubscribed:${email}`;
  const record = await store.getTable("email-subscriptions").get(key);
  return !!record?.unsubscribed;
}

export async function unsubscribe(email: string) {
  const key = `unsubscribed:${email}`;
  await store.getTable("email-subscriptions").put(key, { unsubscribed: true });
}

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

export const SendEmailRequest = z.object({
  template: z.string(),
  from: z.string().optional(),
  replyTo: z.string().optional(),
  to: z.string().optional(),
  workspaceId: z.string().optional(),
  bcc: z.string().optional(),
  variables: z.record(z.string()).optional(),
  //Two flags below, of not set, will be inferred from the EmailTemplale.isTransactional property
  allowUnsubscribe: z.boolean().optional(),
  respectUnsubscribe: z.boolean().optional(),
});

export type Payload = z.infer<typeof SendEmailRequest>;

export function getComponent(template: string): EmailComponent<UnsubscribeLinkProps> {
  switch (template) {
    case "welcome":
      return WelcomeEmail;
    default:
      throw new Error(`Unknown email template: ${template}`);
  }
}

function getVal<P>(stringOrFactory: string | ((props: P) => string) | undefined, props: P): string | undefined {
  if (!stringOrFactory) {
    return undefined;
  }
  return typeof stringOrFactory === "string" ? stringOrFactory : stringOrFactory(props);
}

export function newId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function getUnsubscribeCode(
  email: string,
  { rotateExpired }: { rotateExpired?: boolean } = {}
): Promise<string | undefined> {
  const key = `codes:${email}`;
  const codes = UnsubscribeCodes.parse((await store.getTable("email-subscriptions").get(key)) || { codes: [] });
  //find the code with an expiration date in the future
  const cutoff = dayjs().utc().add(7, "day");
  const code = codes.codes.find(code => dayjs(code.expirationTime).isAfter(cutoff));
  if (code) {
    return code.code;
  } else if (rotateExpired) {
    const newCode = { code: newId(), expirationTime: dayjs().utc().add(14, "day") };
    const newCodes = { codes: [...codes.codes, newCode] };
    await store.getTable("email-subscriptions").put(key, newCodes);
    return newCode.code;
  } else {
    return undefined;
  }
}

function getDomainFromEmail(email: string): string {
  return parseEmailAddress(email).email.split("@")[1];
}

export async function sendEmail(payload: Omit<Payload, "to"> & { to: string }) {
  const env = getEmailEnvSettings();
  const resend = new Resend(env.EMAIL_RESEND_KEY);
  const Component: EmailComponent<UnsubscribeLinkProps> = getComponent(payload.template);
  const recepient = parseEmailAddress(payload.to).email.toLowerCase();
  const allowUnsubscribe =
    payload.allowUnsubscribe !== undefined ? payload.allowUnsubscribe : !Component.isTransactional;
  const respectUnsubscribe =
    payload.allowUnsubscribe !== undefined ? payload.allowUnsubscribe : !Component.isTransactional;
  const from =
    payload.from ||
    Component.from ||
    (!Component.isTransactional || allowUnsubscribe ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);
  const replyTo =
    payload.replyTo ||
    Component.replyTo ||
    (!Component.isTransactional || allowUnsubscribe ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);

  if (!Component.isTransactional && respectUnsubscribe && (await isUnsubscribed(recepient))) {
    console.log(`Not sending email to unsubscribed recipient: ${recepient}`);
    return { unsubscribed: true, recipient: recepient, message: "Recipient is unsubscribed" };
  }
  const domain = getDomainFromEmail(from);
  const unsubscribeCode = await getUnsubscribeCode(recepient, { rotateExpired: true });
  const props = {
    name: parseEmailAddress(payload.to).name?.split(" ")[0],
    ...(payload.variables || {}),
    unsubscribeLink: `https://${domain}/api/unsubscribe?email=${encodeURIComponent(recepient)}&code=${unsubscribeCode}`,
  };
  const scheduledAt = WelcomeEmail.scheduleAt ? WelcomeEmail.scheduleAt(new Date()).toISOString() : undefined;
  const subject = typeof Component.subject === "string" ? Component.subject : Component.subject(props);
  console.log(
    `Sending email to ${recepient}, scheduled at ${
      scheduledAt || "NOW"
    }. From: ${from}, replyTo: ${replyTo}. Subject: ${subject}`
  );
  const result = await resend.emails.send({
    from,
    replyTo,
    to: payload.to,
    bcc: payload.bcc || getVal(Component.bcc, props) || env.BCC_EMAIL,
    react: <Component {...props} />,
    text: Component.plaintext(props),
    headers: {
      "Message-ID": `${newId()}@${domain}`,
    },
    scheduledAt,
    subject,
  });
  if (result.error) {
    throw new Error(`Error sending email: ${JSON.stringify(result.error)}`);
  }
  return {
    unsubscribed: false,
    recipient: recepient,
    messageId: result.data?.id,
  };
}
