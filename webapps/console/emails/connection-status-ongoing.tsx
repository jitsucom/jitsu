import { EmailTemplate } from "@jitsu-internal/webapps-shared";
import { Body, Container, Html, Preview, Section, Text } from "@react-email/components";
import React from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { main } from "./styles";
import { CheckJobStatusButton, Details, Footer, MetaList } from "./shared";
import capitalize from "lodash/capitalize";
import { ConnectionStatusNotificationProps } from "../pages/api/admin/notifications";

dayjs.extend(utc);

export const ConnectionStatusOngoingEmail: EmailTemplate<ConnectionStatusNotificationProps> = props => {
  let {
    name,
    workspaceName,
    entityType,
    entityName,
    entityFrom,
    entityTo,
    tableName,
    incidentDetails,
    incidentStatus,
    incidentStartedAt,
    queueSize,
    streamsFailed,
    recurringAlertsPeriodHours,
    detailsUrl,
    unsubscribeLink,
  } = props;

  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  const partial = incidentStatus === "PARTIAL" || incidentStatus === "TIME_EXCEEDED";

  return (
    <Html>
      <Preview>
        {partial ? "⚠️" : "🚨"} Ongoing {entityType} processing issues with "{entityName}" in the {workspaceName}
      </Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", color: "#333" }}>
              {partial ? "⚠️" : "🚨"} Ongoing {entityType} processing issues with the connection <b>{entityName}</b>
            </Text>
          </Section>
          <Text>Hi {name || "there"}!</Text>
          <Text>
            {capitalize(entityType)} processing issues persist with the connection from <b>{entityFrom}</b> to{" "}
            <b>{entityTo}</b> in the <b>{workspaceName}</b>
          </Text>
          <MetaList
            tableName={tableName}
            streamsFailed={streamsFailed}
            incidentStatus={incidentStatus}
            incidentStartedAt={incidentStartedAt}
            queueSize={queueSize}
          />
          <CheckJobStatusButton url={detailsUrl} />
          <Details details={incidentDetails} />

          {recurringAlertsPeriodHours && (
            <Text>
              No additional reports will be sent for this connection in {recurringAlertsPeriodHours} hours unless the
              status changes.
            </Text>
          )}
          <Footer unsubscribeLink={unsubscribeLink} />
        </Container>
      </Body>
    </Html>
  );
};

ConnectionStatusOngoingEmail.subject = ({ workspaceName, entityType, entityName, incidentStatus }) => {
  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  const partial = incidentStatus === "PARTIAL" || incidentStatus === "TIME_EXCEEDED";

  return `[${workspaceName || "Your Jitsu Workspace"}] ${
    partial ? "⚠️" : "🚨"
  } Ongoing ${entityType} processing issues: ${entityName}`;
};

ConnectionStatusOngoingEmail.from = "Jitsu Support <support@use.jitsu.com>";
ConnectionStatusOngoingEmail.replyTo = "Jitsu Support <support@jitsu.com>";
ConnectionStatusOngoingEmail.isMarketingEmail = false;

ConnectionStatusOngoingEmail.PreviewProps = {
  status: "ONGOING",
  timestamp: "2025-03-31T12:06:43.161Z",
  name: "John",
  entityId: "entity-id",
  entityType: "batch",
  entityName: "Entrypoint to Redshift",
  entityFrom: "Entrypoint",
  entityTo: "Redshift",
  tableName: "events",
  incidentDetails:
    "2025-03-31T12:06:43.161Z [FAILED] failed to setup s3 client: s3 bucket access error: operation error S3: HeadBucket, https response error StatusCode: 0, RequestID: , HostID: , canceled, context deadline exceeded",
  incidentStatus: "FAILED",
  incidentStartedAt: dayjs().subtract(2, "hour").toISOString(),
  queueSize: 132422,
  workspaceSlug: "workspace-slug",
  workspaceName: "Integration Tests",
  recurringAlertsPeriodHours: 24,
  recurring: true,
  flappingWindowHours: 2,
  changesPerHours: 0,
  flappingSince: "",
  streamsFailed: "",
  detailsUrl: "http://localhost:3000/data",
  baseUrl: "http://localhost:3000",
  unsubscribeLink: "https://example.com/unsubscribe",
};

export default ConnectionStatusOngoingEmail;
