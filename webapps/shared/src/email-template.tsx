import React from "react";
import { Hr, Text } from "@react-email/components";

export type UnsubscribeLinkProps = { unsubscribeLink?: string };

export type WorkspaceEmailProps = {
  // User's name
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
};

export type EmailTemplateConfig<P extends UnsubscribeLinkProps> = {
  from?: string;
  bcc?: string;
  replyTo?: string;
  isMarketingEmail?: boolean;
  scheduleAt?: (now: Date) => Date | undefined;
};

export interface EmailTemplate<P extends UnsubscribeLinkProps> extends EmailTemplateConfig<P> {
  (props: P): React.ReactNode;
  // previewValues is used just to fill template with something to properly preview it in UI
  PreviewProps?: Required<P>;
  subject(props: P): string;
  plaintext?(props: P): string;
}

export const UnsubscribeLink: React.FC<{ unsubscribeLink?: string }> = ({ unsubscribeLink }) => {
  if (!unsubscribeLink) {
    return <></>;
  }
  return (
    <>
      <Hr />
      <Text style={{ textAlign: "center", fontSize: "0.6rem", color: "#999999" }}>
        Jitsu Labs Inc. 2261 Market Street #4109, San Francisco, CA 94114
        <br />
        <a href={unsubscribeLink} style={{ textDecoration: "underline", fontSize: "0.6rem", color: "#999999" }}>
          Unsubscribe
        </a>
      </Text>
    </>
  );
};
