import { EmailComponent, UnsubscribeLink, UnsubscribeLinkProps, withDefaults } from "../components/email-component";
import { Body, Button, Container, Section, Text, Html, Preview } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";

dayjs.extend(utc);

export type QuotaExceededProps = {
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
} & UnsubscribeLinkProps;

const QuotaExceeded: EmailComponent<QuotaExceededProps> = ({
  name,
  workspaceName,
  workspaceSlug,
  unsubscribeLink,
}: QuotaExceededProps) => (
  <Html>
    <Preview>[Action Required] You{"'"}ve Reached Your Jitsu Event Quota</Preview>
    <Body style={main}>
      <Container>
        <Section style={{ textAlign: "center", margin: "20px 0" }}>
          <Text style={{ fontSize: "20px", fontWeight: "bold", color: "#333" }}>
            🚨Action Required: You{"'"}ve Hit Your Event Quota
          </Text>
        </Section>

        <Text>👋 Hi {name || "there"}!</Text>

        <Text>
          You’ve been making the most out of Jitsu, and we’re thrilled to see your progress! We wanted to let you know
          that you’ve{" "}
          <a
            style={{ fontWeight: "bold", color: "#0070f3" }}
            href={`https://use.jitsu.com/${workspaceSlug}/settings/billing`}
          >
            reached 100% of your free event quota
          </a>{" "}
          for this month in your Jitsu Workspace
        </Text>

        <Text>
          The free plan allows up to <b>200,000</b> events per month, and as of today, you{"'"}ve hit that limit. The
          quota will reset on the 1st day of the upcoming month. We will start dropping incoming events in{" "}
          <b>48 hours</b> if no upgrade is made.
        </Text>

        <Section>
          <Text style={{ fontWeight: "bold", color: "#333" }}>
            To keep the data flowing and avoid interruptions, consider upgrading to a paid plan.
          </Text>
        </Section>

        <Section style={{ textAlign: "center", marginTop: "30px" }}>
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
          Thank you for choosing Jitsu, and we’re here to support your continued success!
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

QuotaExceeded.defaultValues = {
  name: "John",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  unsubscribeLink: "https://example.com/unsubscribe",
};

QuotaExceeded.from = "Jitsu Support <support@notify.jitsu.com>";
QuotaExceeded.replyTo = "Jitsu Support <support@jitsu.com>";

// This is a transactional email
QuotaExceeded.allowUnsubscribe = false;
QuotaExceeded.respectUnsubscribed = false;

QuotaExceeded.subject = "[Action Required] You've Reached Your Jitsu Event Quota";

QuotaExceeded.plaintext = ({ name, workspaceName, workspaceSlug, unsubscribeLink }: QuotaExceededProps) => {
  return `👋 Hi ${name || "there"}!

You’ve reached 100% of your free event quota for this month in your ${workspaceName} Workspace. 
We will start dropping incoming events in 48 hours unless you upgrade now.

⚠️ Don’t wait until it’s too late—upgrade today to keep your data flowing smoothly!

You can update your billing here: https://use.jitsu.com/${workspaceSlug}/settings/billing.

Thanks,  
Jitsu Team

${unsubscribeLink ? `If you’d like to unsubscribe, click here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(QuotaExceeded);
