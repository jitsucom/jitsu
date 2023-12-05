import { getLog, requireDefined } from "juava";
import fetch from "node-fetch-commonjs";

export type DomainInfo = Record<string, any>;

export const vercelProjectId = requireDefined(
  process.env.DOMAINS_VERCEL_PROJECT_ID,
  `env DOMAINS_VERCEL_PROJECT_ID is not set`
);
export const vercelTeamId = requireDefined(process.env.DOMAINS_VERCEL_TEAM_ID, `env DOMAINS_VERCEL_TEAM_ID is not set`);
export const vercelToken = requireDefined(process.env.DOMAINS_VERCEL_TOKEN, `env DOMAINS_VERCEL_TOKEN is not set`);
export const vercelCname = process.env.CNAME || "cname.jitsu.com";

const log = getLog("vercel");

export async function vercelRpc(url: string, method?: "GET" | "POST", body?: any): Promise<any> {
  const res = await fetch(url.indexOf("https://") === 0 ? url : `https://api.vercel.com${url}`, {
    method: method ?? "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      "Content-Type": "application/json",
    },
  });
  const txt = await res.text();
  if (!res.ok) {
    log.atError().log(`Rpc failed: ${res.status} ${res.statusText}. Response: ${txt}`);
  }
  return JSON.parse(txt);
}

export async function getExistingDomain(domain: string): Promise<DomainInfo | undefined> {
  const result = await vercelRpc(
    `https://api.vercel.com/v9/projects/${vercelProjectId}/domains/${domain}?teamId=${vercelTeamId}`
  );
  if (result.name) {
    return result;
  } else {
    return undefined;
  }
}
