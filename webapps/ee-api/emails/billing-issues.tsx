import { EmailComponent, UnsubscribeLink, UnsubscribeLinkProps, withDefaults } from "../components/email-component";
import { Body, Button, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";

dayjs.extend(utc);

export type BillingIssueEmailProps = {
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
} & UnsubscribeLinkProps;

const BillingIssueEmail: EmailComponent<BillingIssueEmailProps> = ({
  name,
  workspaceName,
  workspaceSlug,
  unsubscribeLink,
}: BillingIssueEmailProps) => (
  <Html>
    <Preview>🚨 Urgent: Last Payment Failed - Service Deactivation Approaching</Preview>
    <Body style={main}>
      <Container>
        <Section style={{ textAlign: "center", margin: "20px 0" }}>
          <Text style={{ fontSize: "20px", fontWeight: "bold", color: "#333" }}>
            🚨 Last Payment Attempt Unsuccessful - Service Deactivation Approaching!
          </Text>
        </Section>

        <Text>👋 Hi {name || "there"}!</Text>

        <Text>
          We wanted to notify you that the last payment attempt for your{" "}
          <a style={{ fontWeight: "bold", color: "#0070f3" }} href={`https://use.jitsu.com/${workspaceSlug}`}>
            {workspaceName || "Workspace"}
          </a>{" "}
          Jitsu Workspace was unsuccessful, and you have unpaid overdue invoices.
        </Text>

        <Text>
          While your data is still flowing for now, if payment is not recovered in the next few days, we will be forced
          to either deactivate your project or throttle incoming event processing.
        </Text>

        <Section>
          <Text style={{ fontWeight: "bold", color: "#333" }}>
            Please take immediate action to update your payment method and avoid service interruption.
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
            Update Payment Method Now
          </Button>
        </Section>

        <Text style={{ marginTop: "20px" }}>
          We highly recommend resolving this as soon as possible to prevent any service disruption. If you need
          assistance, we{"'"}re here to help. Just reply to this email, and we{"'"}ll get back to you right away.
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

BillingIssueEmail.defaultValues = {
  name: "John",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  unsubscribeLink: "https://example.com/unsubscribe",
};

BillingIssueEmail.from = "Jitsu Support <support@notify.jitsu.com>";
BillingIssueEmail.replyTo = "Jitsu Support <support@jitsu.com>";

// This is a transactional email
BillingIssueEmail.allowUnsubscribe = false;
BillingIssueEmail.respectUnsubscribed = false;

BillingIssueEmail.subject = () =>
  `🚨[Action Required] Last Payment Failed - Action Required to Avoid Jitsu Service Disruption`;

BillingIssueEmail.plaintext = ({ name, workspaceName, workspaceSlug, unsubscribeLink }: BillingIssueEmailProps) => {
  return `👋 Hi ${name || "there"}!

The last payment attempt for your ${workspaceName} Workspace was unsuccessful, and there are unpaid overdue invoices.

If payment is not recovered in the next few days, we will be forced to deactivate your project or throttle event flow.

Please update your payment method immediately: https://use.jitsu.com/${workspaceSlug}/settings/billing.

Thanks,  
Jitsu Team

${unsubscribeLink ? `If you’d like to unsubscribe, click here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(BillingIssueEmail);
