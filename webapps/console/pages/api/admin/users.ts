import { getUser } from "../../../lib/api";
import { z } from "zod";
import { assertDefined, assertTrue, getErrorMessage, getLog, requireDefined } from "juava";
import { firebase, isFirebaseEnabled } from "../../../lib/server/firebase-server";
import { db } from "../../../lib/server/db";
import { SessionUser } from "../../../lib/schema";
import { NextApiRequest, NextApiResponse } from "next";

const ResultUser = z.object({
  internalId: z.string().optional(),
  externalId: z.string().optional(),
  email: z.string().optional(),
  created: z.string().optional(),
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
    created: new Date(u.metadata.creationTime).toISOString(),
    userInfo: extended ? u : undefined,
  };
}

function isTrueish(v: any) {
  return v === "true" || v === true || v === 1 || v === "1";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = requireDefined(await getUser(res, req, true), `User is not authenticated`);
    await check(user);
    const { externalId, extended, format } = req.query;
    const users: any[] = [];

    if (externalId) {
      const u = requireDefined(
        await firebase()
          .auth()
          .getUser(externalId as string),
        `User ${externalId} does not exist`
      );
      users.push(usr(u, true));
    } else {
      let nextPageToken: string | undefined = undefined;
      do {
        const usersPage = await firebase().auth().listUsers(1000, nextPageToken);
        nextPageToken = usersPage.pageToken;
        usersPage.users.forEach(u => users.push(usr(u, isTrueish(extended))));
      } while (nextPageToken);
    }

    if (format === "tsv") {
      const lines = users.map(u => [u.internalId, u.externalId, u.email, u.name, u.created].join("\t"));
      const header = ["internalId", "externalId", "email", "name", "created"].join("\t");
      const tsv = [header, ...lines].join("\n");

      res.setHeader("Content-Type", "text/plain");
      res.status(200).send(tsv);
      return tsv;
    }
    res.status(200).send({ users });
  } catch (e) {
    res.status(500).send(getErrorMessage(e));
    getLog().atError().withCause(e).log("Error obtaining list of platform users");
  }
}
