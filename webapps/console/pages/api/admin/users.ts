import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { assertDefined, assertTrue, requireDefined } from "juava";
import { firebase, isFirebaseEnabled } from "../../../lib/server/firebase-server";
import { db } from "../../../lib/server/db";
import { SessionUser } from "../../../lib/schema";
import { auth } from "firebase-admin";
import UserRecord = auth.UserRecord;

const ResultUser = z.object({
  internalId: z.string().optional(),
  externalId: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  userInfo: z.object({}).passthrough().optional(),
});
type ResultUser = z.infer<typeof ResultUser>;

async function check(user: SessionUser) {
  assertDefined(isFirebaseEnabled(), `Admin users-tool works with firebase only`);
  const userModel = requireDefined(
    await db.prisma().userProfile.findUnique({ where: { id: user.internalId } }),
    `User ${user.internalId} does not exist`
  );
  assertTrue(userModel.admin, `User ${user.internalId} is not admin`);
}

function usr(u: any, extended?: boolean) {
  return {
    internalId: u.customClaims?.internalId,
    externalId: u.uid,
    email: u.email,
    name: u.displayName,
    userInfo: extended ? u : undefined,
  };
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      extended: z.boolean().optional(),
      internalId: z.string().optional(),
      externalId: z.string().optional(),
    }),
    result: z.object({
      users: z.array(ResultUser),
    }),
  })
  .handler(async ({ user, query: { extended, externalId } }) => {
    await check(user);
    const users: ResultUser[] = [];
    if (externalId) {
      const u = requireDefined(await firebase().auth().getUser(externalId), `User ${externalId} does not exist`);
      users.push(usr(u, true));
    } else {
      let nextPageToken: string | undefined = undefined;
      do {
        const usersPage = await firebase().auth().listUsers(1000, nextPageToken);
        nextPageToken = usersPage.pageToken;
        usersPage.users.forEach(u => users.push(usr(u, extended)));
      } while (nextPageToken);
    }

    return { users };
  })
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
