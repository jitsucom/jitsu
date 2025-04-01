import { EmailTemplate, UnsubscribeLink } from "@jitsu-internal/webapps-shared";
import { Body, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";
import { ConnectionStatusSharedEmailProps } from "./connection-status-failed";

dayjs.extend(utc);

export const ConnectionStatusRecoveredEmail: EmailTemplate<ConnectionStatusSharedEmailProps> = props => {
  let {
    name,
    workspaceName,
    workspaceSlug,
    entityId,
    entityType,
    entityName,
    tableName,
    details,
    recurringAlertsPeriodHours,
    unsubscribeLink,
  } = props;

  const url =
    entityType == "sync"
      ? `https://use.jitsu.com/${workspaceSlug}/syncs/tasks?query={syncId:'${entityId}'}`
      : `https://use.jitsu.com/${workspaceSlug}/data?query={activeView%3A'bulker'%2CviewState%3A{bulker%3A{actorId%3A'${entityId}'}}}`;

  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }

  return (
    <Html>
      <Preview>[Jitsu Support] ✅️ Connection success in {workspaceName || "Your Jitsu Workspace"}</Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", fontWeight: "bold", color: "#333" }}>
              ✅️️The last job of the connection{" "}
              <a style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }} href={url}>
                {entityName}
              </a>{" "}
              has been <b>SUCCESSFUL</b>
              <br />
            </Text>
          </Section>
          <Text>👋 Hi {name || "there"}!</Text>

          <Text>
            The last job of the connection{" "}
            <a style={{ fontWeight: "bold", color: "#0070f3", textDecoration: "none" }} href={url}>
              {entityName}
            </a>{" "}
            has been <b>SUCCESSFUL</b>.{" "}
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

          {recurringAlertsPeriodHours && (
            <Text>No additional reports will be sent for this connection unless the status changes.</Text>
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

ConnectionStatusRecoveredEmail.subject = ({ workspaceName }) => {
  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  return `[Jitsu Support] ✅️️ Connection success in ${workspaceName || "Your Jitsu Workspace"}`;
};

ConnectionStatusRecoveredEmail.from = "Jitsu Support <support@notify.jitsu.com>";
ConnectionStatusRecoveredEmail.replyTo = "Jitsu Support <support@jitsu.com>";
ConnectionStatusRecoveredEmail.isMarketingEmail = true;

ConnectionStatusRecoveredEmail.PreviewProps = {
  name: "John",
  entityId: "entity-id",
  entityType: "batch",
  entityName: "Entity Name",
  tableName: "",
  details: "",
  lastStatus: "SUCCESS",
  workspaceSlug: "workspace-slug",
  workspaceName: "Workspace Name",
  recurringAlertsPeriodHours: 24,
  unsubscribeLink: "https://example.com/unsubscribe",
};

export default ConnectionStatusRecoveredEmail;
