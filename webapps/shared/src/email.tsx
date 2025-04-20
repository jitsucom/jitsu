import dayjs from "dayjs";
import { z } from "zod";
import utc from "dayjs/plugin/utc";
import { render } from "@react-email/render";
import { EmailTemplate, UnsubscribeLinkProps } from "./types";
import { getErrorMessage } from "juava";
import { Simplify } from "type-fest";
import nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer";

dayjs.extend(utc);

const transport = initNodeMailer();

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
  EMAIL_MARKETING_DOMAIN: z.string(),
  EMAIL_TRANSACTIONAL_DOMAIN: z.string(),
  EMAIL_TRANSACTIONAL_SENDER: z.string(),
  EMAIL_TRANSACTIONAL_REPLY_TO: z.string(),
  EMAIL_MARKETING_SENDER: z.string(),
  EMAIL_MARKETING_REPLY_TO: z.string(),
  BCC_EMAIL: z.string().email().optional(),
});

export type EmailEnvSettings = z.infer<typeof EmailEnvSettings>;

export function getEmailEnvSettings(): EmailEnvSettings {
  return EmailEnvSettings.parse(process.env);
}

export function isEmailAvailable(): boolean {
  return !!transport;
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

  const isMarketingEmail = firstDefined(template.isMarketingEmail, false);
  const from = template.from || (isMarketingEmail ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);
  const replyTo = template.replyTo || (isMarketingEmail ? env.EMAIL_MARKETING_SENDER : env.EMAIL_TRANSACTIONAL_SENDER);

  const domain = getDomainFromEmail(from);

  // const scheduledAt = template.scheduleAt ? template.scheduleAt(new Date()) : undefined;

  let subject = template.subject(props);
  if (opts?.dryRun) {
    subject = `[Test - for ${to}] ${subject}`;
    to = env.BCC_EMAIL ?? "";
  }
  console.log(`Sending email to ${to} From: ${from}, replyTo: ${replyTo}. Subject: ${subject}`);

  const ReactBody = template;

  const html = await render(<ReactBody {...props} />);
  const text = template.plaintext
    ? template.plaintext(props)
    : await render(<ReactBody {...props} />, { plainText: true });

  const options: Mail.Options = {
    from,
    replyTo,
    to,
    bcc: template.bcc || env.BCC_EMAIL,
    subject,
    headers: {
      "Message-ID": `${newId()}@${domain}`,
    },
    html,
    text,
  };

  const res = await transport!.sendMail(options);

  return {
    sent: true,
    subject,
    messageId: res.messageId || "",
  };
}

function initNodeMailer() {
  if (process.env.SMTP_CONNECTION_STRING) {
    const { host, port, user, password } = parseConnectionString(process.env.SMTP_CONNECTION_STRING);

    try {
      const credentials = {
        host,
        port: parseInt(port),
        auth: {
          user,
          pass: password,
        },
        secure: parseInt(port) === 465,
        tls: {
          rejectUnauthorized: false,
        },
      };
      //console.log("SMTP credentials", credentials)
      return nodemailer.createTransport(credentials);
    } catch (e) {
      console.error(
        `Error initializing SMTP transport ${process.env.SMTP_CONNECTION_STRING}: ${getErrorMessage(e)}`,
        e
      );
      throw new Error(`Can't connect to SMTP server`);
    }
  } else {
    return undefined;
  }
}

function parseConnectionString(connectionString: string) {
  if (connectionString.startsWith("smtp://")) {
    connectionString = connectionString.substring("smtp://".length);
  }
  const atIndex = connectionString.lastIndexOf("@");
  if (atIndex < 0) {
    throw new Error(`Invalid SMTP connection string ${connectionString}`);
  }
  const auth = connectionString.substring(0, atIndex);
  const hostAndPort = connectionString.substring(atIndex + 1);
  const [host, port = "587"] = hostAndPort.split(":");
  const colonIndex = auth.lastIndexOf(":");
  const [user, password] =
    colonIndex < 0 ? [auth, ""] : [auth.substring(0, colonIndex), auth.substring(colonIndex + 1)];
  return { host, port, user, password };
}
