import { EmailTemplate } from "@jitsu-internal/webapps-shared";
import { Body, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";
import { CheckJobStatusButton, Footer, MetaList } from "./shared";
import { ConnectionStatusNotificationProps } from "../pages/api/admin/notifications";

dayjs.extend(utc);

export const ConnectionStatusFirstRunEmail: EmailTemplate<ConnectionStatusNotificationProps> = props => {
  let {
    name,
    workspaceName,
    entityType,
    entityName,
    entityFrom,
    entityTo,
    tableName,
    recurringAlertsPeriodHours,
    detailsUrl,
    unsubscribeLink,
  } = props;

  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }

  return (
    <Html>
      <Preview>
        🎉 Successful initial run of {entityType} job "{entityName}" in the {workspaceName}
      </Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", color: "#333" }}>
              🎉️ The initial job of the connection <b>{entityName}</b> has been <b>SUCCESSFUL</b>
              <br />
            </Text>
          </Section>
          <Text>Hi {name || "there"}!</Text>

          <Text>
            Congratulations! The initial job of the connection from <b>{entityFrom}</b> to <b>{entityTo}</b> in the{" "}
            <b>{workspaceName}</b> has been <b>SUCCESSFUL</b>
          </Text>

          <MetaList tableName={tableName} />

          <CheckJobStatusButton url={detailsUrl} color={"#65a30d"} label={"See Job Status"} />

          {recurringAlertsPeriodHours && (
            <Text>No additional reports will be sent for this connection unless the status changes.</Text>
          )}

          <Footer unsubscribeLink={unsubscribeLink} />
        </Container>
      </Body>
    </Html>
  );
};

ConnectionStatusFirstRunEmail.subject = ({ workspaceName, entityType, entityName }) => {
  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  return `[${workspaceName || "Your Jitsu Workspace"}] 🎉 Successful initial run of ${entityType} job: ${entityName}`;
};

ConnectionStatusFirstRunEmail.from = "Jitsu Support <support@use.jitsu.com>";
ConnectionStatusFirstRunEmail.replyTo = "Jitsu Support <support@jitsu.com>";
ConnectionStatusFirstRunEmail.isMarketingEmail = false;

ConnectionStatusFirstRunEmail.PreviewProps = {
  status: "FIRST_RUN",
  timestamp: "2025-03-31T12:06:43.161Z",
  name: "John",
  entityId: "entity-id",
  entityType: "batch",
  entityName: "Entrypoint to Redshift",
  entityFrom: "Entrypoint",
  entityTo: "Redshift",
  tableName: "events",
  queueSize: 120,
  incidentStatus: "",
  incidentDetails: "",
  incidentStartedAt: "",
  workspaceSlug: "workspace-slug",
  workspaceName: "Integration Tests",
  recurringAlertsPeriodHours: 24,
  recurring: false,
  flappingWindowHours: 2,
  changesPerHours: 0,
  flappingSince: "",
  streamsFailed: "",
  detailsUrl: "http://localhost:3000/data",
  baseUrl: "http://localhost:3000",
  unsubscribeLink: "https://example.com/unsubscribe",
};

export default ConnectionStatusFirstRunEmail;
