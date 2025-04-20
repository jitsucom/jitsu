import { EmailTemplate } from "@jitsu-internal/webapps-shared";
import { Body, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";
import capitalize from "lodash/capitalize";
import { CheckJobStatusButton, Footer, MetaList } from "./shared";
import { ConnectionStatusNotificationProps } from "../pages/api/admin/notifications";

dayjs.extend(utc);

export const ConnectionStatusRecoveredEmail: EmailTemplate<ConnectionStatusNotificationProps> = props => {
  let {
    name,
    workspaceName,
    entityType,
    entityName,
    entityFrom,
    entityTo,
    tableName,
    incidentStatus,
    incidentStartedAt,
    queueSize,
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
        ✅ {capitalize(entityType)} job "{entityName}" processing restored in the {workspaceName}
      </Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", color: "#333" }}>
              ✅ {capitalize(entityType)} job processing of the connection <b>{entityName}</b> has been <b>RESTORED</b>
            </Text>
          </Section>
          <Text>Hi {name || "there"}!</Text>

          <Text>
            The last job of the connection from <b>{entityFrom}</b> to <b>{entityTo}</b> has been <b>SUCCESSFUL</b> in
            the <b>{workspaceName}</b>
          </Text>

          <MetaList
            tableName={tableName}
            recoveredFrom={incidentStatus}
            incidentStartedAt={incidentStartedAt}
            queueSize={queueSize}
          />
          <CheckJobStatusButton url={detailsUrl} color={"#65a30d"} />

          {recurringAlertsPeriodHours && (
            <Text>No additional reports will be sent for this connection unless the status changes.</Text>
          )}

          <Footer unsubscribeLink={unsubscribeLink} />
        </Container>
      </Body>
    </Html>
  );
};

ConnectionStatusRecoveredEmail.subject = ({ workspaceName, entityType, entityName }) => {
  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  return `[${workspaceName || "Your Jitsu Workspace"}] ✅ ${capitalize(
    entityType
  )} job processing restored: ${entityName}`;
};

ConnectionStatusRecoveredEmail.from = "Jitsu Support <support@use.jitsu.com>";
ConnectionStatusRecoveredEmail.replyTo = "Jitsu Support <support@jitsu.com>";
ConnectionStatusRecoveredEmail.isMarketingEmail = false;

ConnectionStatusRecoveredEmail.PreviewProps = {
  status: "RECOVERED",
  timestamp: "2025-03-31T12:06:43.161Z",
  name: "John",
  entityId: "entity-id",
  entityType: "batch",
  entityName: "Entrypoint to Redshift",
  entityFrom: "Entrypoint",
  entityTo: "Redshift",
  tableName: "events",
  queueSize: 6120,
  incidentDetails:
    "2025-03-31T12:06:43.161Z [FAILED] failed to setup s3 client: s3 bucket access error: operation error S3: HeadBucket, https response error StatusCode: 0, RequestID: , HostID: , canceled, context deadline exceeded",
  incidentStatus: "FAILED",
  incidentStartedAt: dayjs().subtract(5, "day").toISOString(),
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

export default ConnectionStatusRecoveredEmail;
