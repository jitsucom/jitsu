import { Api, inferUrl, nextJsApiHandler } from "../../../lib/api";
import { ApiError } from "../../../lib/shared/errors";
import { ApiKey } from "../../../lib/schema";
import { z } from "zod";
import { db } from "../../../lib/server/db";
import { hint, randomId } from "juava";
import { createHash } from "juava";
import { mcpServer } from "../../../lib/server/mcp-server";

const CreateKeyBody = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  // ISO date or null. If null/missing → never expires.
  expiresAt: z.coerce.date().nullish(),
});

const api: Api = {
  url: inferUrl(__filename),
  GET: {
    auth: true,
    types: {
      result: z.array(ApiKey),
    },
    handle: async ({ user }) => {
      const rows = await db.prisma().userApiToken.findMany({
        where: { userId: user.internalId },
        select: {
          id: true,
          hint: true,
          createdAt: true,
          lastUsed: true,
          type: true,
          name: true,
          expiresAt: true,
          oauthClient: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      // Flatten the relation into a single field so the wire shape stays flat.
      return rows.map(({ oauthClient, ...rest }) => ({
        ...rest,
        mcpClientName: oauthClient?.name ?? null,
      }));
    },
  },
  POST: {
    auth: true,
    types: {
      body: CreateKeyBody,
      result: ApiKey,
    },
    handle: async ({ user, body }) => {
      const plaintext = randomId({ digits: 32, strongRandom: true });
      const id = randomId(32);
      const created = await db.prisma().userApiToken.create({
        data: {
          id,
          userId: user.internalId,
          hint: hint(plaintext),
          hash: createHash(plaintext),
          type: body.type ?? "api",
          name: body.name ?? null,
          expiresAt: body.expiresAt ?? null,
        },
      });
      return {
        id: created.id,
        plaintext,
        hint: created.hint,
        createdAt: created.createdAt,
        lastUsed: created.lastUsed,
        type: created.type,
        name: created.name,
        expiresAt: created.expiresAt,
      };
    },
  },
  PATCH: {
    auth: true,
    types: {
      query: z.object({ id: z.string() }),
      body: z.object({
        name: z.string().nullish(),
        // ISO date, null, or omitted. Null = clear (never expires); omitted = leave alone.
        expiresAt: z.coerce.date().nullish(),
      }),
      result: ApiKey,
    },
    handle: async ({ user, query, body }) => {
      const existing = await db.prisma().userApiToken.findUnique({ where: { id: query.id } });
      if (!existing || existing.userId !== user.internalId) {
        throw new ApiError(`Key not found`, {}, { status: 404 });
      }
      // `expiresAt` is tri-state on the wire: present-as-Date sets, present-as-null
      // clears, missing leaves the column alone. Same for `name`.
      const data: { name?: string | null; expiresAt?: Date | null } = {};
      if (Object.prototype.hasOwnProperty.call(body, "name")) data.name = body.name ?? null;
      if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) data.expiresAt = body.expiresAt ?? null;
      const updated = await db.prisma().userApiToken.update({
        where: { id: query.id },
        data,
        include: { oauthClient: { select: { name: true } } },
      });
      return {
        id: updated.id,
        hint: updated.hint,
        createdAt: updated.createdAt,
        lastUsed: updated.lastUsed,
        type: updated.type,
        name: updated.name,
        expiresAt: updated.expiresAt,
        mcpClientName: updated.oauthClient?.name ?? null,
      };
    },
  },
  DELETE: {
    auth: true,
    types: {
      query: z.object({ id: z.string() }),
      result: z.object({ ok: z.boolean() }),
    },
    handle: async ({ user, query }) => {
      const existing = await db.prisma().userApiToken.findUnique({ where: { id: query.id } });
      if (!existing || existing.userId !== user.internalId) {
        throw new ApiError(`Key not found`, {}, { status: 404 });
      }
      // MCP-aware delete: if the row has oauthClientId set, also nukes its
      // OAuthAccessToken rows and the OAuthClient itself. For non-MCP keys
      // this is a plain delete. Single transaction either way.
      await mcpServer.deleteUserApiTokenWithMcpCascade(query.id);
      return { ok: true };
    },
  },
};

export default nextJsApiHandler(api);
