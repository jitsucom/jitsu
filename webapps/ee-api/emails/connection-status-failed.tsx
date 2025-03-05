import { EmailComponent, UnsubscribeLink, UnsubscribeLinkProps, withDefaults } from "../components/email-component";
import { Body, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";

dayjs.extend(utc);

export type ConnectionStatusFailedEmailProps = {
  name?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  entityId: string;
  entityType: "batch" | "sync";
  entityName: string;
  tableName?: string;
  lastStatus: string;
  details: string;
  recurringAlertsPeriodHours: number;
} & UnsubscribeLinkProps;

const ConnectionStatusFailedEmail: EmailComponent<ConnectionStatusFailedEmailProps> = ({
  name,
  workspaceName,
  workspaceSlug,
  entityType,
  entityId,
  entityName,
  tableName,
  lastStatus,
  details,
  unsubscribeLink,
  recurringAlertsPeriodHours,
}: ConnectionStatusFailedEmailProps) => {
  const url =
    entityType == "sync"
      ? `https://use.jitsu.com/${workspaceSlug}/syncs/tasks?query={syncId:'${entityId}'}`
      : `https://use.jitsu.com/${workspaceSlug}/data?query={activeView%3A'bulker'%2CviewState%3A{bulker%3A{actorId%3A'${entityId}'}}}`;

  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }

  return (
    <Html>
      <Preview>[Jitsu Support] 🚨 Connection errors in {workspaceName || "Your Jitsu Workspace"}</Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", fontWeight: "bold", color: "#333" }}>
              🚨 The last job of the connection{" "}
              <a style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }} href={url}>
                {entityName}
              </a>{" "}
              has <b>FAILED</b>
            </Text>
          </Section>
          <Text>👋 Hi {name || "there"}!</Text>

          <Text>
            The last job of the connection{" "}
            <a style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }} href={url}>
              {entityName}
            </a>{" "}
            has <b>FAILED</b>{" "}
            {workspaceName ? (
              <>
                in the{" "}
                <a
                  style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }}
                  href={`https://use.jitsu.com/${workspaceSlug}`}
                >
                  {workspaceName}
                </a>
              </>
            ) : (
              <></>
            )}
            .
          </Text>
          <Text>
            <span>
              <b>Last Status: </b> {lastStatus}
            </span>
            <br />
            {tableName && (
              <span>
                <b>Table Name: </b> {tableName}
              </span>
            )}
            <br />
            <b>Details: </b>
            <br />
            <span dangerouslySetInnerHTML={{ __html: details }}></span>
          </Text>

          <Text>
            <a style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }} href={url}>
              Check logs
            </a>
          </Text>

          {recurringAlertsPeriodHours && (
            <Text>
              No additional reports will be sent for this connection in {recurringAlertsPeriodHours} hours unless the
              status changes.
            </Text>
          )}

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
};

ConnectionStatusFailedEmail.defaultValues = {
  name: "John",
  entityId: "entity-id",
  entityType: "batch",
  entityName: "Entity Name",
  tableName: "",
  details: "",
  lastStatus: "FAILED",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  recurringAlertsPeriodHours: 24,
  unsubscribeLink: "https://example.com/unsubscribe",
};

ConnectionStatusFailedEmail.from = "Jitsu Support <support@notify.jitsu.com>";
ConnectionStatusFailedEmail.replyTo = "Jitsu Support <support@jitsu.com>";

// This is a transactional email
ConnectionStatusFailedEmail.allowUnsubscribe = false;
ConnectionStatusFailedEmail.respectUnsubscribed = false;

ConnectionStatusFailedEmail.subject = ({ workspaceName }) => {
  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  return `[Jitsu Support] 🚨 Connection errors in ${workspaceName || "Your Jitsu Workspace"}`;
};

ConnectionStatusFailedEmail.plaintext = ({
  name,
  workspaceName,
  workspaceSlug,
  entityId,
  entityName,
  tableName,
  details,
  entityType,
  recurringAlertsPeriodHours,
  lastStatus,
  unsubscribeLink,
}: ConnectionStatusFailedEmailProps) => {
  const url =
    entityType == "sync"
      ? `https://use.jitsu.com/${workspaceSlug}/syncs/tasks?query={syncId:'${entityId}'}`
      : `https://use.jitsu.com/${workspaceSlug}/data?query={activeView%3A'bulker'%2CviewState%3A{bulker%3A{actorId%3A'${entityId}'}}}`;

  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }

  return `👋 Hi ${name || "there"}!

🚨 The last job of the connection ${entityName} has FAILED in ${workspaceName || "Your Jitsu Workspace"}

Last status: ${lastStatus}
${tableName ? "Table Name: " + tableName : ""}
${details ? "Details:\n" + details : ""}

Check logs: ${url}

${
  recurringAlertsPeriodHours
    ? `No additional reports will be sent for this connection in ${recurringAlertsPeriodHours} hours unless the status changes.`
    : ""
}

Thanks,  
Jitsu Team

${unsubscribeLink ? `If you’d like to unsubscribe, click here: ${unsubscribeLink}` : ""}
`;
};

export default withDefaults(ConnectionStatusFailedEmail);
