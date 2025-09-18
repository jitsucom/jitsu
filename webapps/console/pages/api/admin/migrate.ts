import { createRoute, verifyAdmin } from "../../../lib/api";
import { PrismaSSLMode, db } from "../../../lib/server/db";
import { Pool } from "pg";
import { hash, hideSensitiveInfo, requireDefined } from "juava";
import { getServerLog } from "../../../lib/server/log";
import { userProjects, workspaces, usersInfo } from "./migrate-data";
import {
  destinationMappings,
  mapClassicFunction,
  mapWebhookPayload,
  sourceMappings,
  TableFunctionCode,
} from "./migrate-mappings";
import { getCoreDestinationType } from "../../../lib/schema/destinations";
import { z } from "zod";

const log = getServerLog("migrate");

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      fromId: z.string(),
      toId: z.string().optional(),
    }),
  })
  .handler(async ({ req, res, query, user }) => {
    await verifyAdmin(user);

    const legacyPg = createLegacyPg();
    const projects: Record<string, any> = {};
    const apiKeys: Record<string, any> = {};
    const sources: Record<string, any> = {};
    const destinations: Record<string, any> = {};
    const customDomains: Record<string, any> = {};
    const projectUsers: Record<string, any> = {};
    let rows = await legacyPg.query("SELECT * from telemetry.jitsu_configs_projects");
    for (const row of rows.rows) {
      projects[row.redis_hash] = row;
    }
    rows = await legacyPg.query("SELECT * from telemetry.jitsu_configs_api_keys");
    for (const row of rows.rows) {
      apiKeys[row.redis_hash] = row;
    }
    rows = await legacyPg.query("SELECT * from telemetry.jitsu_configs_sources");
    for (const row of rows.rows) {
      sources[row.redis_hash] = row;
    }
    rows = await legacyPg.query("SELECT * from telemetry.jitsu_configs_destinations");
    for (const row of rows.rows) {
      destinations[row.redis_hash] = row;
    }
    rows = await legacyPg.query("SELECT * from telemetry.jitsu_configs_custom_domains");
    for (const row of rows.rows) {
      customDomains[row.redis_hash] = row;
    }
    for (const uid in userProjects) {
      const projectIds = userProjects[uid];
      for (const projectId of projectIds) {
        projectUsers[projectId] = projectUsers[projectId] || [];
        projectUsers[projectId].push(uid);
      }
    }

    const workspaceId = query.fromId;
    const workspace = workspaces[workspaceId];
    const project = projects[workspaceId];
    const keys = apiKeys[workspaceId] || [];
    const dsts = destinations[workspaceId] || [];
    const srcs = sources[workspaceId] || [];
    const userIds = projectUsers[workspaceId] || [];
    const doms = customDomains[workspaceId] || [];
    const u: any[] = [];
    log.atInfo().log(`Migrating workspace ${workspace.name} User IDs: ${userIds}`);
    for (const userId of userIds) {
      const user = usersInfo[userId];
      if (!user) {
        log.atError().log(`User ${userId} not found`);
        // return {
        //   status: "error",
        //   message: `User ${userId} not found`,
        // };
      } else {
        u.push(user);
      }
    }

    const w = {
      id: workspaceId,
      toId: query.toId || workspaceId,
      ...workspace,
      project,
      keys: keys.keys ? JSON.parse(keys.keys) : [],
      destinations: dsts.destinations ? JSON.parse(dsts.destinations) : [],
      sources: srcs.sources ? JSON.parse(srcs.sources) : [],
      domains: doms.domains ? JSON.parse(doms.domains) : [],
      users: u,
    };
    await migrateWorkspace(w);

    return {
      status: "success",
      workspace: w,
    };
  })
  .toNextApiHandler();

type Workspace = {
  id: string;
  toId: string;
  name: string;
  status: string;
  project: any;
  keys: any[];
  destinations: any[];
  sources: any[];
  domains: any[];
  users: any[];
};

async function migrateWorkspace(workspace: Workspace) {
  log.atInfo().log(`Migrating workspace ${workspace.id} ${workspace.name} to ${workspace.toId} ...`);
  const existingWorkspace = await db.prisma().workspace.findUnique({ where: { id: workspace.toId } });
  if (!existingWorkspace) {
    const slug = workspace.project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") + "-classic";
    const workspaceData = {
      id: workspace.toId,
      name: workspace.project.name,
      slug,
      featuresEnabled: ["misc"],
    };
    await db.prisma().workspace.upsert({
      where: {
        id: workspace.toId,
      },
      create: workspaceData,
      update: workspaceData,
    });
    log.atInfo().log(`Workspace created.`);
  } else {
    log.atInfo().log(`Workspace ${workspace.toId} already exists. Slug: ${existingWorkspace.slug}`);
  }
  log.atInfo().log(`Migrating users...`);
  for (const user of workspace.users) {
    log.atInfo().log(`Migrating user id: ${user._uid} name: ${user._name} email: ${user._email}`);
    let userId = user._uid;
    const existingUser = await db.prisma().userProfile.findFirst({
      where: {
        email: user._email,
        externalId: user._uid,
      },
    });
    if (existingUser) {
      log.atInfo().log(`Found user with such email: ${JSON.stringify(existingUser)}`);
      userId = existingUser.id;
    } else {
      const userData = {
        id: user._uid,
        name: user._name || user._email || user._uid,
        email: user._email,
        loginProvider: "firebase",
        externalId: user._uid,
      };
      await db.prisma().userProfile.upsert({
        where: {
          id: user._uid,
        },
        create: userData,
        update: userData,
      });
    }
    const workspaceAccess = { userId: userId, workspaceId: workspace.toId };
    await db.prisma().workspaceAccess.upsert({
      where: {
        userId_workspaceId: workspaceAccess,
      },
      create: workspaceAccess,
      update: workspaceAccess,
    });
    log.atInfo().log(`Done.`);
  }

  if (workspace.project.notifications_slack_url) {
    log.atInfo().log(`Migrating Notification Settings...`);
    const slackConfig = {
      slackWebhookUrl: workspace.project.notifications_slack_url,
      events: ["all"],
      channel: "slack",
    };
    await createConfigurationObject(
      workspace,
      "notification",
      workspace.toId + "-slack",
      "Slack Notifications",
      slackConfig
    );
    log.atInfo().log(`Done.`);
  }

  log.atInfo().log(`Migrating API keys...`);
  let classicMapping = "";
  for (const key of workspace.keys) {
    log.atInfo().log(`Migrating Api-Key ${key.comment || key.uid}`);
    const id = key.uid.replace(/[^a-z0-9-]/g, "-");
    await createConfigurationObject(workspace, "stream", id, key.comment || key.uid, { strict: true });
    classicMapping += `# ${key.comment || key.uid}\n${id}=${key.jsAuth}\n${id}=${key.serverAuth}\n`;
    log.atInfo().log(`Done.`);
  }
  if (classicMapping) {
    log.atInfo().log(`Classic mapping for workspace ${workspace.toId}`);
    const cmConfig = {
      objectType: "classic-mapping",
      value: classicMapping,
    };
    await createConfigurationObject(workspace, "misc", workspace.toId + "-cm", "Classic API Keys Mapping", cmConfig);
    log.atInfo().log(`Done.`);
  }
  log.atInfo().log(`Migrating Domains ...`);
  for (const domain of workspace.domains) {
    log.atInfo().log(`Migrating domain ${domain.name}`);
    const id = workspace.toId + "-" + hash("md5", domain.name);
    await createConfigurationObject(workspace, "domain", id, domain.name, {});
    log.atInfo().log(`Done.`);
  }

  log.atInfo().log(`Migrating Destinations ...`);
  for (const dst of workspace.destinations) {
    const name = dst.displayName || dst._id;
    const dstId = workspace.toId + "_" + hash("md5", dst._uid || dst._id).substring(0, 6);
    log.atInfo().log(`Migrating destination ${name} id: ${dstId}`);
    const mappedConfig = destinationMappings[dst._type];
    if (!mappedConfig) {
      throw new Error(`No mapping found for destination type ${dst._type}`);
    }
    if (mappedConfig === "skip") {
      log.atWarn().log(`Skipping destination ${name} id: ${dstId} of type ${dst._type}. Not supported.`);
      continue;
    }
    const dstType = getCoreDestinationType(mappedConfig.type || dst._type);
    const cfg = mappedConfig.credentialsFunc(dst._formData);
    if (!cfg) {
      log.atWarn().log(`Skipping destination ${name} id: ${dstId} of type ${dst._type}. Not supported.`);
      continue;
    }
    const destinationConfig = {
      destinationType: dstType.id,
      ...cfg,
    };
    await createConfigurationObject(workspace, "destination", dstId, name, destinationConfig);
    let skipConnections = false;
    if (dst._mappings?._mappings && dst._mappings?._mappings.length) {
      console.error(`Mappings are not supported. Skipping connections`);
      skipConnections = true;
    }
    if (dst._enrichment) {
      console.error(`Enrichments are not supported. Skipping connections`);
      skipConnections = true;
    }
    let tableNameFunctionCreated = false;
    if (!skipConnections) {
      for (let src of dst._onlyKeys) {
        src = src.replace(/[^a-z0-9-]/g, "-");
        const apiKey = workspace.keys.find(k => k.uid === src);

        log.atInfo().log(`Connecting Destination ${name} id: ${dstId} to Site ${src}`);
        let data: any = {
          functions: [],
        };
        if (
          (dst._transform_enabled || dstType.id === "facebook-conversions" || dstType.id === "amplitude") &&
          dst._transform
        ) {
          await createFunction(
            workspace,
            dstId + "_transform",
            `${name} Transform`,
            mappedConfig.transformFunc ? mappedConfig.transformFunc(dst._transform) : mapClassicFunction(dst._transform)
          );
          data.functions.push({
            functionId: "udf." + dstId + "_transform",
          });
        }
        if (dstType.usesBulker) {
          if (!tableNameFunctionCreated) {
            await createFunction(workspace, workspace.toId + "_tablename", "Table Name Function", TableFunctionCode);
            tableNameFunctionCreated = true;
          }
          data.dataLayout = "jitsu-legacy";
          data.mode = dstType.id === "bigquery" ? "batch" : dst._formData.mode || "batch";
          data.deduplicate = true;
          if (dst._formData.tableName !== "events") {
            data.functions.push({
              functionId: "udf." + workspace.toId + "_tablename",
            });
            data.functionsEnv = {
              TABLE_NAME: dst._formData.tableName || "events",
            };
          }
          data.primaryKey = dstType.id === "clickhouse" ? "_timestamp,eventn_ctx_event_id" : "eventn_ctx_event_id";
          data.deduplicateWindow = 31;
          data.batchSize = 100000;
          data.keepOriginalNames = true;
          data.frequency =
            dstType.id === "bigquery" && dst._formData.mode === "stream" ? 1 : apiKey?.batchPeriodMin || 5;
          data.timestampColumn = "_timestamp";
          if (dst._users_recognition?._enabled) {
            if (Object.keys(dst._users_recognition).length > 1) {
              console.error(
                `Users recognition custom parameters are not supported: ${JSON.stringify(
                  dst._users_recognition
                )}. Skipping`
              );
              continue;
            }
            data.functions.push({
              functionId: "builtin.transformation.user-recognition",
            });
          }
        } else if (dstType.id === "webhook") {
          await createFunction(workspace, dstId + "_webhook", `${name} Payload`, mapWebhookPayload(dst._formData.body));
          data.functions.push({
            functionId: "udf." + dstId + "_webhook",
          });
        }

        data = dstType.connectionOptions.parse(data);
        log.atInfo().log(`Connection data: ${JSON.stringify(data)}`);
        await createConfigurationObjectLink(workspace, src, dstId, "push", data);
        log.atInfo().log(`Done.`);
      }
    }
  }

  log.atInfo().log(`Migrating Sources ...`);
  for (const src of workspace.sources) {
    const srcId = workspace.toId + "-" + hash("md5", src.sourceId);
    log.atInfo().log(`Migrating source ${src.displayName} id: ${src.sourceId}`);
    const mappingKey = src.sourceType === "singer" ? src.sourceProtoType : src.sourceType;
    const mapping = sourceMappings[mappingKey];
    if (!mapping) {
      throw new Error(`No mapping found for source type ${src.sourceProtoType}`);
    }
    if (mapping === "skip") {
      log.atWarn().log(`Skipping source ${src.displayName} id: ${src.sourceId} of type ${mappingKey}. Not supported.`);
      continue;
    }
    const mappingData = mapping(src);

    const serviceConfig = {
      package: mappingData.package,
      version: mappingData.version,
      protocol: "airbyte",
      credentials: mappingData.credentials,
    };
    await createConfigurationObject(workspace, "service", srcId, src.displayName || src.sourceId, serviceConfig);
    for (let dst of src.destinations) {
      const dstId = workspace.toId + "_" + hash("md5", dst).substring(0, 6);
      log.atInfo().log(`Connecting Source ${src.displayName} id: ${src.sourceId} to Destination ${dstId}`);
      const data: any = {
        namespace: "",
        addMeta: true,
        streams: mappingData.streams,
      };
      await createConfigurationObjectLink(workspace, srcId, dstId, "sync", data);
    }
    log.atInfo().log(`Done.`);
  }
}

async function createFunction(workspace: Workspace, id: string, name: string, code: string) {
  await createConfigurationObject(workspace, "function", id, name, { code });
}

async function createConfigurationObject(workspace: Workspace, type: string, id: string, name: string, config: any) {
  const data = {
    id,
    type: type,
    workspaceId: workspace.toId,
    config: {
      name,
      type,
      ...config,
    },
  };
  await db.prisma().configurationObject.upsert({
    where: {
      id,
    },
    create: data,
    update: data,
  });
}

async function createConfigurationObjectLink(
  workspace: Workspace,
  fromId: string,
  toId: string,
  type: string,
  data: any
) {
  const id = `${workspace.toId}-${fromId.substring(fromId.length - 6)}-${toId.substring(toId.length - 6)}`;
  const connection = {
    id,
    type,
    workspaceId: workspace.toId,
    fromId,
    toId,
    data,
  };
  await db.prisma().configurationObjectLink.upsert({
    where: {
      id,
    },
    create: connection,
    update: connection,
  });
}

function createLegacyPg(): Pool {
  const connectionUrl = process.env.LEGACY_DATABASE_URL ?? "";
  const parsedUrl = new URL(connectionUrl);
  const schema = parsedUrl.searchParams.get("schema");
  const sslMode = parsedUrl.searchParams.get("sslmode") || ("disable" as PrismaSSLMode);
  if (sslMode === "require" || sslMode === "prefer") {
    throw new Error(`sslmode=${sslMode} is not supported`);
  }

  const pool = new Pool({
    max: 20,
    idleTimeoutMillis: 600000,
    connectionString: requireDefined(process.env.LEGACY_DATABASE_URL, "env.LEGACY_DATABASE_URL is not defined"),
    ssl: sslMode === "no-verify" ? { rejectUnauthorized: false } : undefined,
    application_name: (parsedUrl.searchParams.get("application_name") || "console") + "-raw-pg",
  });
  pool.on("connect", async client => {
    log
      .atInfo()
      .log(
        `Connecting new client ${hideSensitiveInfo(connectionUrl)}. Pool stat: idle=${pool.idleCount}, waiting=${
          pool.waitingCount
        }, total=${pool.totalCount}` + (schema ? `. Default schema: ${schema}` : "")
      );
  });
  pool.on("error", error => {
    log.atError().withCause(error).log("Pool error");
  });
  return pool;
}
