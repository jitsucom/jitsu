import { EmailComponent, UnsubscribeLink, UnsubscribeLinkProps, withDefaults } from "../components/email-component";
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import Link from "next/link";
import { main } from "./styles";

dayjs.extend(utc);

export type QuotaAboutToExceedProps = {
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
} & UnsubscribeLinkProps;

const QuotaAboutToExceed: EmailComponent<QuotaAboutToExceedProps> = ({
  name,
  workspaceName,
  workspaceSlug,
  unsubscribeLink,
}: QuotaAboutToExceedProps) => (
  <Html>
    <Preview>Action Required: Upgrade Now to Prevent Jitsu Service Interruption</Preview>
    <Body style={main}>
      <Container>
        <Text>👋 Hi {name || "there"}!</Text>

        <Text>
          We{"'"}re delighted to see your recent growth and increased volume of events sent to Jitsu in{" "}
          <b>
            <a href={`https://use.jitsu.com/${workspaceSlug}`}>{workspaceName}</a>
          </b>{" "}
          workspace! However, at this pace, you{"'"}re projected to exceed the free tier limit of <b>200,000</b> events
          per month. This means your data flow could be disrupted very soon.
        </Text>

        <Text>
          To avoid any disruption in your data flow, we highly recommend upgrading to the Paid Version as soon as
          possible. If you remain on the free plan and exceed the quota, we may have to start dropping excess events.
        </Text>

        <Section style={{ textAlign: "center", marginTop: "20px" }}>
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
            Update Billing & Avoid Disruption
          </Button>
        </Section>

        <Text style={{ marginTop: "20px" }}>
          You can also check your detailed event usage on our{" "}
          <a
            style={{ fontWeight: "bold", color: "#0070f3" }}
            href={`https://use.jitsu.com/${workspaceSlug}/settings/billing/details`}
          >
            Billing Details Page
          </a>
          .
        </Text>

        <Text>Thank you for choosing Jitsu, and we look forward to supporting your continued growth!</Text>

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

QuotaAboutToExceed.defaultValues = {
  name: "John",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  unsubscribeLink: "https://example.com/unsubscribe",
};

QuotaAboutToExceed.from = "Jitsu Support <support@notify.jitsu.com>";
QuotaAboutToExceed.replyTo = "Jitsu Support <support@jitsu.com>";

// This is a transactional email
QuotaAboutToExceed.allowUnsubscribe = false;
QuotaAboutToExceed.respectUnsubscribed = false;

QuotaAboutToExceed.subject = "🚨[Action Required] Upgrade Now to Prevent Jitsu Service Interruption";

QuotaAboutToExceed.plaintext = ({ name, workspaceName, workspaceSlug, unsubscribeLink }: QuotaAboutToExceedProps) => {
  return `👋 Hi ${name || "there"}!

We're delighted to see your recent growth and increased volume of events sent to Jitsu! However, we noticed that 
at this pace, you're projected to exceed the free tier limit of 200,000 events per month.

To avoid any disruption in your data flow, we highly recommend upgrading to the Paid Version. If you remain on the free 
plan and exceed the quota, we may have to start dropping excess events.

⚠️ Don’t wait until it’s too late—upgrade today to keep your data flowing smoothly!

You can update your billing here: https://use.jitsu.com/${workspaceSlug}/settings/billing.

Thank you for choosing Jitsu, and we look forward to supporting your continued growth!

Best regards,  
Jitsu Team

${unsubscribeLink ? `If you’d like to unsubscribe, click here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(QuotaAboutToExceed);
