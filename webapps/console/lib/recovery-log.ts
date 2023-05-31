import { ISO8601Date } from "@jitsu/protocols/iso8601";

export type RecoveryLogMessage = {
  timestamp: ISO8601Date;
  kind: string;
  json: any;
};

export type RecoveryLog = {};
