import { getSingleton } from "juava";
import Agent, { HttpsAgent } from "agentkeepalive";

export const httpAgent = getSingleton<Agent>("http-agent", createHTTPAgent);
export const httpsAgent = getSingleton<HttpsAgent>("https-agent", createHTTPSAgent);

async function createHTTPAgent(): Promise<Agent> {
  const agent = new Agent({ timeout: 300000, freeSocketTimeout: 30000, maxSockets: 1024 });
  return Promise.resolve(agent);
}

async function createHTTPSAgent(): Promise<HttpsAgent> {
  const agent = new HttpsAgent({ timeout: 300000, freeSocketTimeout: 30000, maxSockets: 1024 });
  return Promise.resolve(agent);
}
