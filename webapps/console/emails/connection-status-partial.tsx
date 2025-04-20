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

export const ConnectionStatusPartialEmail: EmailTemplate<ConnectionStatusNotificationProps> = props => {
  let {
    name,
    workspaceName,
    entityType,
    entityName,
    entityFrom,
    entityTo,
    incidentDetails,
    incidentStatus,
    incidentStartedAt,
    streamsFailed,
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
        ⚠️ {capitalize(entityType)} job "{entityName}" has run with PARTIAL success in the {workspaceName}
      </Preview>
      <Body style={main}>
        <Container>
          <Section style={{ textAlign: "center", margin: "20px 0" }}>
            <Text style={{ fontSize: "20px", color: "#333" }}>
              ⚠️ {capitalize(entityType)} job of the connection <b>{entityName}</b> has run with <b>PARTIAL</b> success
            </Text>
          </Section>
          <Text>Hi {name || "there"}!</Text>
          <Text>
            The last job of the connection from <b>{entityFrom}</b> to <b>{entityTo}</b> has run with <b>PARTIAL</b>{" "}
            success in the <b>{workspaceName}</b>
          </Text>
          <MetaList
            streamsFailed={streamsFailed}
            incidentStatus={incidentStatus}
            incidentStartedAt={incidentStartedAt}
          />
          <CheckJobStatusButton url={detailsUrl} />
          <Details details={incidentDetails} />

          {recurringAlertsPeriodHours ? (
            <Text>
              No additional reports will be sent for this connection in {recurringAlertsPeriodHours} hours unless the
              status changes.
            </Text>
          ) : (
            <></>
          )}

          <Footer unsubscribeLink={unsubscribeLink} />
        </Container>
      </Body>
    </Html>
  );
};

ConnectionStatusPartialEmail.subject = ({ workspaceName, entityType, entityName }) => {
  if (!workspaceName?.toLowerCase().endsWith(" workspace")) {
    workspaceName += " workspace";
  }
  return `[${workspaceName || "Your Jitsu Workspace"}] ⚠️ ${capitalize(entityType)} had partial success: ${entityName}`;
};

ConnectionStatusPartialEmail.from = "Jitsu Support <support@use.jitsu.com>";
ConnectionStatusPartialEmail.replyTo = "Jitsu Support <support@jitsu.com>";
ConnectionStatusPartialEmail.isMarketingEmail = false;

ConnectionStatusPartialEmail.PreviewProps = {
  status: "FAILED",
  timestamp: "2025-03-31T12:06:43.161Z",
  name: "John",
  entityId: "entity-id",
  entityType: "sync",
  entityName: "Entrypoint to Redshift",
  entityFrom: "Entrypoint",
  entityTo: "Redshift",
  tableName: "",
  incidentDetails:
    "2025-03-31T12:06:43.161Z [FAILED] failed to setup s3 client:\nS3 bucket access error: operation error S3: HeadBucket, https response error StatusCode: 0, RequestID: , HostID: , canceled, context deadline exceeded",
  incidentStatus: "PARTIAL",
  incidentStartedAt: dayjs().subtract(5, "minute").toISOString(),
  queueSize: 0,
  workspaceSlug: "workspace-slug",
  workspaceName: "Integration Tests",
  recurringAlertsPeriodHours: 24,
  recurring: false,
  flappingWindowHours: 2,
  changesPerHours: 0,
  flappingSince: "",
  streamsFailed: "2 of 13",
  detailsUrl: "http://localhost:3000/data",
  baseUrl: "http://localhost:3000",
  unsubscribeLink: "https://example.com/unsubscribe",
};

export default ConnectionStatusPartialEmail;
