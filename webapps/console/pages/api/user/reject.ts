import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";

export default createRoute()
  .POST({
    auth: true,
    body: z.object({ invitationToken: z.string() }),
    result: z.object({
      rejected: z.boolean(),
      details: z.string().optional(),
    }),
  })
  .handler(async ({ user, body }) => {
    const token = await db.prisma().invitationToken.findFirst({ where: { token: body.invitationToken } });

    if (!token) {
      return { rejected: false, details: `Token ${body.invitationToken} was not found` };
    }

    if (token.usedBy) {
      return { rejected: false, details: `Token ${body.invitationToken} has already been used` };
    }

    // Mark the token as rejected with REJECTED prefix
    await db.prisma().invitationToken.update({
      where: { id: token.id },
      data: { usedBy: `REJECTED ${user.internalId}` },
    });

    return { rejected: true, details: "Invitation has been rejected" };
  })
  .toNextApiHandler();
