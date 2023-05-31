import nodemailer from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import { getErrorMessage } from "juava";
import { db } from "./db";

import { render } from "mjml-react";
import { getSingleton } from "juava";

async function init() {
  if (process.env.SMTP_CONNECTION_STRING) {
    try {
      return nodemailer.createTransport(process.env.SMTP_CONNECTION_STRING);
    } catch (e) {
      console.error(
        `Error initializing SMTP transport ${process.env.SMTP_CONNECTION_STRING}: ${getErrorMessage(e)}`,
        e
      );
      throw new Error(`Can't connect to SMTP server`);
    }
  } else {
    const testAccount = await nodemailer.createTestAccount();

    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: testAccount.user, // generated ethereal user
        pass: testAccount.pass, // generated ethereal password
      },
    });
  }
}

export function isMailAvailable() {
  return !!process.env.SMTP_CONNECTION_STRING;
}

export async function sendEmail(mailOptions: Mail.Options) {
  const transporter = await getSingleton("nodeMailer", init)();
  const logEntry = await db.prisma().emailLog.create({
    data: { status: "PENDING", email: JSON.parse(JSON.stringify(mailOptions)) },
  });
  try {
    const info = await transporter.sendMail(mailOptions);
    await db.prisma().emailLog.update({
      where: { id: logEntry.id },
      data: { status: "SENT", messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || null },
    });
  } catch (e: any) {
    const errorText = `${getErrorMessage(e)}\n${e?.stack}`;
    await db.prisma().emailLog.update({ where: { id: logEntry.id }, data: { status: "FAILED", error: errorText } });
    throw e;
  }
}

export function renderEmailTemplate(Component: React.FC<{ data: any }>, data: any) {
  return render(<Component data={data} />).html;
}
