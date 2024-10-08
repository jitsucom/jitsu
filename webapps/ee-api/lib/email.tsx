import { pg, store } from "./services";
import dayjs from "dayjs";
import { z } from "zod";
import utc from "dayjs/plugin/utc";
import { Resend } from "resend";
import { EmailComponent, UnsubscribeLinkProps } from "../components/email-component";
import WelcomeEmail from "../emails/welcome";
import { requireDefined } from "juava";
import Churned from "../emails/churned";
import ChurnedCustomerEmail from "../emails/churned";
import QuotaExceeded from "../emails/quota-exceeded";
import QuotaAboutToExceed from "../emails/quota-about-to-exceed";
import ThrottledReminderEmail from "../emails/throttling-reminder";

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
  variables: z.record(z.any()).optional(),
  //Two flags below, of not set, will be inferred from the EmailTemplale.isTransactional property
  allowUnsubscribe: z.boolean().optional(),
  respectUnsubscribe: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export type Payload = z.infer<typeof SendEmailRequest>;

export function getComponent(template: string): EmailComponent<UnsubscribeLinkProps> {
  switch (template) {
    case "welcome":
      return WelcomeEmail;
    case "churned":
      return ChurnedCustomerEmail;
    case "quota-exceeded":
      return QuotaExceeded;
    case "quota-about-to-exceed":
      return QuotaAboutToExceed;
    case "throttling-reminder":
      return ThrottledReminderEmail;
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

export async function getWorkspaceInfo(
  workspaceIdOrSlug: string | undefined
): Promise<{ workspaceId; workspaceSlug; workspaceName } | undefined> {
  const query = `select id as "workspaceId", slug as "workspaceSlug", name as "workspaceName" from newjitsu."Workspace" where id = $1 or slug = $1`;
  const result = await pg.query(query, [workspaceIdOrSlug]);
  return result.rows?.[0];
}

function firstDefined<T>(...args: (T | undefined)[]): T {
  return args.find(arg => arg !== undefined) as T;
}

export async function sendEmail(payload: Omit<Payload, "to"> & { to: string }) {
  let workspace;
  if (payload.workspaceId) {
    workspace = await getWorkspaceInfo(payload.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${payload.workspaceId}`);
    }
  }
  const env = getEmailEnvSettings();
  const resend = new Resend(env.EMAIL_RESEND_KEY);
  const Component: EmailComponent<UnsubscribeLinkProps> = getComponent(payload.template);
  const recepient = parseEmailAddress(payload.to).email.toLowerCase();
  const allowUnsubscribe = firstDefined(payload.allowUnsubscribe, Component.allowUnsubscribe, false);
  const respectUnsubscribe = firstDefined(payload.respectUnsubscribe, Component.respectUnsubscribed, true);
  const from =
    payload.from || Component.from || (allowUnsubscribe ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);
  const replyTo =
    payload.replyTo ||
    Component.replyTo ||
    (allowUnsubscribe ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);

  if (respectUnsubscribe && (await isUnsubscribed(recepient))) {
    console.log(`Not sending email to unsubscribed recipient: ${recepient}`);
    return { unsubscribed: true, recipient: recepient, message: "Recipient is unsubscribed" };
  }
  const domain = getDomainFromEmail(from);
  const unsubscribeCode = await getUnsubscribeCode(recepient, { rotateExpired: true });
  const props = {
    name: parseEmailAddress(payload.to).name?.split(" ")[0],
    ...(payload.variables || {}),
    ...(workspace || {}),
    unsubscribeLink: allowUnsubscribe
      ? `https://${domain}/api/unsubscribe?email=${encodeURIComponent(recepient)}&code=${unsubscribeCode}`
      : undefined,
  };
  const scheduledAt = Component.scheduleAt ? Component.scheduleAt(new Date()).toISOString() : undefined;
  let subject = typeof Component.subject === "string" ? Component.subject : Component.subject(props);
  let to = payload.to;
  if (payload.dryRun) {
    subject = `[Test - for ${to}] ${subject}`;
    to = env.BCC_EMAIL;
  }
  console.log(
    `Sending email to ${recepient}, scheduled at ${
      scheduledAt || "NOW"
    }. From: ${from}, replyTo: ${replyTo}. Subject: ${subject}`
  );
  const result = await resend.emails.send({
    from,
    replyTo,
    to,
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
