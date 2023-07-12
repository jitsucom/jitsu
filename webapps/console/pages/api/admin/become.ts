import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { firebase, isFirebaseEnabled } from "../../../lib/server/firebase-server";
import { db } from "../../../lib/server/db";
import { SessionUser } from "../../../lib/schema";

async function check(user: SessionUser) {
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
    const token = await firebase()
      .auth()
      .createCustomToken(firebaseUser.uid, { internalId: firebaseUser.customClaims?.internalId });
    return { token };
  })
  .toNextApiHandler();
