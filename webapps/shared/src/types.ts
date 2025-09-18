import React from "react";

export type UnsubscribeLinkProps = { unsubscribeLink?: string };

export type WorkspaceEmailProps = {
  // User's name
  name?: string;
  workspaceName: string;
  workspaceSlug: string;
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
