import { createRoute, verifyAdmin } from "../../../lib/api";
import { clickhouse, dateToClickhouse } from "../../../lib/server/clickhouse";
import { db } from "../../../lib/server/db";
import { getServerLog } from "../../../lib/server/log";
import { NotificationStateDbModel, StatusChangeDbModel } from "../../../prisma/schema";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { rpc, stopwatch } from "juava";
import { getAppEndpoint, PublicEndpoint } from "../../../lib/domains";
import { NotificationChannel } from "../../../lib/schema";
import omit from "lodash/omit";
import { createJwt, getEeConnection } from "../../../lib/server/ee";

dayjs.extend(utc);

const log = getServerLog("notifications");

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

type StatusChange = Omit<z.infer<typeof StatusChangeDbModel>, "id"> & { id?: bigint };

type NotificationState = z.infer<typeof NotificationStateDbModel>;

type Status = "SUCCESS" | "FAILED" | "FLAPPING";

const flappingWindowHours = 2;

const flappingThreshold = 4;

const adminChannel: NotificationChannel = {
  id: "admin",
  name: "Admin",
  type: "notification",
  workspaceId: "admin",
  channel: "slack",
  slackWebhookUrl: SLACK_WEBHOOK_URL,
  events: ["all"],
  recurringAlertsPeriodHours: 24,
};

type StatusChangeEntity = StatusChange & {
  id: number | bigint;
  type: "batch" | "sync";
  workspaceName: string;
  slug: string;
  fromName: string;
  toName: string;
  changesPerHours: number;
  changesPerDay: number;
};

function key(actorId: string, tableName?: string) {
  return tableName ? `${actorId}::${tableName}` : actorId;
}

function chKey(channelId: string, actorId: string, tableName?: string) {
  return tableName ? `${channelId}:${actorId}:${tableName}` : `${channelId}:${actorId}`;
}

export default createRoute()
  .GET({
    auth: true,
  })
  .handler(async ({ req, res, query, user }) => {
    await verifyAdmin(user);
    const publicEndpoints = getAppEndpoint(req);

    const currentRunTime = new Date();
    let previousRunTime = new Date();
    let processedTimestamp = new Date();
    processedTimestamp.setDate(processedTimestamp.getDate() - 1);

    let notificationsLastRun = await db.prisma().globalProps.findFirst({ where: { name: "notificationsLastRun" } });
    if (!notificationsLastRun) {
      notificationsLastRun = await db.prisma().globalProps.create({
        data: {
          name: "notificationsLastRun",
          value: { timestamp: currentRunTime, lastProcessedTimestamp: processedTimestamp },
        },
      });
    } else {
      const value = (notificationsLastRun.value as any) || {};
      if (value.timestamp) {
        previousRunTime = new Date(value.timestamp);
      }
      if (value.lastProcessedTimestamp) {
        processedTimestamp = new Date(value.lastProcessedTimestamp);
      }
    }
    log
      .atInfo()
      .log(`Previous run time: ${previousRunTime.toISOString()} Last processed timestamp: ${processedTimestamp}`);
    // add some overlap to avoid missing status changes
    previousRunTime.setMinutes(previousRunTime.getMinutes() - 10);

    const entities: Record<string, StatusChangeEntity> = {};

    // load all objects which we monitor status changes for along with their last status change
    // noinspection SqlResolve
    const r = await db.pgPool().query(`
        with last_statuses as (SELECT DISTINCT "actorId",
                                               "tableName",
                                               LAST_VALUE(id) OVER (
                                                   PARTITION BY "actorId","tableName" ORDER BY id
                                                   ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                                                   ) AS id,
                                               LAST_VALUE(status) OVER (
                                                   PARTITION BY "actorId","tableName" ORDER BY id
                                                   ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                                                   ) AS status,
                                               LAST_VALUE(description) OVER (
                                                   PARTITION BY "actorId","tableName" ORDER BY id
                                                   ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                                                   ) AS description,
                                               LAST_VALUE(timestamp) OVER (
                                                   PARTITION BY "actorId","tableName" ORDER BY id
                                                   ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
                                                   ) AS timestamp
                               FROM newjitsu."StatusChange"
                               ORDER BY "actorId", "tableName", id DESC),
             status_changes as (SELECT "actorId",
                                       "tableName",
                                       coalesce(SUM(CASE WHEN "startedAt" >= CURRENT_DATE - INTERVAL '2 hours' THEN 1 END), 0) AS "changesPerHours",
                                       coalesce(SUM(CASE WHEN "startedAt" >= CURRENT_DATE - INTERVAL '1 days' THEN 1 END), 0) AS "changesPerDay"
                                FROM newjitsu."StatusChange"
                                where "startedAt" >= CURRENT_DATE - INTERVAL '7 days'
                                group by "actorId", "tableName")

        select w.id                          as "workspaceId",
               w.slug                        as slug,
               w.name                        as "workspaceName",
               fr.config ->> 'name'          as "fromName",
               too.config ->> 'name'         as "toName",
               coalesce(sc."actorId", cl.id) as "actorId",
               REPLACE(cl.type, 'push', 'batch') as type,
               ls.id,
               ls."tableName",
               ls.timestamp,
               ls.status,
               ls.description,
               sc."changesPerHours",
               sc."changesPerDay"
        from newjitsu."ConfigurationObjectLink" cl
                 join newjitsu."Workspace" w on w.id = cl."workspaceId"
                 join newjitsu."ConfigurationObject" fr on fr.id = cl."fromId"
                 join newjitsu."ConfigurationObject" too on too.id = cl."toId"
                 left join last_statuses ls on ls."actorId" = cl.id
                 left join status_changes sc on sc."actorId" = ls."actorId" and sc."tableName" = ls."tableName"
        where ((cl.type = 'push' and data ->> 'mode' = 'batch') or cl.type = 'sync')
          and cl.deleted = 'false'
          and fr.deleted = false
          and too.deleted = false
          and w.deleted = false
    `);
    for (const row of r.rows) {
      entities[key(row.actorId)] = row;
      if (row.tableName) {
        entities[key(row.actorId, row.tableName)] = row;
      }
    }

    await loadBatchStatusesChanges(previousRunTime, entities);

    await loadSyncStatusesChanges(previousRunTime, entities);

    processedTimestamp = await processStatusChanges(processedTimestamp, entities, publicEndpoints);

    await db.prisma().globalProps.update({
      where: { id: notificationsLastRun.id },
      data: {
        name: "notificationsLastRun",
        value: { timestamp: currentRunTime, lastProcessedTimestamp: processedTimestamp },
      },
    });
  })
  .toNextApiHandler();

async function processStatusChanges(
  processedTimestamp: Date,
  entities: Record<string, StatusChangeEntity>,
  publicEndpoints: any
): Promise<Date> {
  const channels: Record<string, NotificationChannel[]> = {};
  const channelStates: Record<string, NotificationState> = {};
  await db
    .prisma()
    .configurationObject.findMany({
      where: {
        type: "notification",
        deleted: false,
      },
    })
    .then(rows => {
      for (const row of rows) {
        let channelsByWorkspace = channels[row.workspaceId];
        if (!channelsByWorkspace) {
          channelsByWorkspace = [];
          channels[row.workspaceId] = channelsByWorkspace;
        }
        channelsByWorkspace.push({ ...omit(row, "config"), ...(row.config as any) } as unknown as NotificationChannel);
      }
    });

  const states = await db.prisma().notificationState.findMany({});
  for (const state of states) {
    channelStates[chKey(state.channelId, state.actorId, state.tableName)] = state;
  }

  log.atInfo().log(`Loading changes from ${processedTimestamp.toISOString()}`);

  const statusChanges = await db.prisma().statusChange.findMany({
    where: {
      timestamp: { gt: processedTimestamp },
    },
    orderBy: [{ timestamp: "asc" }],
  });

  log.atInfo().log(`Got ${statusChanges.length} new status changes`);

  const aggrStatues: Record<string, StatusChange[]> = {};

  for (const change of statusChanges) {
    const k = key(change.actorId, change.tableName);
    const statuses = aggrStatues[k] || [];
    if (statuses.length == 0) {
      aggrStatues[k] = statuses;
    } else if (statuses[statuses.length - 1].status == "SUCCESS") {
      // we are not interested in intermediate success statuses
      statuses.pop();
    }
    statuses.push(change);
    processedTimestamp = change.timestamp;
  }

  for (const [k, statuses] of Object.entries(aggrStatues)) {
    const lastStatus = statuses[statuses.length - 1];
    const entity = entities[key(lastStatus.actorId)];
    for (const channel of [...(channels[entity.workspaceId] || []), ...(channels["admin"] || [])]) {
      if (!channel.events.includes(entity.type) && !channel.events.includes("all")) {
        continue;
      }
      const cStatuses = [...statuses];
      const chkey = chKey(channel.id, lastStatus.actorId, lastStatus.tableName);
      let state = channelStates[chkey];
      if (!state?.flappingSince) {
        if (entity.changesPerHours > flappingThreshold && lastStatus.status !== "SUCCESS") {
          log
            .atInfo()
            .log(`[${chkey}] Flapping started ${lastStatus.timestamp} Changes per hour: ${entity.changesPerHours}`);
          cStatuses.push({
            ...lastStatus,
            status: "FLAPPING",
            description: `FLAPPING: ${entity.changesPerHours} transitions from SUCCESS to FAILED within a ${flappingWindowHours}-hours window`,
          });
        } else {
          if (
            lastStatus.id === state?.statusChangeId &&
            (lastStatus.status === "SUCCESS" ||
              lastStatus.timestamp.getTime() <=
                state.lastNotification.getTime() + channel.recurringAlertsPeriodHours * 60 * 60 * 1000)
          ) {
            log.atInfo().log(`[${chkey}] No new status changes`);
            continue;
          }
        }
      } else if (entity.changesPerHours === 0) {
        log
          .atInfo()
          .log(`[${chkey}] Flapping ended ${lastStatus.timestamp} Changes per hour: ${entity.changesPerHours}`);
      } else if (
        lastStatus.timestamp.getTime() >
        state.lastNotification.getTime() + channel.recurringAlertsPeriodHours * 60 * 60 * 1000
      ) {
        log
          .atInfo()
          .log(`[${chkey}] Flapping recurring ${state.flappingSince} Changes per hour: ${entity.changesPerHours}`);
        cStatuses.push({
          ...lastStatus,
          status: "FLAPPING",
          description: `FLAPPING RECURRING: ${entity.changesPerHours} transitions from SUCCESS to FAILED within a ${flappingWindowHours}-hours window`,
        });
      } else {
        log
          .atInfo()
          .log(`[${chkey}] Flapping ongoing since ${state.flappingSince} Changes per hour: ${entity.changesPerHours}`);
        continue;
      }

      await processNotifications(channel, channelStates, cStatuses, entity, publicEndpoints);
    }
  }

  return processedTimestamp;
}

function makeNotificationState(
  channel: NotificationChannel,
  statusChange: StatusChange,
  flappingSince?: Date,
  error?: string
): NotificationState {
  return {
    workspaceId: statusChange.workspaceId,
    actorId: statusChange.actorId,
    tableName: statusChange.tableName,
    channelId: channel.id,
    lastNotification: statusChange.timestamp,
    flappingSince: flappingSince,
    statusChangeId: statusChange.id!,
    error: error ? error : "",
  };
}

async function updateNotificationState(
  channelStates: Record<string, NotificationState>,
  channel: NotificationChannel,
  lastStatus: StatusChange,
  flappingSince?: Date,
  error?: string
): Promise<NotificationState> {
  const state = makeNotificationState(channel, lastStatus, flappingSince, error);
  await db.prisma().notificationState.upsert({
    where: {
      channelId_actorId_tableName: {
        channelId: channel.id,
        actorId: lastStatus.actorId,
        tableName: lastStatus.tableName,
      },
    },
    create: state,
    update: state,
  });
  channelStates[chKey(channel.id, lastStatus.actorId, lastStatus.tableName)] = state;
  return state;
}

async function processNotifications(
  channel: NotificationChannel,
  channelStates: Record<string, NotificationState>,
  statusChanges: StatusChange[],
  entity: StatusChangeEntity,
  publicEndpoints: PublicEndpoint
) {
  const chkey = chKey(channel.id, entity.actorId, entity.tableName);
  let error: string | undefined = undefined;
  const state = channelStates[chKey(channel.id, entity.actorId, entity.tableName)];
  const lastStatus = statusChanges[statusChanges.length - 1];
  let flappingSince: Date | undefined =
    lastStatus.status === "FLAPPING" ? state.flappingSince || lastStatus.timestamp : undefined;
  const status = lastStatus.status === "SUCCESS" ? "SUCCESS" : lastStatus.status === "FLAPPING" ? "FLAPPING" : "FAILED";
  try {
    if (channel.channel === "slack") {
      await sendSlackNotification(channel, entity, status, lastStatus, statusChanges, publicEndpoints.baseUrl);
    } else if (channel.channel === "email") {
      await sendEmailNotification(channel, entity, status, lastStatus, statusChanges, publicEndpoints.baseUrl);
    }
    log
      .atInfo()
      .log(
        `[${chkey}] ${channel.channel} notification sent. Job status: ${status} id: ${entity.id} ts: ${entity.timestamp}`
      );
  } catch (e: any) {
    log
      .atError()
      .log(
        `[${chkey}] Failed to process ${channel.channel} notification. Job status: ${status} id: ${entity.id} ts: ${entity.timestamp}: ${e.message}`
      );
    error = e.message;
  } finally {
    await db.prisma().notification.create({
      data: {
        workspaceId: entity.workspaceId,
        actorId: entity.actorId,
        tableName: entity.tableName,
        channelId: channel.id,
        statusChangeId: lastStatus.id!,
        status: error ? "error" : "ok",
        error,
      },
    });
    await updateNotificationState(channelStates, channel, lastStatus, flappingSince, error);
  }
}

async function loadSyncStatusesChanges(
  fromTimestamp: Date,
  entities: Record<string, StatusChangeEntity>
): Promise<void> {
  const sw = stopwatch();
  let statusChanges = 0;

  const r = await db.pgPool().query(
    `
        select *
        from newjitsu.source_task
        where status not in ('RUNNING', 'CANCELLED', 'SKIPPED')
          and updated_at > $1
        order by updated_at asc
    `,
    [fromTimestamp]
  );
  log.atInfo().log(`Got ${r.rowCount} sync task records in ${sw.elapsedPretty()}`);
  for (const row of r.rows) {
    let entity = entities[key(row.sync_id)];
    const status = row.status;
    if (!entity) {
      log.atWarn().log(`Sync ${row.sync_id} not found`);
      continue;
    }
    //log.atInfo().log(`SS`, rowTimestamp, typeof rowTimestamp, batch.timestamp, typeof batch.timestamp);

    const chId = await updateStatusChange(entities, entity, row.updated_at, status, row.error);
    if (chId) {
      statusChanges++;
    }
  }
  log.atInfo().log(`Sync tasks processed. Status changes: ${statusChanges}. Elapsed: ${sw.elapsedPretty()}`);
}

async function loadBatchStatusesChanges(
  fromTimestamp: Date,
  entities: Record<string, StatusChangeEntity>
): Promise<void> {
  const sw = stopwatch();
  const actorIds = Object.entries(entities)
    .filter(([_, b]) => b.type === "batch")
    .map(([id, _]) => id);
  let statusChanges = 0;

  const metricsSchema = process.env.CLICKHOUSE_METRICS_SCHEMA || process.env.CLICKHOUSE_DATABASE || "newjitsu_metrics";

  // noinspection SqlResolve
  const eventsLogQuery: string = `select actorId, level, timestamp, message
                                  from ${metricsSchema}.events_log
                                  where type = 'bulker_batch'
                                    and timestamp > toDateTime({fromTimestamp:String}, 'UTC')
                                    and has({actorIds:Array(String)}, actorId)
                                  order by timestamp
                                          asc`;
  const eventsLogRes = (await (
    await clickhouse.query({
      query: eventsLogQuery,
      query_params: {
        fromTimestamp: dateToClickhouse(fromTimestamp),
        actorIds: actorIds,
      },
      clickhouse_settings: {
        wait_end_of_query: 1,
      },
    })
  ).json()) as any;
  log.atInfo().log(`Got ${eventsLogRes.data.length} events log records in ${sw.elapsedPretty()}`);
  if (eventsLogRes.data && eventsLogRes.data.length > 0) {
    for (const row of eventsLogRes.data) {
      let entity = entities[key(row.actorId)];
      const status = row.level === "error" ? "FAILED" : "SUCCESS";
      let message: any = {};
      try {
        message = JSON.parse(row.message);
      } catch (e) {}
      let tableName = message.representation?.targetName || message.representation?.name;
      if (tableName) {
        tableName = tableName
          .replace(/_tmp\d{12,16}$/, "")
          .replace(/_\d{4}_\d{2}_\d{2}T\d{2}_\d{2}_\d{2}(?:_\d+)?[.](?:ndjson|csv)(?:[.]gz)?$/, "");
        let entityWithTable = entities[key(row.actorId, tableName)];
        if (!entityWithTable) {
          entityWithTable = { ...entity, tableName, type: "batch" };
        }
        entity = entityWithTable;
      }
      //log.atInfo().log(`Batch ${row.actorId} ${entity.tableName} ${status} ${row.timestamp} ${entity.timestamp}`);
      if (!entity) {
        log.atWarn().log(`Batch ${row.actorId} not found`);
        continue;
      }
      const rowTimestamp = dayjs(row.timestamp, { utc: true }).toDate();

      const chId = await updateStatusChange(entities, entity, rowTimestamp, status, message.error);
      if (chId) {
        statusChanges++;
      }
    }
    log.atInfo().log(`Events log processed. Status changes: ${statusChanges}. Elapsed: ${sw.elapsedPretty()}`);
  }
}

async function updateStatusChange(
  entities: Record<string, StatusChangeEntity>,
  entity: StatusChangeEntity,
  timestamp: Date,
  status: Status,
  description?: string
): Promise<boolean> {
  let changed = false;
  let newBatch: StatusChange & { id?: bigint | number };

  if (!entity.timestamp || timestamp.getTime() > entity.timestamp.getTime()) {
    if (status != entity.status) {
      newBatch = {
        workspaceId: entity.workspaceId!,
        actorId: entity.actorId!,
        tableName: entity.tableName ?? "",
        timestamp: timestamp,
        startedAt: timestamp,
        status: status,
        description: description,
        counts: 1,
      };
      const b = await db.prisma().statusChange.create({
        data: newBatch,
      });
      newBatch.id = b.id;
      changed = true;
      log.atInfo().log(`${entity.actorId} ${entity.tableName} status changed from ${entity.status} to ${status}`);
    } else {
      newBatch = await db.prisma().statusChange.update({
        where: { id: entity.id },
        data: {
          counts: { increment: 1 },
          timestamp: timestamp,
        },
      });
    }
    entity = {
      ...entity,
      ...newBatch,
      changesPerHours: entity.changesPerHours + (changed ? 1 : 0),
      changesPerDay: entity.changesPerDay + (changed ? 1 : 0),
      id: newBatch.id!,
    };
    entities[key(entity.actorId, entity.tableName)] = entity;
    return changed;
  }
  return false;
}

type JobStatus = "FAILED" | "SUCCESS" | "FLAPPING";

type SlackPayload = {
  text: string;
  blocks?: any[];
  attachments?: any[];
};

async function sendSlackNotification(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  status: JobStatus,
  lastStatus: StatusChange,
  statusChanges: StatusChange[],
  baseUrl: string
): Promise<void> {
  const url =
    entity.type == "sync"
      ? `${baseUrl}/${entity.slug}/syncs/tasks?query={syncId:'${entity.actorId}'}`
      : `${baseUrl}/${entity.slug}/data?query={activeView%3A'bulker'%2CviewState%3A{bulker%3A{actorId%3A'${entity.actorId}'}}}`;
  const name = `${entity.fromName} → ${entity.toName}`;
  const jobType = entity.type == "sync" ? "Sync Task" : "Batch";
  const jobName = `<${url}|${name}>`;
  const message =
    status === "SUCCESS"
      ? `:large_green_circle: ${jobType} *SUCCESS* ${jobName} [${entity.workspaceName}]`
      : `:red_circle: ${jobType} *FAILED* ${jobName} [${entity.workspaceName}]`;
  const color = status === "SUCCESS" ? "#36a64f" : "#ff0000"; // Red for failed, Green for recovered
  const details = [...statusChanges]
    .reverse()
    .map(s => `${s.timestamp.toISOString()} *${s.status}*${s.description ? ":\n```" + s.description + "```" : ""}\n`)
    .join("\n");

  const payload: SlackPayload = {
    text: message,
    attachments: [
      {
        color: color,
        title: "Details",
        ts: lastStatus.timestamp.getTime() / 1000,
        title_link: url,
        text: details, // This can be a very long text body
      },
    ],
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Last status: \`${lastStatus.status}\`\n${
            lastStatus.tableName ? "Batch Table: `" + lastStatus.tableName + "`\n" : ""
          }<${url}|Open in Jitsu...>`,
        },
      },
      // {
      //   type: "divider",
      // },
    ],
  };
  if (channel.recurringAlertsPeriodHours) {
    payload.blocks!.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `No additional reports will be sent for this connection in ${channel.recurringAlertsPeriodHours} hours unless the status changes.`,
        },
      ],
    });
  }

  const res = await fetch(channel.slackWebhookUrl!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`HTTP Error: ${res.status}: ${await res.text()}`);
  }
}

async function sendEmailNotification(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  status: JobStatus,
  lastStatus: StatusChange,
  statusChanges: StatusChange[],
  baseUrl: string
): Promise<void> {
  const name = `${entity.fromName} → ${entity.toName}`;
  const details = [...statusChanges]
    .reverse()
    .map(
      s =>
        `${s.timestamp.toISOString()} <b>${s.status}</b>${
          s.description ? ":<br/><code className='text-xxs'>" + s.description + "</code>" : ""
        }<br/>`
    )
    .join("\n");

  const eeAuthToken = createJwt("admin-service-account@jitsu.com", "admin-service-account@jitsu.com", "$all", 60).jwt;

  await rpc(`${getEeConnection().host}api/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${eeAuthToken}`,
    },
    body: {
      template: status === "SUCCESS" ? "connection-status-success" : "connection-status-failed",
      workspaceId: entity.workspaceId,
      variables: {
        workspaceName: entity.workspaceName,
        workspaceSlug: entity.slug,
        entityId: entity.actorId,
        entityType: entity.type,
        entityName: name,
        tableName: entity.tableName,
        recurringAlertsPeriodHours: channel.recurringAlertsPeriodHours,
        lastStatus: lastStatus.status,
        details: details,
      },
    },
  });
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() > b.getTime() ? a : b;
}
