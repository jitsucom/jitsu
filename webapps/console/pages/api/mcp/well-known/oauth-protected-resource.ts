import type { NextApiRequest, NextApiResponse } from "next";
import { mcpServer } from "../../../../lib/server/mcp-server";

export default (req: NextApiRequest, res: NextApiResponse) => mcpServer.handleProtectedResourceMeta(req, res);
