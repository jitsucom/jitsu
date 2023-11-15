import nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import { getErrorMessage } from "juava";
import { db } from "./db";

import { render } from "mjml-react";
import { randomUUID } from "crypto";

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

    // const testAccount = await nodemailer.createTestAccount();
    //
    // return nodemailer.createTransport({
    //   host: "smtp.ethereal.email",
    //   port: 587,
    //   secure: false, // true for 465, false for other ports
    //   auth: {
    //     user: testAccount.user, // generated ethereal user
    //     pass: testAccount.pass, // generated ethereal password
    //   },
    // });
  }
}

const transport = initNodeMailer();

export function isMailAvailable() {
  return !!process.env.SMTP_CONNECTION_STRING;
}

export async function sendEmail(mailOptions: Mail.Options) {
  if (!mailOptions.from) {
    mailOptions.from = {
      name: "Jitsu Team",
      address: "support@jitsu.com",
    };
  }
  const logEntry = await db.prisma().emailLog.create({
    data: { id: randomUUID(), status: "PENDING", email: JSON.parse(JSON.stringify(mailOptions)) },
  });
  if (!transport) {
    await db
      .prisma()
      .emailLog.update({ where: { id: logEntry.id }, data: { status: "SKIPPED", error: "SMTP is not configured" } });
    return;
  }
  try {
    const info = await transport.sendMail(mailOptions);
    await db.prisma().emailLog.update({
      where: { id: logEntry.id },
      data: { status: "SENT", messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null },
    });
  } catch (e: any) {
    const errorText = `${getErrorMessage(e)}\n${e?.stack}`;
    await db.prisma().emailLog.update({ where: { id: logEntry.id }, data: { status: "FAILED", error: errorText } });
    throw new Error(`Error sending email to ${mailOptions.to}: ${errorText}`, e);
  }
}

export function renderEmailTemplate(Component: React.FC<{ data: any }>, data: any) {
  return render(<Component data={data} />).html;
}
