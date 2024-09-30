import { EmailComponent, UnsubscribeLink, withDefaults } from "../components/email-component";
import { Body, Head, Html, Preview, Text } from "@react-email/components";
import React from "react";
import Link from "next/link";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";

dayjs.extend(utc);

export type WelcomeEmailProps = {
  name?: string;
  unsubscribeLink?: string;
};

function nextBusinessDay(now: Date): Date {
  let day = dayjs(now).utc().add(1, "day");
  while (day.day() === 0 || day.day() === 6) {
    // 0 = Sunday, 6 = Saturday
    day = day.add(1, "day");
  }
  day = day.hour(12).minute(23).second(0).millisecond(0);

  return day.toDate();
}

const WelcomeEmail: EmailComponent<WelcomeEmailProps> = ({ name, unsubscribeLink }) => {
  return (
    <Html>
      <Head />
      <Preview>Thank you for trying out Jitsu!</Preview>
      <Body style={main}>
        <Text style={{}}>👋 Hi {name || "there"}!</Text>
        <Text>
          I{"'"}m Vladimir, the CEO of <Link href="https://go.jitsu.com">Jitsu</Link>! Thank you for creating account
          with <a href="https://go.jitsu.com/cloud">Jitsu Cloud</a>, and I wanted to say thank you for giving it a try!
          👍
        </Text>
        <Text>In order to help you discover Jitsu, I have prepared a list of useful resources for you:</Text>
        <Text style={{ paddingLeft: "2rem" }}>
          ✅ Learn how to{" "}
          <Link href="https://go.jitsu.com/em-wlc-clickstream">send clickstream event data to Jitsu</Link>.
          <br />✅ Find out how to{" "}
          <Link href="https://go.jitsu.com/em-wlc-func">transform events with Jitsu Functions</Link>.
          <br />✅ Explore our various <Link href="https://go.jitsu.com/em-wlc-dest">Jitsu Destinations</Link>.
        </Text>
        <Text>
          If you{"'"}re curious about any other features or capabilities of the Jitsu platform, feel free to browse our{" "}
          <Link href="https://go.jitsu.com/em-wlc-docs">documentation website</Link>.
        </Text>
        <Text>
          If you need any other assistance with configuring Jitsu, please let us know! We{"'"}re here to help.
          Additionally, if you anticipate sending more than <b>10 million</b> events per month, we can discuss volume
          discounts. Just reply to this email, and I{"'"}ll get back to you as soon as possible.
        </Text>
        <Text>P. S: Yes, this is an automated email, but I{"'"}m a real person and will respond.</Text>
        {unsubscribeLink && <UnsubscribeLink unsubscribeLink={unsubscribeLink} />}
      </Body>
    </Html>
  );
};

WelcomeEmail.defaultValues = {
  name: "John",
  unsubscribeLink: "https://example.com/unsubscribe",
};

WelcomeEmail.from = "Vladimir from Jitsu <vladimir@notify.jitsu.com>";
WelcomeEmail.replyTo = "Vladimir Klimontovich <vladimir@jitsu.com>";
WelcomeEmail.isTransactional = true;

WelcomeEmail.subject = "Need any help with Jitsu? Let us know!";

WelcomeEmail.scheduleAt = nextBusinessDay;

WelcomeEmail.plaintext = ({ name, unsubscribeLink }) => {
  return `
👋 Hi ${name || "there"}!

I'm Vladimir, the CEO of Jitsu! Thank you for creating an account with us, and I wanted to say
thank you for giving it a try! 👍

In order to help you discover Jitsu, I have prepared a list of useful resources for you:

  ✅ Learn how to send clickstream event data to Jitsu: https://go.jitsu.com/em-wlc-clickstream
  ✅ Find out how to transform events with Jitsu Functions: https://go.jitsu.com/em-wlc-func
  ✅ Explore our various Jitsu Destinations: https://go.jitsu.com/em-wlc-dest

If you're curious about any other features or capabilities of the Jitsu platform, feel free to
browse our documentation website: https://go.jitsu.com/em-wlc-docs

If you need any other assistance with configuring Jitsu, please let us know! We're here to help.
Additionally, if you anticipate sending more than 10 million events per month, we can discuss
volume discounts. Just reply to this email, and I'll get back to you as soon as possible.

P.S: Yes, this is an automated email, but I'm a real person and will respond.

Best,
- Vladimir

${unsubscribeLink ? `Unsubscribe here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(WelcomeEmail);
