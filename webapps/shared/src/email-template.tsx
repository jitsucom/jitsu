import React from "react";
import { Hr, Text } from "@react-email/components";

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
