import type { NextApiRequest, NextApiResponse } from "next";
import { ApiReference } from "@scalar/nextjs-api-reference";

// `@scalar/nextjs-api-reference` targets the App Router (returns a fetch `Response`).
// This project uses the Pages Router, so we adapt the handler ourselves.
const fetchHandler = ApiReference({
  url: "/api/spec",
  pageTitle: "Jitsu API Reference",
  // Scalar auto-enables the "Ask AI Agent" button and the MCP integrations block
  // (VS Code / Cursor / Generate MCP) on localhost; explicitly disable both so they
  // don't appear in dev or production.
  agent: { disabled: true },
  mcp: { disabled: true },
  // No config flag exists for the "Powered by Scalar" footer link — hide it via CSS.
  customCss: `.scalar-app a[href="https://www.scalar.com"]{display:none!important;}`,
} as any);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const response = fetchHandler();
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.status(response.status).send(await response.text());
}
