import { UserAgent } from "@jitsu/protocols/functions";
import omit from "lodash/omit";
import uaParser from "@amplitude/ua-parser-js";

const BotUAKeywords = ["bot", "spider", "headless", "crawler", "uptimia"];

export function parseUserAgent(userAgent?: string): UserAgent {
  const uas = userAgent || "";
  const ua = omit(uaParser(uas), "ua") as UserAgent;
  const lower = uas.toLowerCase();
  ua.bot = BotUAKeywords.some(keyword => lower.includes(keyword));
  if (ua.device) {
    ua.device.type = ua.device.type || "desktop";
  }
  return ua;
}
