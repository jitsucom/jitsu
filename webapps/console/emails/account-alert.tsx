import { EmailTemplate } from "@jitsu-internal/webapps-shared";
import { Body, Container, Html, Preview, Section, Text } from "@react-email/components";

import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";
import { CheckJobStatusButton, Footer } from "./shared";

dayjs.extend(utc);

export type AccountAlertEventType =
  | "member-invited"
  | "member-joined"
  | "member-removed"
  | "member-role-changed"
  | "workspace-deleted";

export type AccountAlertEmailProps = {
  workspaceName: string;
  workspaceUrl: string;
  auditLogUrl: string;
  eventType: AccountAlertEventType;
  occurredAt: string;
  actorEmail?: string;
  actorName?: string;
  targetEmail?: string;
  prevRole?: string;
  newRole?: string;
  unsubscribeLink?: string;
};

const eventHeadline: Record<AccountAlertEventType, string> = {
  "member-invited": "A new member was invited",
  "member-joined": "A new member joined",
  "member-removed": "A member was removed",
  "member-role-changed": "A member role was changed",
  "workspace-deleted": "Workspace was deleted",
};

const eventEmoji: Record<AccountAlertEventType, string> = {
  "member-invited": "✉️",
  "member-joined": "👤",
  "member-removed": "👋",
  "member-role-changed": "🔑",
  "workspace-deleted": "🗑️",
};

function describe(props: AccountAlertEmailProps): string {
  const { eventType, actorName, actorEmail, targetEmail, prevRole, newRole, workspaceName } = props;
  const actor = actorName || actorEmail || "Someone";
  switch (eventType) {
    case "member-invited":
      return `${actor} invited ${targetEmail || "a new user"} to ${workspaceName}.`;
    case "member-joined":
      return `${targetEmail || actor} joined ${workspaceName}.`;
    case "member-removed":
      return `${actor} removed ${targetEmail || "a user"} from ${workspaceName}.`;
    case "member-role-changed":
      return `${actor} changed the role of ${targetEmail || "a user"} from ${prevRole || "?"} to ${
        newRole || "?"
      } in ${workspaceName}.`;
    case "workspace-deleted":
      return `${actor} deleted the workspace ${workspaceName}.`;
  }
}

export const AccountAlertEmail: EmailTemplate<AccountAlertEmailProps> = props => {
  const { eventType, occurredAt, auditLogUrl, workspaceName, unsubscribeLink } = props;
  const headline = eventHeadline[eventType];
  const emoji = eventEmoji[eventType];

  return (
    <Html>
      <Preview>
        {emoji} {headline} in {workspaceName}
      </Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", color: "#333" }}>
              {emoji} {headline}
            </Text>
          </Section>
          <Text>{describe(props)}</Text>
          <Text>
            <b>Time: </b> {dayjs(occurredAt).utc().format("YYYY-MM-DD HH:mm:ss")} UTC
          </Text>
          <CheckJobStatusButton url={auditLogUrl} label="View Audit Log" />
          <Text>
            If you do not recognize this activity, please review the workspace audit log and members list immediately.
          </Text>
          <Footer unsubscribeLink={unsubscribeLink} />
        </Container>
      </Body>
    </Html>
  );
};

AccountAlertEmail.subject = ({ workspaceName, eventType }) =>
  `[${workspaceName || "Your Jitsu Workspace"}] ${eventEmoji[eventType]} ${eventHeadline[eventType]}`;

AccountAlertEmail.isMarketingEmail = false;

AccountAlertEmail.PreviewProps = {
  workspaceName: "Acme Workspace",
  workspaceUrl: "http://localhost:3000/acme",
  auditLogUrl: "http://localhost:3000/acme/settings/audit-log",
  eventType: "member-role-changed",
  occurredAt: new Date().toISOString(),
  actorEmail: "owner@example.com",
  actorName: "Workspace Owner",
  targetEmail: "member@example.com",
  prevRole: "editor",
  newRole: "owner",
  unsubscribeLink: "https://example.com/unsubscribe",
};

export default AccountAlertEmail;
