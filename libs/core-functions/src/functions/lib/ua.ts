import { UserAgent } from "@jitsu/protocols/functions";
import omit from "lodash/omit";
import uaParser from "@amplitude/ua-parser-js";
import NodeCache from "node-cache";

const BotUAKeywords = ["bot", "spider", "headless", "crawler", "uptimia"];
const uaCacheTTL = 60 * 10; // 10 min;
const uaCache = new NodeCache({ stdTTL: uaCacheTTL, checkperiod: 60, maxKeys: 1000, useClones: false });

export function parseUserAgent(userAgent?: string): UserAgent {
  if (!userAgent) {
    return {} as UserAgent;
  }
  const cached = uaCache.get(userAgent);
  if (cached) {
    uaCache.ttl(userAgent, uaCacheTTL);
    return cached as UserAgent;
  }
  const uas = userAgent || "";
  const ua = omit(uaParser(uas), "ua") as UserAgent;
  const lower = uas.toLowerCase();
  ua.bot = BotUAKeywords.some(keyword => lower.includes(keyword));
  if (ua.device) {
    ua.device.type = ua.device.type || "desktop";
  }
  try {
    uaCache.set(userAgent, ua);
  } catch (e) {}
  return ua;
}
