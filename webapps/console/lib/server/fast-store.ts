import Redis from "ioredis";
import { StreamConfig } from "../schema";
import { DatabaseConnection, db, Handler } from "./db";
import { omit, pick } from "lodash";
import { randomId, requireDefined, stopwatch } from "juava";
import { z } from "zod";
import { ConfigurationObjectDbModel, ConfigurationObjectLinkDbModel, WorkspaceDbModel } from "../../prisma/schema";
import { zParse } from "../shared/zod";
import { BaseBulkerConnectionOptions, DestinationType, getCoreDestinationType } from "../schema/destinations";
import { redis } from "./redis";
import { getServerLog } from "./log";
import hash from "object-hash";
import { IngestType } from "@jitsu/protocols/async-request";

type RedisKey = { tmp(): string; used(): boolean; rename(redis: Redis): Promise<void>; name(): string };

function redisKey(name: string): RedisKey {
  let tmp: string | undefined = undefined;
  return {
    tmp: () => (tmp ? tmp : (tmp = `${name}_tmp_${randomId()}`)),
    rename: async (redis: Redis) => {
      if (tmp) {
        await redis.rename(tmp, name);
      }
    },
    used() {
      return !!tmp;
    },
    name: () => name,
  };
}

/**
 * Redis map:
 *  * config:links   - ${connectionId} -> ConfigurationObjectLinkDbModel
 *  * config:${type} - ${objectId} -> ConfigurationObjectDbModel
 *     * config:stream      - ${streamId} -> StreamConfig
 *     * config:destination - ${destinationId} -> DestinationConfig
 *
 */

const redisKeyRoutes = {
  configurationObjectsLink: () => redisKey(`config:links`),
  configurationObject: (type: string) => redisKey(`config:${type}`),
  streamIds: () => redisKey(`streamIds`),
  apiKeys: () => redisKey(`apiKeys`),
  streamDomain: () => redisKey(`streamDomains`),
  enrichedConnections: () => redisKey(`enrichedConnections`),
};

/**
 * Shortened destination config for that is saved to store. It contains only information needed
 * to serve destination on the edge.
 *
 * See {@link DestinationConfig} for full destination config.
 */
export type ShortDestinationConfig = SyncShortDestinationConfig | AsyncShortDestinationConfig;

export type CommonShortDestinationConfig = {
  id: string;
  connectionId: string;
  destinationType: string;
  credentials: any;
  options: BaseBulkerConnectionOptions;
};

export type SyncShortDestinationConfig = { isSynchronous: true } & CommonShortDestinationConfig;

export type AsyncShortDestinationConfig = { isSynchronous: false } & CommonShortDestinationConfig;

export type StreamWithDestinations = {
  stream: StreamConfig;
  backupEnabled: boolean;
  synchronousDestinations: ShortDestinationConfig[];
  asynchronousDestinations: ShortDestinationConfig[];
};

export type EnrichedConnectionConfig = {
  id: string;
  workspaceId: string;
  updatedAt: Date;
  destinationId: string;
  streamId: string;
  metricsKeyPrefix: string;
  usesBulker: boolean;
  //destinationType
  type: string;
  options: BaseBulkerConnectionOptions;

  credentials: {
    [key: string]: any;
  };
  credentialsHash: string;
};

type ConfigurationObjectLinkDbModel = z.infer<typeof ConfigurationObjectLinkDbModel>;

type ApiKeyBinding = { hash: string; keyType: IngestType; streamId: string };

export type FastStore = {
  getStreamsByDomain: (domain: string) => Promise<StreamWithDestinations[] | undefined>;
  getStreamById: (slug: string) => Promise<StreamWithDestinations | undefined>;
  getStreamByKeyId: (keyId: string) => Promise<ApiKeyBinding | undefined>;
  getConfig: <T>(type: string, id: string) => Promise<T | undefined>;
  getConnection: (id: string) => Promise<ConfigurationObjectLinkDbModel | undefined>;
  getEnrichedConnection: (id: string) => Promise<EnrichedConnectionConfig | undefined>;

  fullRefresh();
};

export type ConfigObjectHandler = {
  onObject(opts: {
    obj: z.infer<typeof ConfigurationObjectDbModel>;
    workspace: z.infer<typeof WorkspaceDbModel>;
  }): Promise<void>;
  end(hasData: boolean): Promise<void>;
  [k: string]: any;
};

function flatten(obj: z.infer<typeof ConfigurationObjectDbModel>) {
  return {
    ...((obj.config as any) || {}),
    ...omit(obj, "config"),
  };
}

function createDefaultHandler(type: string): ConfigObjectHandler {
  const configTmpKey = redisKeyRoutes.configurationObject(type) + `_tmp_${randomId()}`;
  return {
    async onObject({ obj }) {
      const serialisedObject = JSON.stringify(flatten(obj));
      await redis().hset(configTmpKey, obj.id, serialisedObject);
    },
    async end(hasData) {
      if (hasData) {
        await redis().rename(configTmpKey, `config:${type}`);
      }
    },
  };
}

function prefixedWith(row: Record<string, any>, pefix: string): Record<string, any> {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([k]) => k.indexOf(pefix) === 0)
      .map(([k, v]) => [k.substring(pefix.length), v])
  );
}

async function selectConfigObjectRows(type: string, db: DatabaseConnection, handler: Handler) {
  return db.pgHelper().streamQuery(
    `SELECT
            obj.id as "obj_id",
            obj."workspaceId" as "obj_workspaceId",
            obj."type" as "obj_type",
            obj."config" as "obj_config",
            obj."createdAt" as "obj_createdAt",
            obj."updatedAt" as "obj_updatedAt",
            workspace.id as "workspace_id",
            workspace.name as "workspace_name",
            workspace."slug" as "workspace_slug",
            workspace."createdAt" as "workspace_createdAt",
            workspace."updatedAt" as "workspace_updatedAt",
            workspace."deleted" as "workspace_deleted"
         FROM "ConfigurationObject" obj
         join "Workspace" workspace on obj."workspaceId" = workspace.id
         WHERE workspace."deleted" = false AND
            obj."type" = :type AND
            obj."deleted" = false`,
    { type },
    handler
  );
}

async function saveConfigObjectsToRedis(types: string[], db: DatabaseConnection) {
  for (const type of types) {
    const handlers = [createDefaultHandler(type)];
    const { rows } = await selectConfigObjectRows(type, db, async row => {
      const obj = ConfigurationObjectDbModel.parse(prefixedWith(row, "obj_"));
      const workspace = WorkspaceDbModel.parse(prefixedWith(row, "workspace_"));
      await Promise.all(handlers.map(h => h.onObject({ obj, workspace })));
    });
    await Promise.all(handlers.map(h => h.end(rows > 0)));
  }
}

function createDestinationConfig(type: DestinationType, row: any): ShortDestinationConfig {
  return {
    id: row.toId,
    isSynchronous: !!type.isSynchronous,
    destinationType: type.id,
    credentials: omit(row.dstConfig, "name", "type", "destinationType"),
    connectionId: row.id,
    options: row.connectionData as BaseBulkerConnectionOptions,
  } as ShortDestinationConfig;
}

export function createEnrichedConnectionConfig(
  connectionData: ConfigurationObjectLinkDbModel,
  destinationConfig: ShortDestinationConfig,
  src: StreamConfig,
  usesBulker: boolean
): EnrichedConnectionConfig {
  return {
    id: connectionData.id,
    workspaceId: connectionData.workspaceId,
    destinationId: destinationConfig.id,
    streamId: src.id,
    metricsKeyPrefix: connectionData.workspaceId,
    usesBulker: usesBulker,
    type: destinationConfig.destinationType,
    options: destinationConfig.options,
    updatedAt: connectionData.updatedAt,
    credentials: destinationConfig.credentials,
    credentialsHash: hash(destinationConfig.credentials),
  };
}

function createStreamWithDestinations(
  streamConfig: StreamConfig,
  destinations: ShortDestinationConfig[],
  backupEnabled: boolean
): StreamWithDestinations {
  return {
    stream: streamConfig,
    backupEnabled: backupEnabled,
    asynchronousDestinations: destinations.filter(d => !getCoreDestinationType(d.destinationType).isSynchronous),
    synchronousDestinations: destinations.filter(d => getCoreDestinationType(d.destinationType).isSynchronous),
  };
}

async function saveConnectionsToRedis(db: DatabaseConnection) {
  const backupSupported = process.env.S3_REGION && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY;
  const bulkerRedisKey = redisKeyRoutes.enrichedConnections();
  const domainsRedisKey = redisKeyRoutes.streamDomain();
  const idsRedisKey = redisKeyRoutes.streamIds();
  const apiKeys = redisKeyRoutes.apiKeys();
  const linksKey = redisKeyRoutes.configurationObjectsLink();
  const query = `    
  select
      greatest(link."updatedAt", src."updatedAt", dst."updatedAt") as "updatedAt",
      link."createdAt" as "createdAt",
      ws.id as "workspaceId",
      link."id" as "id",
      link.data as "connectionData",
      src.id as "fromId",
      src."config" as "srcConfig",
    dst.id as "toId",
      dst."config" as "dstConfig",
     true as "backupEnabled"
    from "ConfigurationObjectLink" link
    join "ConfigurationObject" src on link."fromId" = src.id
    join "ConfigurationObject" dst on link."toId" = dst.id
    join "Workspace" ws on link."workspaceId" = ws.id
    where link.deleted = false and 
        src."type" in ('stream', 'service') and 
          src."deleted" = false and 
          dst.type='destination' and
          dst."deleted" = false and 
          ws."deleted" = false and src."workspaceId" = link."workspaceId" and src."workspaceId" = link."workspaceId"
    order by "fromId", "toId"      
    `;
  let destinationsBuffer: ShortDestinationConfig[] = [];
  let lastStreamConfig: StreamConfig | undefined = undefined;
  let lastBackupEnabled: boolean = false;
  let streamsByDomain: Record<string, Record<string, StreamWithDestinations>> = {};
  const noDomainKey = "no-domain";
  const addStreamByDomain = (
    streamConfig: StreamConfig,
    destinationsBuffer: ShortDestinationConfig[],
    backupEnabled: boolean
  ) => {
    for (const domain of streamConfig.domains?.length ? streamConfig.domains : [noDomainKey]) {
      let streams = streamsByDomain[domain.toLowerCase()];
      const stream = createStreamWithDestinations(streamConfig, destinationsBuffer, backupEnabled);
      streams = streams ? { ...streams, [stream.stream.id]: stream } : { [stream.stream.id]: stream };
      streamsByDomain[domain.toLowerCase()] = streams;
    }
  };
  //to make sure we have all the streams in redis (even with no destinations) fill the buffer with all the streams first
  await selectConfigObjectRows("stream", db, async row => {
    const obj = ConfigurationObjectDbModel.parse(prefixedWith(row, "obj_"));
    const streamConfig = flatten(obj);
    addStreamByDomain(streamConfig, [], row.backupEnabled);
  });
  await db.pgHelper().streamQuery(query, async row => {
    const workspaceId = row.workspaceId;
    const linkId = row.id;
    const destinationType = requireDefined(
      getCoreDestinationType(row.dstConfig.destinationType),
      `Unknown destination type ${row.dstConfig.destinationType}`
    );
    const destinationConfig = createDestinationConfig(destinationType, row);
    const streamConfig = zParse(StreamConfig, { workspaceId, id: row.fromId, type: "stream", ...row.srcConfig });
    const backupDestCreated: Record<string, boolean> = {};

    const allConnectionParameters: ConfigurationObjectLinkDbModel = {
      deleted: false,
      id: linkId,
      workspaceId,
      ...pick(row, "createdAt", "updatedAt", "fromId", "toId"),
      data: row.connectionData,
    };

    redis().hset(linksKey.tmp(), linkId, JSON.stringify(allConnectionParameters));

    await redis().hset(
      bulkerRedisKey.tmp(),
      linkId,
      JSON.stringify(
        createEnrichedConnectionConfig(
          allConnectionParameters,
          destinationConfig,
          streamConfig,
          !!destinationType.usesBulker
        )
      )
    );

    if (backupSupported && row.backupEnabled && !backupDestCreated[row.workspaceId]) {
      const backupConn: EnrichedConnectionConfig = {
        id: `${row.workspaceId}_backup`,
        workspaceId: row.workspaceId,
        destinationId: `${row.workspaceId}_backup`,
        streamId: "backup",
        metricsKeyPrefix: row.workspaceId,
        usesBulker: true,
        type: "s3",
        options: {
          dataLayout: "segment-single-table",
          deduplicate: false,
          primaryKey: "",
          timestampColumn: "",
          frequency: 60,
          batchSize: 1_000_000,
          mode: "batch",
        },
        updatedAt: new Date(),
        credentials: {
          region: process.env.S3_REGION,
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          bucket: `${workspaceId}.data.use.jitsu.com`,
          compression: "gzip",
          format: "ndjson",
          folder: "[DATE]",
        },
        credentialsHash: "",
      };
      await redis().hset(bulkerRedisKey.tmp(), `${row.workspaceId}_backup`, JSON.stringify(backupConn));
      backupDestCreated[row.workspaceId] = true;
    }

    // when we reach new stream, we need to save destinationsBuffer for the previous stream
    if (lastStreamConfig && streamConfig.id !== lastStreamConfig.id && destinationsBuffer.length > 0) {
      addStreamByDomain(lastStreamConfig, destinationsBuffer, row.backupEnabled);
      destinationsBuffer = [];
    }
    destinationsBuffer.push(destinationConfig);
    lastStreamConfig = streamConfig;
    lastBackupEnabled = row.backupEnabled;
  });

  // save the last stream
  if (lastStreamConfig && destinationsBuffer.length > 0) {
    addStreamByDomain(lastStreamConfig, destinationsBuffer, lastBackupEnabled);
  }
  const apiKeysTmp = apiKeys.tmp();
  for (const [domain, streamDsts] of Object.entries(streamsByDomain)) {
    //store array of StreamWithDestinations by domain
    await redis().hset(domainsRedisKey.tmp(), domain.toLowerCase(), JSON.stringify(Object.values(streamDsts)));

    for (const id in streamDsts) {
      const strm = streamDsts[id];
      //store each StreamWithDestinations by stream id separately
      await redis().hset(idsRedisKey.tmp(), id, JSON.stringify(strm));

      await Promise.all(
        (strm.stream.publicKeys ?? [])
          .filter(k => !!k.hash)
          .map(k =>
            redis().hset(apiKeysTmp, k.id, JSON.stringify({ hash: k.hash as string, streamId: id, keyType: "browser" }))
          )
      );
      await Promise.all(
        (strm.stream.privateKeys ?? [])
          .filter(k => !!k.hash)
          .map(k =>
            redis().hset(apiKeysTmp, k.id, JSON.stringify({ hash: k.hash as string, streamId: id, keyType: "s2s" }))
          )
      );
    }
  }

  await apiKeys.rename(redis());
  await idsRedisKey.rename(redis());
  await linksKey.rename(redis());
  await domainsRedisKey.rename(redis());
  await bulkerRedisKey.rename(redis());
}

export function createFastStore({ db }: { db: DatabaseConnection }): FastStore {
  return {
    getStreamByKeyId(keyId: string): Promise<ApiKeyBinding | undefined> {
      return redis()
        .hget(redisKeyRoutes.apiKeys().name(), keyId)
        .then(raw => (raw ? JSON.parse(raw) : undefined));
    },
    async getStreamById(slug: string): Promise<StreamWithDestinations | undefined> {
      const raw = await redis().hget(redisKeyRoutes.streamIds().name(), slug);
      if (!raw) {
        return undefined;
      }
      return JSON.parse(raw);
    },
    async getStreamsByDomain(domain: string): Promise<StreamWithDestinations[] | undefined> {
      const raw = await redis().hget(redisKeyRoutes.streamDomain().name(), domain.toLowerCase());
      if (!raw) {
        return undefined;
      }
      return JSON.parse(raw);
    },
    async getConfig<T>(type: string, id: string): Promise<T | undefined> {
      const config = await redis().hget(redisKeyRoutes.configurationObject(type).name(), id);
      return config ? JSON.parse(config) : undefined;
    },
    async getConnection(id: string): Promise<ConfigurationObjectLinkDbModel | undefined> {
      const config = await redis().hget(redisKeyRoutes.configurationObjectsLink().name(), id);
      return config ? JSON.parse(config) : undefined;
    },
    async getEnrichedConnection(id: string): Promise<EnrichedConnectionConfig | undefined> {
      const config = await redis().hget(redisKeyRoutes.enrichedConnections().name(), id);
      return config ? JSON.parse(config) : undefined;
    },
    async fullRefresh() {
      const sw = stopwatch();
      await saveConfigObjectsToRedis(["stream", "destination", "function"], db);
      await saveConnectionsToRedis(db);
      getServerLog().atInfo().log("Export to redis took", sw.elapsedPretty());
    },
  };
}

export const fastStore = createFastStore({ db });
