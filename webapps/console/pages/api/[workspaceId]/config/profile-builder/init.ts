import { z } from "zod";
import { createRoute, verifyAccessWithRole } from "../../../../../lib/api";
import { db } from "../../../../../lib/server/db";
import { configObjectAuditLog } from "../../../../../lib/server/audit-log";
import { omitDeletedList } from "../../../../../lib/server/omit-deleted";

// Default function body for a fresh profile builder. Kept in sync with the
// previous inline literal that lived in ../profile-builder.ts.
const defaultProfileBuilderFunction = `export default async function(events, user, context) {
  context.log.info("Profile userId: " + user.id)
  const profile = {}
  profile.anonId = user.anonymousId
  return {
    traits: profile
  }
};`;

// Bootstrap a default profile builder for a workspace that has none yet.
//
// This used to live behind GET ../profile-builder?init=true, but that mixed a
// write into a read endpoint — meaning the maintenance gate had to block ALL
// profile-builder reads (workspace prefetch in lib/store/index.tsx included)
// to be safe, or let writes slip through. Splitting it out lets the GET stay
// a pure read while POST init opts into the maintenance gate via the normal
// HTTP-method check.
//
// Idempotent: if the workspace already has at least one (non-deleted) profile
// builder, returns the existing list without writing.
export default createRoute()
  .POST({
    auth: true,
    query: z.object({ workspaceId: z.string() }),
    summary: "Initialize a default profile builder if none exists",
    tags: ["profile-builder"],
  })
  .handler(async ({ user, query: { workspaceId } }) => {
    await verifyAccessWithRole(user, workspaceId, "editEntities");

    // Serialize concurrent /init calls for the same workspace via a
    // workspace-scoped Postgres advisory lock. Two clicks in quick
    // succession (or a stale duplicate request) would otherwise both pass
    // the existence check and create a second default profile builder.
    // The lock auto-releases at transaction commit; the second caller
    // re-enters, sees the just-created row, and short-circuits.
    const created = await db.prisma().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;

      const existing = await tx.profileBuilder.findMany({
        include: { functions: { include: { function: true } } },
        where: { workspaceId: workspaceId, deleted: false },
        orderBy: { createdAt: "asc" },
      });
      if (existing.length > 0) {
        return { profileBuilders: existing, created: false as const, func: null, pb: null };
      }

      const func = await tx.configurationObject.create({
        data: {
          workspaceId,
          type: "function",
          config: {
            kind: "profile",
            name: "Profile Builder function",
            draft: defaultProfileBuilderFunction,
            code: defaultProfileBuilderFunction,
          },
        },
      });
      const pb = await tx.profileBuilder.create({
        data: {
          workspaceId,
          version: 0,
          name: "Profile Builder",
          intermediateStorageCredentials: {},
          connectionOptions: {},
        },
      });
      await tx.profileBuilderFunction.create({
        data: {
          profileBuilderId: pb.id,
          functionId: func.id,
        },
      });
      const profileBuilders = await tx.profileBuilder.findMany({
        include: { functions: { include: { function: true } } },
        where: { workspaceId: workspaceId, deleted: false },
        orderBy: { createdAt: "asc" },
      });
      return { profileBuilders, created: true as const, func, pb };
    });

    // Audit log is intentionally written outside the transaction so a
    // failure here doesn't roll back the user-visible bootstrap. Same
    // trade-off as the original code path.
    if (created.created && created.func && created.pb) {
      await configObjectAuditLog(user, workspaceId, created.func.id, "function", "create", {
        newVersion: created.func.config,
      });
      await configObjectAuditLog(user, workspaceId, created.pb.id, "profilebuilder", "create", {
        newVersion: created.pb,
      });
    }
    return {
      profileBuilders: omitDeletedList(created.profileBuilders),
      created: created.created,
    };
  })
  .toNextApiHandler();
