import React from "react";
import { Hr, Text } from "@react-email/components";

export type UnsubscribeLinkProps = { unsubscribeLink?: string };
export type EmailComponent<P extends UnsubscribeLinkProps> = React.FC<P> & {
  defaultValues: Required<P>;
  subject: ((props: P) => string) | string;
  from?: string;
  bcc?: string;
  replyTo?: string;
  plaintext: (props: P) => string;
  allowUnsubscribe?: boolean;
  respectUnsubscribed?: boolean;
  scheduleAt?: (now: Date) => Date;
};

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

export function withDefaults<T extends UnsubscribeLinkProps>(Component: EmailComponent<T>): EmailComponent<T> {
  const Wrapper = p => {
    const props = { ...Component.defaultValues, ...p };
    return <Component {...props} />;
  };
  const keys = Object.keys(Component) as (keyof EmailComponent<T>)[];
  for (const key of keys) {
    Wrapper[key] = Component[key];
  }
  Wrapper.displayName = Component.displayName || "Email";
  return Wrapper as any;
}
