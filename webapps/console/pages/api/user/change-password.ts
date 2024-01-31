import { createRoute } from "../../../lib/api";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { assertTrue, checkHash, createHash } from "juava";

export default createRoute()
  .POST({
    auth: true,
    body: z.object({
      currentPassword: z.string(),
      newPassword: z.string(),
    }),
  })
  .handler(async ({ user, body }) => {
    assertTrue(user.loginProvider === "credentials", "Only credentials login is supported");
    const password = await db.prisma().userPassword.findFirst({ where: { userId: user.internalId } });
    if (!password) {
      throw new Error("Password is not set");
    }
    if (!checkHash(password.hash, body.currentPassword)) {
      throw new Error("Current password is invalid");
    }
    await db
      .prisma()
      .userPassword.update({ where: { userId: user.internalId }, data: { hash: createHash(body.newPassword) } });
    return {
      status: "ok",
    };
  })
  .toNextApiHandler();
