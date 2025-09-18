import { NextApiRequest, NextApiResponse } from "next";
import { withErrorHandler } from "../../lib/route-helpers";
import { store } from "../../lib/services";
import { requireDefined } from "juava";
import { sortBy } from "lodash";
import { auth } from "../../lib/auth";

const handler = async function handler(req: NextApiRequest, res: NextApiResponse) {
  const workspaceId = requireDefined(req.query.workspaceId, "workspaceId is required") as string;
  const claims = await auth(req, res);
  if (claims?.type !== "admin") {
    throw new Error("Unauthorized");
  }
  const logsEntry = await store.getTable("email-logs").get(workspaceId);
  if (!logsEntry) {
    res.json([]);
    return;
  } else {
    const appUrl = process.env.JITSU_APPLICATION_URL || "https://use.jitsu.com";
    res.json(
      sortBy(logsEntry.logs, "timestamp")
        .reverse()
        .map(({ subject, ...rest }) => {
          const subjectDeduped = [...new Set(subject)];
          return {
            ...rest,
            subject: subjectDeduped.length === 1 ? subjectDeduped[0] : subjectDeduped,
            workspaceId,
            url: `${appUrl}/${workspaceId}`,
          };
        })
    );
  }
};

export default withErrorHandler(handler);
