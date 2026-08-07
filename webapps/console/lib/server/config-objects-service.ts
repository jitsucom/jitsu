import type { PrismaClient } from "@prisma/client";
import type { NextApiRequest } from "next";
import { deepCopy, randomId, requireDefined, rpc } from "juava";
import { SessionUser, SyncOptionsType } from "../schema";
import { getAllConfigObjectTypeNames, getConfigObjectType, parseObject } from "../schema/config-objects";
import { containsMaskedSecrets, unmaskSecretsFromOriginal } from "../schema/secrets";
import { getCoreDestinationTypeNonStrict, MASKED_SECRET } from "../schema/destinations";
import { verifyAccess, verifyAccessWithRole } from "../api";
import { prepareZodObjectForDeserialization } from "../zod";
import { ApiError } from "../shared/errors";
import { configObjectAuditLog } from "./audit-log";
import { productTelemetryEnabled, trackTelemetryEvent, withProductAnalytics } from "./telemetry";
import { scheduleSync, validateSyncSchedule } from "./sync";
import { getEeConnection, isEEAvailable, serviceTokenHeaders } from "./ee";
import { omitDeletedList } from "./omit-deleted";
import { getServerLog } from "./log";

const log = getServerLog("config-objects-service");

export interface ConfigObjectsServiceDeps {
  prisma: PrismaClient;
}

/** Hard cap on the number of workspaces returned per `listWorkspaces` page. */
export const WORKSPACES_PAGE_MAX = 100;

export type LinkUpsert = {
  id?: string;
  fromId: string;
  toId: string;
  type?: string;
  data?: any;
};

export type LinkSelector = { id?: string; fromId?: string; toId?: string };

/**
 * Reusable config-object CRUD, extracted verbatim from the `pages/api/[workspaceId]/config/*`
 * route handlers so non-HTTP callers (the MCP server) share one implementation of validation,
 * secret-masking, input/output filtering, and audit logging.
 *
 * `prisma` is injected for this class's own config-object queries. The shared helpers it
 * delegates to — `verifyAccess`, `configObjectAuditLog`, `trackTelemetryEvent` — still reach
 * for the `db.prisma()` singleton internally; in production that's the same instance, so there
 * is no split-brain. The existing HTTP routes are intentionally left untouched in this PR; they
 * can be migrated onto this service in a follow-up.
 */

/**
 * Non-secret descriptor props attached to create/update/delete_object product-analytics
 * events. `objectSubtype` is the type-specific discriminator (destination kind, connector
 * package, function kind); `connectorVersion` is the connector image version for services
 * (i.e. the version of the `objectSubtype` package). All values are labels/enums — no secrets.
 */
function objectAnalyticsProps(type: string, id: string, config: any): Record<string, any> {
  const objectSubtype =
    type === "destination"
      ? config?.destinationType
      : type === "service"
      ? config?.package
      : type === "function"
      ? config?.kind
      : undefined;
  return {
    objectType: type,
    objectId: id,
    objectName: config?.name,
    ...(objectSubtype ? { objectSubtype } : {}),
    ...(type === "service" && config?.version ? { connectorVersion: config.version } : {}),
  };
}

export class ConfigObjectsService {
  private readonly prisma: PrismaClient;

  constructor(deps: ConfigObjectsServiceDeps) {
    this.prisma = deps.prisma;
  }

  /** Names of config-object types (destination, stream, function, service, domain, notification, …). */
  resourceTypes(): string[] {
    return getAllConfigObjectTypeNames();
  }

  /**
   * Workspaces the user can access (all of them for admins), paginated.
   * `limit` is capped at {@link WORKSPACES_PAGE_MAX}; use `offset` + `hasMore` to page.
   */
  async listWorkspaces(
    user: SessionUser,
    opts: { limit?: number; offset?: number } = {}
  ): Promise<{
    workspaces: { id: string; name: string; slug: string | null }[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const limit = Math.min(Math.max(opts.limit ?? WORKSPACES_PAGE_MAX, 1), WORKSPACES_PAGE_MAX);
    const offset = Math.max(opts.offset ?? 0, 0);
    const userModel = requireDefined(
      await this.prisma.userProfile.findUnique({ where: { id: user.internalId } }),
      `User ${user.internalId} does not exist`
    );
    const [total, workspaces] = userModel.admin
      ? await Promise.all([
          this.prisma.workspace.count({ where: { deleted: false } }),
          this.prisma.workspace.findMany({
            where: { deleted: false },
            select: { id: true, name: true, slug: true },
            orderBy: { createdAt: "asc" },
            skip: offset,
            take: limit,
          }),
        ])
      : await Promise.all([
          this.prisma.workspaceAccess.count({ where: { userId: user.internalId, workspace: { deleted: false } } }),
          this.prisma.workspaceAccess
            .findMany({
              where: { userId: user.internalId, workspace: { deleted: false } },
              include: { workspace: { select: { id: true, name: true, slug: true } } },
              orderBy: { createdAt: "asc" },
              skip: offset,
              take: limit,
            })
            .then(rows => rows.map(({ workspace }) => workspace)),
        ]);
    return { workspaces, total, limit, offset, hasMore: offset + workspaces.length < total };
  }

  private assertKnownType(type: string) {
    if (!getAllConfigObjectTypeNames().includes(type)) {
      throw new ApiError(`Unknown resource type '${type}'. Known types: ${getAllConfigObjectTypeNames().join(", ")}`, {
        status: 400,
        responseObject: { type },
      });
    }
  }

  // ─── Config objects ───────────────────────────────────────────────────────

  /** Backs `config/[type]/index.ts` GET. */
  async list(user: SessionUser, workspaceId: string, type: string): Promise<any[]> {
    await verifyAccess(user, workspaceId);
    this.assertKnownType(type);
    const configObjectType = getConfigObjectType(type);
    const objects = await this.prisma.configurationObject.findMany({
      where: { workspaceId, type, deleted: false },
      orderBy: { createdAt: "asc" },
    });
    const mapped = objects.map(({ id, workspaceId, config, updatedAt }) => ({
      ...(config as any),
      id,
      workspaceId,
      type,
      updatedAt,
    }));
    return await Promise.all(mapped.map(obj => configObjectType.outputFilter(obj)));
  }

  /** Backs `config/[type]/[id].ts` GET. */
  async get(user: SessionUser, workspaceId: string, type: string, id: string): Promise<any> {
    await verifyAccess(user, workspaceId);
    this.assertKnownType(type);
    const configObjectType = getConfigObjectType(type);
    // Constrain by `type`: outputFilter is chosen from the caller-supplied type, so an
    // id of a different type must not match (else e.g. a destination's secrets could be
    // returned unmasked through the stream filter).
    const object = await this.prisma.configurationObject.findFirst({
      where: { workspaceId, id, type, deleted: false },
    });
    if (!object) {
      throw new ApiError(`${type} with id ${id} does not exist`, { status: 404 });
    }
    const preFilter = { ...((object.config as any) || {}), workspaceId, id, type, updatedAt: object.updatedAt };
    return await configObjectType.outputFilter(preFilter);
  }

  /** Backs `config/[type]/index.ts` POST. Returns the created id. */
  async create(
    user: SessionUser,
    workspaceId: string,
    type: string,
    data: any,
    opts: { req?: NextApiRequest; generateId?: boolean } = {}
  ): Promise<{ id: string }> {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    this.assertKnownType(type);
    const workspace = requireDefined(
      await this.prisma.workspace.findFirst({ where: { id: workspaceId } }),
      `Workspace ${workspaceId} not found`
    );
    const configObjectType = getConfigObjectType(type);
    // Inject type/workspaceId so parseObject sees a complete object. `id` is
    // caller-dependent: the HTTP route requires the client to send it (the base
    // schema mandates it, and a missing id must stay a validation error so client
    // payload bugs surface). An MCP caller passes `data` without an id, so it opts
    // into `generateId` to have one minted here.
    const incoming = { ...data, type, workspaceId, id: data?.id ?? (opts.generateId ? randomId() : undefined) };
    let object = parseObject(type, incoming);
    if (incoming.cloneId) {
      log.atInfo().log(`Unmasking secrets for ${type} clone: ${incoming.id}`);
      if (containsMaskedSecrets(object)) {
        const clonesOriginal = await this.prisma.configurationObject.findFirst({
          where: { id: incoming.cloneId, workspaceId },
        });
        if (clonesOriginal?.config) {
          object = unmaskSecretsFromOriginal(object, clonesOriginal.config as any);
        }
      }
    }
    object = await configObjectType.inputFilter(object, "create", workspace);
    const id = object.id;
    delete object.id;
    delete object.workspaceId;
    delete object.cloneId;

    const created = await this.prisma.configurationObject.create({
      data: { id, workspaceId, config: object, type },
    });

    if (["destination", "service"].includes(type)) {
      const count = await this.prisma.configurationObject.count({
        where: { workspaceId, type: type, deleted: false },
      });

      if (count === 1) {
        withProductAnalytics(
          p =>
            p.track("workspace_activated", {
              ...objectAnalyticsProps(type, id, object),
              ...(incoming.cloneId ? { cloned: true } : {}),
            }),
          {
            user,
            workspace,
            req: opts.req,
          }
        );
      }
    }

    await trackTelemetryEvent("config-object-create", { objectType: type });
    // Emit regardless of caller (HTTP or MCP) so MCP-authored changes are tracked too.
    // The event carries the request origin (ui/api/cli/mcp) via withProductAnalytics.
    await withProductAnalytics(
      p =>
        p.track("create_object", {
          ...objectAnalyticsProps(type, id, object),
          ...(incoming.cloneId ? { cloned: true } : {}),
        }),
      { user, workspace, req: opts.req }
    );
    await configObjectAuditLog(user, workspaceId, created.id, type, "create", { newVersion: object }, opts.req);

    if (type === "stream" && isEEAvailable()) {
      // Provision the workspace's event-archive bucket on first stream. Server-side
      // so API/MCP/CLI stream creation triggers it too (this replaced a browser-only
      // eeRpc call in ConfigEditor). Best-effort: the hourly backup-retention-sync
      // job on ee-api is the backstop, so a failure must not fail stream creation.
      try {
        await rpc(`${getEeConnection().host}api/s3-init?workspaceId=${encodeURIComponent(workspaceId)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json", ...serviceTokenHeaders() },
        });
      } catch (e) {
        log.atWarn().withCause(e).log(`Failed to provision backup bucket for workspace ${workspaceId}`);
      }
    }
    return { id: created.id };
  }

  /** Backs `config/[type]/[id].ts` PUT. */
  async update(
    user: SessionUser,
    workspaceId: string,
    type: string,
    id: string,
    patch: any,
    opts: { req?: NextApiRequest } = {}
  ): Promise<void> {
    const body = prepareZodObjectForDeserialization(patch);
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    this.assertKnownType(type);
    const workspace = requireDefined(
      await this.prisma.workspace.findFirst({ where: { id: workspaceId } }),
      `Workspace ${workspaceId} not found`
    );
    const configObjectType = getConfigObjectType(type);
    // Constrain by `type` so merge/inputFilter can't be applied to a different resource type.
    const object = await this.prisma.configurationObject.findFirst({
      where: { workspaceId, id, type, deleted: false },
    });
    if (!object) {
      throw new ApiError(`${type} with id ${id} does not exist`, { status: 404 });
    }
    // Snapshot before merge — `merge` may mutate `object.config` in place.
    const prevVersion = deepCopy(object.config);
    const merged = await configObjectType.merge(object.config, { ...body, id, workspaceId });
    const parsed = parseObject(type, merged);
    const filtered = await configObjectType.inputFilter(parsed, "update", workspace);
    delete filtered.id;
    delete filtered.workspaceId;
    await this.prisma.configurationObject.update({ where: { id }, data: { config: filtered } });
    await trackTelemetryEvent("config-object-update", { objectType: type });
    // Emit for HTTP and MCP callers alike; origin (ui/api/cli/mcp) is stamped by withProductAnalytics.
    await withProductAnalytics(p => p.track("update_object", objectAnalyticsProps(type, id, filtered)), {
      user,
      workspace,
      req: opts.req,
    });
    await configObjectAuditLog(user, workspaceId, id, type, "update", { prevVersion, newVersion: filtered }, opts.req);
  }

  /** Backs `config/[type]/[id].ts` DELETE (soft delete). Returns the deleted object, or null. */
  async delete(
    user: SessionUser,
    workspaceId: string,
    type: string,
    id: string,
    opts: { strict?: boolean; cascade?: boolean; req?: NextApiRequest } = {}
  ): Promise<any | null> {
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    this.assertKnownType(type);
    // Constrain by `type` so the onDelete hook and audit type match the actual object.
    const object = await this.prisma.configurationObject.findFirst({
      where: { workspaceId, id, type, deleted: false },
    });
    if (!object) {
      return null;
    }
    const configObjectType = getConfigObjectType(type);
    if (configObjectType.onDelete) {
      await configObjectType.onDelete(object, { strict: opts.strict === true, cascade: opts.cascade === true });
    }
    await this.prisma.configurationObject.update({ where: { id: object.id }, data: { deleted: true } });
    await trackTelemetryEvent("config-object-delete", { objectType: type });
    // Emit for HTTP and MCP callers alike (origin is stamped by withProductAnalytics).
    // delete() doesn't otherwise load the workspace — fetch it only when telemetry is on
    // and we're going to emit, so name/slug reach the group traits.
    if (productTelemetryEnabled) {
      const workspace = await this.prisma.workspace.findFirst({ where: { id: workspaceId } });
      if (workspace) {
        await withProductAnalytics(p => p.track("delete_object", objectAnalyticsProps(type, id, object.config)), {
          user,
          workspace,
          req: opts.req,
        });
      }
    }
    await configObjectAuditLog(user, workspaceId, id, type, "delete", { prevVersion: object.config }, opts.req);
    return { ...((object.config as any) || {}), workspaceId, id, type };
  }

  // ─── Connections (links) ──────────────────────────────────────────────────

  /** Backs `config/link.ts` GET. Masks `functionsEnv` secrets for non-editors. */
  async listLinks(user: SessionUser, workspaceId: string): Promise<any[]> {
    const role = await verifyAccessWithRole(user, workspaceId, "readEntities");
    const links = await this.prisma.configurationObjectLink.findMany({
      where: { workspaceId, deleted: false },
      orderBy: { createdAt: "asc" },
    });
    if (!role.editEntities) {
      for (const link of links) {
        const functionsEnv = (link.data as any)?.["functionsEnv"];
        if (typeof functionsEnv === "object" && functionsEnv !== null) {
          for (const key in functionsEnv) {
            functionsEnv[key] = MASKED_SECRET;
          }
        }
      }
    }
    return omitDeletedList(links);
  }

  /**
   * Emit a connection_created / connection_deleted product event. Loads the workspace and both
   * endpoints only when product telemetry is on (Cloud), so self-hosted pays nothing. The `from`
   * endpoint is a stream (push) or a connector service (sync); `to` is always a destination.
   */
  private async emitConnectionEvent(
    user: SessionUser,
    workspaceId: string,
    req: NextApiRequest | undefined,
    event: "connection_created" | "connection_deleted",
    link: { id: string; fromId: string; toId: string; type?: string | null }
  ): Promise<void> {
    // Emit for HTTP and MCP callers alike; `req` (when present) only adds IP context.
    // Origin (ui/api/cli/mcp) is stamped by withProductAnalytics.
    if (!productTelemetryEnabled) {
      return;
    }
    const [workspace, from, to] = await Promise.all([
      this.prisma.workspace.findFirst({ where: { id: workspaceId } }),
      this.prisma.configurationObject.findFirst({ where: { workspaceId, id: link.fromId } }),
      this.prisma.configurationObject.findFirst({ where: { workspaceId, id: link.toId } }),
    ]);
    if (!workspace) {
      return;
    }
    const fromConfig = from?.config as any;
    const toConfig = to?.config as any;
    await withProductAnalytics(
      p =>
        p.track(event, {
          connectionId: link.id,
          connectionType: link.type ?? "push",
          fromId: link.fromId,
          toId: link.toId,
          ...(toConfig?.destinationType ? { destinationType: toConfig.destinationType } : {}),
          ...(from?.type === "service" && fromConfig?.package ? { connectorPackage: fromConfig.package } : {}),
        }),
      { user, workspace, req }
    );
  }

  /** Backs `config/link.ts` POST/PUT upsert. */
  async upsertLink(
    user: SessionUser,
    workspaceId: string,
    body: LinkUpsert,
    opts: { strict?: boolean; runSync?: boolean; req?: NextApiRequest } = {}
  ): Promise<{ id: string; created: boolean }> {
    const { id, toId, fromId, data = undefined, type = "push" } = body;
    await verifyAccessWithRole(user, workspaceId, "editEntities");

    if (type === "sync" && data) {
      try {
        validateSyncSchedule(data);
      } catch (e: any) {
        throw new ApiError(e.message, { status: 400 });
      }
    }

    if (opts.strict) {
      await this.validateLinkData(workspaceId, type, toId, data);
    }

    const fromType = type === "sync" ? "service" : "stream";
    const existingLink =
      type === "push"
        ? await this.prisma.configurationObjectLink.findFirst({ where: { workspaceId, toId, fromId, deleted: false } })
        : id
        ? await this.prisma.configurationObjectLink.findFirst({ where: { workspaceId, id, deleted: false } })
        : undefined;

    if (!id && existingLink) {
      throw new ApiError(`Link from '${fromId}' to '${toId}' already exists`, { status: 400 });
    }

    const co = this.prisma.configurationObject;
    if (!(await co.findFirst({ where: { workspaceId, type: fromType, id: fromId, deleted: false } }))) {
      throw new ApiError(`${fromType} object with id '${fromId}' not found in the workspace '${workspaceId}'`, {
        status: 400,
      });
    }
    if (!(await co.findFirst({ where: { workspaceId, type: "destination", id: toId, deleted: false } }))) {
      throw new ApiError(`Destination object with id '${toId}' not found in the workspace '${workspaceId}'`, {
        status: 400,
      });
    }

    let createdOrUpdated: any;
    if (existingLink) {
      createdOrUpdated = await this.prisma.configurationObjectLink.update({
        where: { id: existingLink.id },
        data: { data, deleted: false, workspaceId },
      });
      await configObjectAuditLog(
        user,
        workspaceId,
        createdOrUpdated.id,
        "link",
        "update",
        { prevVersion: existingLink, newVersion: createdOrUpdated },
        opts.req
      );
    } else {
      createdOrUpdated = await this.prisma.configurationObjectLink.create({
        data: {
          id: `${workspaceId}-${fromId.substring(fromId.length - 4)}-${toId.substring(toId.length - 4)}-${randomId(6)}`,
          workspaceId,
          fromId,
          toId,
          data,
          type,
        },
      });
      await configObjectAuditLog(
        user,
        workspaceId,
        createdOrUpdated.id,
        "link",
        "create",
        { newVersion: createdOrUpdated },
        opts.req
      );
      await this.emitConnectionEvent(user, workspaceId, opts.req, "connection_created", createdOrUpdated);
    }
    if (type === "sync" && opts.runSync && opts.req) {
      await scheduleSync({ req: opts.req, user, trigger: "manual", workspaceId, syncIdOrModel: createdOrUpdated.id });
    }
    return { id: createdOrUpdated.id, created: !existingLink };
  }

  /**
   * Update a connection (link) by its id. Unlike `upsertLink` (which resolves push links by
   * the from/to pair), this targets the exact row: it loads by `id` and rejects a `fromId`/
   * `toId` in the patch that doesn't match the existing link (moving a link = delete + create).
   * Only `data` is mutable here.
   */
  async updateLink(
    user: SessionUser,
    workspaceId: string,
    id: string,
    patch: { fromId?: string; toId?: string; type?: string; data?: any },
    opts: { req?: NextApiRequest } = {}
  ): Promise<{ id: string; updated: boolean }> {
    await verifyAccessWithRole(user, workspaceId, "editEntities");
    const existing = await this.prisma.configurationObjectLink.findFirst({
      where: { workspaceId, id, deleted: false },
    });
    if (!existing) {
      throw new ApiError(`connection with id ${id} does not exist`, { status: 404 });
    }
    if (patch.fromId && patch.fromId !== existing.fromId) {
      throw new ApiError(`fromId '${patch.fromId}' does not match connection ${id}`, { status: 400 });
    }
    if (patch.toId && patch.toId !== existing.toId) {
      throw new ApiError(`toId '${patch.toId}' does not match connection ${id}`, { status: 400 });
    }
    // A link's type is immutable (push↔sync changes the from/to semantics — that's a
    // delete + create). Reject a mismatched patch.type rather than validate against one
    // type and persist another.
    const type = existing.type ?? "push";
    if (patch.type && patch.type !== type) {
      throw new ApiError(`connection ${id} is '${type}'; its type can't be changed to '${patch.type}'`, {
        status: 400,
      });
    }
    const data = patch.data !== undefined ? patch.data : existing.data;
    if (type === "sync" && data) {
      try {
        validateSyncSchedule(data);
      } catch (e: any) {
        throw new ApiError(e.message, { status: 400 });
      }
    }
    await this.validateLinkData(workspaceId, type, existing.toId, data);
    const updated = await this.prisma.configurationObjectLink.update({ where: { id: existing.id }, data: { data } });
    await configObjectAuditLog(
      user,
      workspaceId,
      updated.id,
      "link",
      "update",
      { prevVersion: existing, newVersion: updated },
      opts.req
    );
    return { id: updated.id, updated: true };
  }

  /** Validate connection `data` against the destination's connection options / sync schema. No-op if undefined. */
  private async validateLinkData(workspaceId: string, type: string, toId: string, data: any): Promise<void> {
    if (data === undefined) return;
    if (type === "sync") {
      const parseResult = SyncOptionsType.safeParse(data);
      if (!parseResult.success) {
        throw new ApiError(`Invalid sync options: ${parseResult.error.message}`, {
          status: 400,
          responseObject: { zodError: parseResult.error },
        });
      }
      return;
    }
    const destination = await this.prisma.configurationObject.findFirst({
      where: { workspaceId, id: toId, type: "destination", deleted: false },
    });
    if (destination) {
      const destinationType = getCoreDestinationTypeNonStrict((destination.config as any)?.["destinationType"]);
      if (destinationType?.connectionOptions) {
        const parseResult = destinationType.connectionOptions.safeParse(data);
        if (!parseResult.success) {
          throw new ApiError(
            `Invalid connection options for ${(destination.config as any)?.["destinationType"]}: ${
              parseResult.error.message
            }`,
            { status: 400, responseObject: { zodError: parseResult.error } }
          );
        }
      }
    }
  }

  /** Backs `config/link.ts` DELETE. Delete by `id`, or by `fromId`+`toId`. */
  async deleteLink(
    user: SessionUser,
    workspaceId: string,
    sel: LinkSelector,
    opts: { req?: NextApiRequest } = {}
  ): Promise<{ deleted: boolean }> {
    const { id, fromId, toId } = sel;
    await verifyAccessWithRole(user, workspaceId, "deleteEntities");
    if (id) {
      if (fromId || toId) {
        throw new ApiError("You can't specify 'fromId' or 'toId' with 'id'", { status: 400 });
      }
      // Read-then-update: prisma `update` throws when no row matches, so a missing id would
      // error instead of reporting deleted:false. Look it up first.
      const existing = await this.prisma.configurationObjectLink.findFirst({
        where: { workspaceId, id, deleted: false },
      });
      if (!existing) {
        return { deleted: false };
      }
      await this.prisma.configurationObjectLink.update({ where: { id: existing.id }, data: { deleted: true } });
      await configObjectAuditLog(user, workspaceId, existing.id, "link", "delete", { prevVersion: existing }, opts.req);
      await this.emitConnectionEvent(user, workspaceId, opts.req, "connection_deleted", existing);
      return { deleted: true };
    } else if (fromId && toId) {
      const updatedLinks = await this.prisma.configurationObjectLink.updateManyAndReturn({
        where: { workspaceId, toId, fromId, deleted: false },
        data: { deleted: true },
      });
      for (const updatedLink of updatedLinks) {
        await configObjectAuditLog(
          user,
          workspaceId,
          updatedLink.id,
          "link",
          "delete",
          { prevVersion: updatedLink },
          opts.req
        );
        await this.emitConnectionEvent(user, workspaceId, opts.req, "connection_deleted", updatedLink);
      }
      return { deleted: updatedLinks.length > 0 };
    }
    return { deleted: false };
  }
}
