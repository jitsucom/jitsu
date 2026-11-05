/* eslint-disable @typescript-eslint/no-unsafe-assignment --
 * Pre-existing implicit-`any` debt, exempted when the unsafe-any gate was
 * introduced for pages/api/admin (JITSU-158 action item 3). Fix the `any`
 * flows in this file, then remove this header - do not add new ones. */
import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { firebase, isFirebaseEnabled } from "../../../lib/server/firebase-server";
import { db } from "../../../lib/server/db";
import { SessionUser } from "../../../lib/schema";
import { assertInteractiveAdminSession } from "../../../lib/server/admin-become";
import { impersonationAuditLog } from "../../../lib/server/audit-log";

async function check(user: SessionUser) {
  assertInteractiveAdminSession(user);
  assertDefined(isFirebaseEnabled(), `Admin users-tool works with firebase only`);
  const userModel = requireDefined(
    await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
    `User ${user.internalId} does not exist`
  );
  assertTrue(userModel.admin, `User ${user.internalId} is not admin`);
}

export default createRoute()
  .POST({
    auth: true,
    body: z.object({
      externalId: z.string(),
    }),
    result: z.object({
      token: z.string(),
    }),
  })
  .handler(async ({ req, user, body }) => {
    await check(user);

    const firebaseUser = await firebase().auth().getUser(body.externalId);
    // `impersonatedBy` makes create-session cap the resulting session at one hour
    const token = await firebase().auth().createCustomToken(firebaseUser.uid, {
      internalId: firebaseUser.customClaims?.internalId,
      impersonatedBy: user.internalId,
    });
    await impersonationAuditLog(
      user,
      {
        externalId: body.externalId,
        internalId: firebaseUser.customClaims?.internalId,
        email: firebaseUser.email,
      },
      req
    );
    return { token };
  })
  .toNextApiHandler();
