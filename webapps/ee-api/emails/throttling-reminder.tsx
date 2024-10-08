import { EmailComponent, UnsubscribeLink, UnsubscribeLinkProps, withDefaults } from "../components/email-component";
import { Body, Button, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";

dayjs.extend(utc);

export type ThrottledReminderEmailProps = {
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  throttled?: number;
} & UnsubscribeLinkProps;

const ThrottledReminderEmail: EmailComponent<ThrottledReminderEmailProps> = ({
  name,
  workspaceName,
  workspaceSlug,
  throttled,
  unsubscribeLink,
}: ThrottledReminderEmailProps) => (
  <Html>
    <Preview>[Action Required] Your Jitsu Events are Being Throttled</Preview>
    <Body style={main}>
      <Container>
        <Section style={{ textAlign: "center", margin: "20px 0" }}>
          <Text style={{ fontSize: "20px", fontWeight: "bold", color: "#333" }}>
            🚨 Your Jitsu Events are Being Throttled to <b style={{ color: "red" }}>{throttled}%</b>!
          </Text>
        </Section>

        <Text>👋 Hi {name || "there"}!</Text>

        <Text>
          We wanted to remind you that due to excessive event usage in the past, your event throughput in the{" "}
          <a style={{ fontWeight: "bold", color: "#0070f3" }} href={`https://use.jitsu.com/${workspaceSlug}`}>
            Jitsu Workspace
          </a>{" "}
          is currently being throttled to <b>{throttled}%</b>. This means that <b>{throttled}%</b> of incoming events
          are currently being dropped.
        </Text>

        <Text>
          If you{"'"}d like to restore full event flow and prevent data loss, we highly recommend upgrading your plan.
        </Text>

        <Section>
          <Text style={{ fontWeight: "bold", color: "#333" }}>
            Upgrade now to restore your full event flow and ensure uninterrupted service.
          </Text>
        </Section>

        <Section style={{ textAlign: "center" }}>
          <Button
            href={`https://use.jitsu.com/${workspaceSlug}/settings/billing`}
            style={{
              backgroundColor: "#0070f3",
              color: "#fff",
              padding: "12px 20px",
              borderRadius: "5px",
              textDecoration: "none",
              fontSize: "16px",
              fontWeight: "bold",
            }}
          >
            Upgrade Now
          </Button>
        </Section>

        <Text style={{ marginTop: "20px" }}>
          Thank you for your continued use of Jitsu! We{"'"}re here to help you manage your data effectively.
        </Text>
        <Text>
          Best Regards,
          <br />
          Jitsu Team
          <br />
          <a href="https://jitsu.com" style={{ color: "#0070f3" }}>
            jitsu.com
          </a>
        </Text>
        {unsubscribeLink && <UnsubscribeLink unsubscribeLink={unsubscribeLink} />}
      </Container>
    </Body>
  </Html>
);

ThrottledReminderEmail.defaultValues = {
  name: "John",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  throttled: 50,
  unsubscribeLink: "https://example.com/unsubscribe",
};

ThrottledReminderEmail.from = "Jitsu Support <support@notify.jitsu.com>";
ThrottledReminderEmail.replyTo = "Jitsu Support <support@jitsu.com>";

// This is a transactional email
ThrottledReminderEmail.allowUnsubscribe = false;
ThrottledReminderEmail.respectUnsubscribed = false;

ThrottledReminderEmail.subject = ({ throttled }) =>
  `🚨[Action Required] Your Jitsu Events are Being Throttled to ${throttled}%`;

ThrottledReminderEmail.plaintext = ({
  name,
  workspaceName,
  workspaceSlug,
  throttled,
  unsubscribeLink,
}: ThrottledReminderEmailProps) => {
  return `👋 Hi ${name || "there"}!

Due to excessive usage in the past, your event throughput in the ${workspaceName} Workspace is currently throttled to ${throttled}%. This means ${
    100 - (throttled || 0)
  }% of events are being dropped.

To restore full event flow, please consider upgrading your plan.

You can update your billing here: https://use.jitsu.com/${workspaceSlug}/settings/billing.

Thanks,  
Jitsu Team

${unsubscribeLink ? `If you’d like to unsubscribe, click here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(ThrottledReminderEmail);
