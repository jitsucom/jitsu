import type { NextApiRequest, NextApiResponse } from "next";
import { mcpServer } from "../../../../lib/server/mcp-server";
import { withAuthRateLimit } from "../../../../lib/server/rate-limit/auth";

// Every attempt counts per client address, before the client secret, the code or the refresh token is checked: this endpoint
// is where they can be guessed. A deployment pinned read-only counts nothing: it can share its database with production.
export default withAuthRateLimit((req: NextApiRequest, res: NextApiResponse) => mcpServer.handleToken(req, res), {
  bucket: "token",
  skipInReadOnly: true,
});
