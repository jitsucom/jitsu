import { EmailComponent, UnsubscribeLink, UnsubscribeLinkProps, withDefaults } from "../components/email-component";
import { Body, Head, Heading, Html, Preview, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import Link from "next/link";
import { main } from "./styles";

dayjs.extend(utc);

export type ChurnedEmailProps = {
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
} & UnsubscribeLinkProps;

const ChurnedCustomerEmail: EmailComponent<ChurnedEmailProps> = ({
  name,
  workspaceName,
  workspaceSlug,
  unsubscribeLink,
}: ChurnedEmailProps) => (
  <Html>
    <Preview>We’d love to hear your feedback and invite you back to Jitsu</Preview>
    <Body style={main}>
      <Text style={{}}>👋 Hi {name || "there"}!</Text>
      <Text>
        I{"'"}m Vladimir, the CEO of <Link href="https://go.jitsu.com">Jitsu</Link>! I noticed you recently canceled you
        Jitsu Cloud subscription. Your workspace,{" "}
        <a style={{ fontWeight: "bold" }} href={`https://use.jitsu.com/${workspaceSlug}`}>
          {workspaceName}
        </a>
        , is still there, and I’d love to know if there’s anything I could do to make Jitsu work better for you. If
        something didn{"'"}t click, or you ran into issues, please let me know. Your feedback really helps us shape a
        better platform.
      </Text>
      <Text>
        If you ever want to come back, it’s super easy to manage your subscription. Just follow{" "}
        <a style={{ fontWeight: "bold" }} href={`https://use.jitsu.com/${workspaceSlug}/settings/billing`}>
          this link to resubscribe back
        </a>
      </Text>
      <Text>P. S: Yes, this is an automated email, but I{"'"}m a real person and will respond.</Text>
      {unsubscribeLink && <UnsubscribeLink unsubscribeLink={unsubscribeLink} />}
    </Body>
  </Html>
);
ChurnedCustomerEmail.defaultValues = {
  name: "John",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  unsubscribeLink: "https://example.com/unsubscribe",
};

ChurnedCustomerEmail.from = "Vladimir from Jitsu <vladimir@notify.jitsu.com>";
ChurnedCustomerEmail.replyTo = "Vladimir Klimontovich <vladimir@jitsu.com>";
ChurnedCustomerEmail.allowUnsubscribe = true;
ChurnedCustomerEmail.respectUnsubscribed = true;

ChurnedCustomerEmail.subject = "Let’s Make Jitsu Better for You – We’d Love to Have You Back!";

ChurnedCustomerEmail.plaintext = ({ name, workspaceName, workspaceSlug, unsubscribeLink }: ChurnedEmailProps) => {
  return `👋 Hi ${name || "there"}!

I noticed you recently unsubscribed from Jitsu. Your workspace, ${workspaceName}, is still there, and 
I’d love to know if there’s anything I could do to make Jitsu work better for you.

If something didn’t click, or you ran into issues, please let me know. Your feedback really helps us 
shape a better platform.

If you ever want to come back, it’s super easy to manage your subscription. Just follow this link to 
resubscribe: https://use.jitsu.com/${workspaceSlug}/settings/billing.

P.S: Yes, this is an automated email, but I'm a real person and will respond.

${unsubscribeLink ? `If you’d like to unsubscribe, click here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(ChurnedCustomerEmail);
