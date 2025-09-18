import React from "react";
import { Button, Container, Hr, Text } from "@react-email/components";
import dayjs from "dayjs";

type MetaListProps = {
  tableName?: string;
  streamsFailed?: string;
  incidentStartedAt?: string;
  incidentStatus?: string;
  recoveredFrom?: string;
  queueSize?: number;
};

export const MetaList: React.FC<MetaListProps> = ({
  tableName,
  incidentStartedAt,
  incidentStatus,
  recoveredFrom,
  streamsFailed,
  queueSize,
}) => {
  return (
    <Text>
      {tableName ? (
        <span>
          <b>Table Name: </b> {tableName}
          <br />
        </span>
      ) : (
        <></>
      )}
      {recoveredFrom ? (
        <span>
          <b>Recovered From: </b> {recoveredFrom.toLowerCase()}
          <br />
        </span>
      ) : (
        <></>
      )}
      {incidentStatus ? (
        <span>
          <b>Last Status: </b> {incidentStatus}
          <br />
        </span>
      ) : (
        <></>
      )}
      {streamsFailed ? (
        <span>
          <b>Streams Failed: </b> {streamsFailed}
          <br />
        </span>
      ) : (
        <></>
      )}
      {incidentStartedAt && (Date.now() - new Date(incidentStartedAt).getTime() > 5 * 60 * 1000 || recoveredFrom) ? (
        <span>
          <b>Incident Started At: </b> {dayjs(incidentStartedAt).toLocaleString()}
          <br />
        </span>
      ) : (
        <></>
      )}
      {queueSize ? (
        <span>
          <b>Events Queue Size: </b> {queueSize.toLocaleString()}
          <br />
        </span>
      ) : (
        <></>
      )}
    </Text>
  );
};

export const CheckJobStatusButton: React.FC<{ url?: string; label?: string; color?: string }> = ({
  url,
  label = "Check Job Status",
  color = "#a21caf",
}) => {
  if (!url) {
    return <></>;
  }
  return (
    <Container style={{ textAlign: "center" }}>
      <Button
        style={{
          padding: "8px 30px",
          border: 1,
          borderRadius: 7,
          backgroundColor: color,
          fontWeight: "bold",
          color: "white",
        }}
        href={url}
      >
        {label}
      </Button>
    </Container>
  );
};

export const Details: React.FC<{ details?: string }> = ({ details }) => {
  if (!details) {
    return <></>;
  }
  return (
    <Text>
      <b>Details: </b>
      <span
        style={{
          display: "block",
          fontFamily: "monospace",
          backgroundColor: "#f9fafb", // Equivalent to bg-gray-50
          padding: "0.5rem", // Equivalent to p-2
          width: "100%", // Equivalent to w-full
          wordBreak: "break-word",
          maxHeight: "13rem", // Equivalent to max-h-52 (52 * 0.25rem = 13rem)
          overflow: "auto", // Equivalent to overflow-auto
        }}
      >
        {details.split("\n").map((line, index) => (
          <span key={index}>
            {line}
            <br />
          </span>
        ))}
      </span>
    </Text>
  );
};

export const Footer: React.FC<{ unsubscribeLink?: string }> = ({ unsubscribeLink }) => {
  return (
    <>
      <Text>
        Best Regards,
        <br />
        Jitsu Team
        <br />
        <a href="https://jitsu.com" style={{ color: "#0070f3" }}>
          jitsu.com
        </a>
      </Text>
      <Hr />
      {unsubscribeLink ? (
        <Text style={{ textAlign: "center", fontSize: "0.8rem", color: "#999999" }}>
          <a href={unsubscribeLink} style={{ textDecoration: "underline", fontSize: "0.8rem", color: "#999999" }}>
            Manage your <u>email notification preferences</u>
          </a>
        </Text>
      ) : (
        <></>
      )}
      <Text style={{ textAlign: "center", fontSize: "0.7rem", color: "#999999" }}>
        Jitsu Labs Inc. 2261 Market Street #4109, San Francisco, CA 94114
      </Text>
    </>
  );
};
