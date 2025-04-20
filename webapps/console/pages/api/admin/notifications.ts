import { createRoute, verifyAdmin } from "../../../lib/api";
import { clickhouse, dateToClickhouse } from "../../../lib/server/clickhouse";
import { db } from "../../../lib/server/db";
import { getServerLog } from "../../../lib/server/log";
import { NotificationStateDbModel, StatusChangeDbModel } from "../../../prisma/schema";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { stopwatch } from "juava";
import { getAppEndpoint, PublicEndpoint } from "../../../lib/domains";
import { NotificationChannel } from "../../../lib/schema";
import omit from "lodash/omit";
import { ConnectionStatusFailedEmail } from "../../../emails/connection-status-failed";
import { ConnectionStatusFirstRunEmail } from "../../../emails/connection-status-firstrun";
import { ConnectionStatusFlappingEmail } from "../../../emails/connection-status-flapping";
import { ConnectionStatusOngoingEmail } from "../../../emails/connection-status-ongoing";
import { ConnectionStatusRecoveredEmail } from "../../../emails/connection-status-recovered";
import { ConnectionStatusPartialEmail } from "../../../emails/connection-status-partial";

import { sendEmail, UnsubscribeLinkProps, WorkspaceEmailProps } from "@jitsu-internal/webapps-shared";
import { DefaultUserNotificationsPreferences } from "../../../lib/server/user-preferences";
import pick from "lodash/pick";

dayjs.extend(utc);

const log = getServerLog("notifications");

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

export type StatusChange = Omit<z.infer<typeof StatusChangeDbModel>, "id"> & { id?: bigint };

type NotificationState = z.infer<typeof NotificationStateDbModel>;

const flappingWindowHours = 4;

const flappingThreshold = 4;

export const _J_PREF = "_j:";

export type ConnectionStatusNotificationProps = {
  entityId: string;
  entityType: "batch" | "sync";
  entityName: string;
  entityFrom: string;
  entityTo: string;
  timestamp?: string;
  tableName?: string;
  status: string;
  incidentStatus: string;
  incidentStartedAt?: string;
  incidentDetails: string;
  queueSize?: number;
  recurring?: boolean;
  recurringAlertsPeriodHours?: number;
  flappingWindowHours?: number;
  flappingSince?: string;
  changesPerHours?: number;
  streamsFailed?: string;
  detailsUrl?: string;
  baseUrl: string;
} & WorkspaceEmailProps &
  UnsubscribeLinkProps;

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

export type StatusChangeEntity = StatusChange & {
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
  .handler(async ({ req, user }) => {
    const sw = stopwatch();
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
      .log(
        `Previous run time: ${previousRunTime.toISOString()} Last processed timestamp: ${processedTimestamp.toISOString()}`
      );
    // add some overlap to avoid missing status changes
    previousRunTime.setMinutes(previousRunTime.getMinutes() - 10);

    const entities: Record<string, StatusChangeEntity> = {};

    // load all objects which we monitor status changes for along with their last status change
    // noinspection SqlResolve
    const r = await db.pgPool().query(`
      with last_statuses as (select DISTINCT ON ("actorId", "tableName") "actorId",
                                                                         "tableName",
                                                                         id,
                                                                         status,
                                                                         description,
                                                                         timestamp,
                                                                         "startedAt"
                             from newjitsu."StatusChange"
                             order by "actorId", "tableName", id desc),
        
           status_changes as (select "actorId",
                                     "tableName",
                                     coalesce(
                                       sum(
                                         case
                                           when "startedAt" >= current_timestamp - interval '${flappingWindowHours} hours'
                                             then 1 end), 0) as "changesPerHours",
                                     coalesce(
                                       sum(
                                         case when "startedAt" >= current_timestamp - interval '1 days' then 1 end),
                                       0)                    as "changesPerDay"
                              from newjitsu."StatusChange"
                              where "startedAt" >= current_timestamp - interval '1 days'
                              group by "actorId", "tableName")

      select w.id                        as "workspaceId",
             w.slug                      as slug,
             w.name                      as "workspaceName",
             fr.config ->> 'name'        as "fromName",
             too.config ->> 'name'       as "toName",
             coalesce(
               sc."actorId", cl.id)      as "actorId",
             REPLACE(
               cl.type, 'push', 'batch') as type,
             ls.id,
             ls."tableName",
             ls.timestamp,
             ls."startedAt",
             ls.status,
             ls.description,
             sc."changesPerHours",
             sc."changesPerDay"
      from newjitsu."ConfigurationObjectLink" cl
             join newjitsu."Workspace" w
                  on w.id = cl."workspaceId"
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
      row.changesPerHours = parseInt(row.changesPerHours);
      row.changesPerDay = parseInt(row.changesPerDay);
      entities[key(row.actorId)] = row;
      if (row.tableName) {
        entities[key(row.actorId, row.tableName)] = row;
      }
    }
    const incrms = await Promise.all([
      loadBatchStatusesChanges(previousRunTime, entities),
      loadSyncStatusesChanges(previousRunTime, entities),
    ]);
    const increments = new Map<bigint, StatusRepeats>([...incrms[0], ...incrms[1]]);
    // optimization. we have batches that runs way too often. to avoid multiple db updates we can accumulate changes and write them in a single query
    if (increments.size > 0) {
      const values = Array.from(increments.entries())
        .map(
          ([id, data]) =>
            `(${id}, ${data.counts}, '${data.timestamp.toISOString()}', '${data.description.replaceAll("'", "''")}', ${
              data.queueSize
            })`
        )
        .join(",");
      const query = `update newjitsu."StatusChange" as s
                     set counts    = s.counts + data.counts,
                         description = data.description,
                         "queueSize" = data."queueSize",
                         timestamp = data.timestamp::TIMESTAMPTZ(3)
                     from (values ${values}) as data (id, counts, timestamp, description, "queueSize")
                     where s.id = data.id`;
      const res = await db.pgPool().query(query);
      log.atInfo().log(`Status counts updated for ${res.rowCount} rows.`);
    }

    processedTimestamp = await processStatusChanges(processedTimestamp, entities, publicEndpoints);

    await db.prisma().globalProps.update({
      where: { id: notificationsLastRun.id },
      data: {
        name: "notificationsLastRun",
        value: { timestamp: currentRunTime, lastProcessedTimestamp: processedTimestamp },
      },
    });

    log
      .atInfo()
      .log(`Done. Last processed timestamp: ${processedTimestamp.toISOString()} Elapsed: ${sw.elapsedPretty()}`);
  })
  .toNextApiHandler();

async function loadNotificationsChannels() {
  const channels: Record<string, NotificationChannel[]> = {
    admin: [adminChannel],
  };
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

  const res = await db.pgPool()
    .query(`select wa."workspaceId", wa."userId", u.email, u.name, upw.preferences "workspacePref", upg.preferences "globalPref" from newjitsu."WorkspaceAccess" wa
                                join newjitsu."UserProfile" u on u.id = wa."userId" --and u.email like '%@jitsu.com'
                                join newjitsu."Workspace" w on w.id = wa."workspaceId" and w.deleted = false
                                left outer join newjitsu."UserPreferences" upw on  upw."userId" = wa."userId" and upw."workspaceId" = wa."workspaceId"
                                left outer join newjitsu."UserPreferences" upg on upg."userId" = wa."userId" and upg."workspaceId" is null`);
  for (const row of res.rows) {
    const settings = {
      ...DefaultUserNotificationsPreferences,
      ...row.globalPref?.notifications,
      ...row.workspacePref?.notifications,
    };
    if (settings.syncs || settings.batches) {
      const events: ("all" | "sync" | "batch")[] = [];
      if (settings.syncs) {
        events.push("sync");
      }
      if (settings.batches) {
        events.push("batch");
      }
      let channelsByWorkspace = channels[row.workspaceId];
      if (!channelsByWorkspace) {
        channelsByWorkspace = [];
        channels[row.workspaceId] = channelsByWorkspace;
      }
      channelsByWorkspace.push({
        id: "user:" + row.userId,
        channel: "email",
        events: events,
        name: row.name,
        emails: [row.email],
        recurringAlertsPeriodHours: row.recurringAlertsPeriodHours,
        type: "notification",
        workspaceId: row.workspaceId,
      });
    }
  }
  return channels;
}

async function processStatusChanges(
  processedTimestamp: Date,
  entities: Record<string, StatusChangeEntity>,
  publicEndpoints: any
): Promise<Date> {
  log.atInfo().log(`Loading changes from ${processedTimestamp.toISOString()}`);
  const statusChanges = await db.prisma().statusChange.findMany({
    where: {
      timestamp: { gt: processedTimestamp },
    },
    orderBy: [{ timestamp: "asc" }],
  });

  log.atInfo().log(`Got ${statusChanges.length} new status changes`);

  if (statusChanges.length === 0) {
    return processedTimestamp;
  }

  const channels = await loadNotificationsChannels();

  const channelStates: Record<string, NotificationState> = {};
  const states = await db.prisma().notificationState.findMany({});
  for (const state of states) {
    channelStates[chKey(state.channelId, state.actorId, state.tableName)] = state;
  }

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
    const entity = entities[k];
    for (const channel of [...(channels[entity.workspaceId] || []), ...(channels["admin"] || [])]) {
      if (!channel.events.includes(entity.type) && !channel.events.includes("all")) {
        continue;
      }
      const cStatuses = [...statuses];
      const chkey = chKey(channel.id, lastStatus.actorId, lastStatus.tableName);
      let state = channelStates[chkey];
      const sendRecurringTime =
        (state?.lastNotification?.getTime() || 0) + channel.recurringAlertsPeriodHours * 60 * 60 * 1000;
      let doNotify = false;

      // no flapping state or no saved state for this entity at all
      if (!state?.flappingSince) {
        if (entity.changesPerHours > flappingThreshold && lastStatus.status !== "SUCCESS") {
          log
            .atInfo()
            .log(`[${chkey}] Flapping started ${lastStatus.timestamp} Changes per hour: ${entity.changesPerHours}`);
          cStatuses.push({
            ...lastStatus,
            status: "FLAPPING",
            description:
              _J_PREF +
              JSON.stringify({
                status: "FLAPPING",
                description: `${entity.changesPerHours} transitions from SUCCESS to FAILED within a ${flappingWindowHours}-hours window`,
                changesPerHours: entity.changesPerHours,
                flappingWindowHours,
                lastStatus: lastStatus.description,
              }),
          });
          doNotify = true;
        } else {
          if (!state) {
            if (lastStatus.status !== "SUCCESS" || lastStatus.counts === 0) {
              log
                .atInfo()
                .log(
                  `[${chkey}] First status on channel: ${lastStatus.status} for ${entity.actorId} ${entity.tableName}`
                );
              // first status change. report SUCCESS only if it is the first observed run of this entity
              doNotify = true;
            }
          } else if (lastStatus.id !== state?.statusChangeId) {
            // status change since last notification
            doNotify = true;
          } else if (lastStatus.status !== "SUCCESS" && lastStatus.timestamp.getTime() > sendRecurringTime) {
            // recurring alert
            doNotify = true;
            let extraPayload: any = {};
            if (lastStatus.description && lastStatus.description.startsWith(_J_PREF)) {
              try {
                extraPayload = JSON.parse(lastStatus.description.substring(_J_PREF.length));
              } catch (e) {}
            }
            lastStatus.description =
              _J_PREF +
              JSON.stringify({
                status: "ONGOING",
                description: extraPayload.description || lastStatus.description,
                ...extraPayload,
              });
          }
        }
      } else if (!entity.changesPerHours) {
        log
          .atInfo()
          .log(`[${chkey}] Flapping ended ${lastStatus.timestamp} Changes per hour: ${entity.changesPerHours}`);
        doNotify = true;
      } else if (lastStatus.timestamp.getTime() > sendRecurringTime && lastStatus.status !== "SUCCESS") {
        log
          .atInfo()
          .log(`[${chkey}] Flapping recurring ${state.flappingSince} Changes per hour: ${entity.changesPerHours}`);
        cStatuses.push({
          ...lastStatus,
          status: "FLAPPING",
          description:
            _J_PREF +
            JSON.stringify({
              status: "FLAPPING",
              description: `ONGOING: ${entity.changesPerHours} transitions from SUCCESS to FAILED within a ${flappingWindowHours}-hours window`,
              changesPerHours: entity.changesPerHours,
              flappingSince: state.flappingSince,
              flappingWindowHours,
              lastStatus: lastStatus.description,
            }),
        });
        doNotify = true;
      } else {
        log
          .atInfo()
          .log(`[${chkey}] Flapping ongoing since ${state.flappingSince} Changes per hour: ${entity.changesPerHours}`);
      }
      if (doNotify) {
        await processNotifications(channel, channelStates, cStatuses, entity, publicEndpoints);
      }
    }
  }

  return processedTimestamp;
}

function makeNotificationState(
  channel: NotificationChannel,
  statusChange: StatusChange,
  flappingSince?: Date | null,
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
  flappingSince?: Date | null,
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
  let flappingSince: Date | null =
    lastStatus.status === "FLAPPING" ? state?.flappingSince || lastStatus.timestamp : null;
  try {
    if (channel.channel === "slack") {
      await sendSlackNotification(channel, entity, statusChanges, publicEndpoints.baseUrl);
    } else if (channel.channel === "email") {
      await sendEmailNotification(channel, entity, statusChanges, publicEndpoints.baseUrl);
    }
    log.atInfo().log(`[${chkey}] ${channel.channel} notification sent. Id: ${entity.id} ts: ${entity.timestamp}`);
  } catch (e: any) {
    log
      .atError()
      .log(
        `[${chkey}] Failed to process ${channel.channel} notification. Id: ${entity.id} ts: ${entity.timestamp}: ${e.message}`
      );
    error = e.message;
  } finally {
    await db.prisma().notification.create({
      data: {
        workspaceId: entity.workspaceId,
        actorId: entity.actorId,
        tableName: entity.tableName || "",
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
): Promise<Map<bigint, StatusRepeats>> {
  const increments: Map<bigint, StatusRepeats> = new Map();
  const sw = stopwatch();
  let statusChanges = 0;

  const processed = await db.pgHelper().streamQuery(
    `
        select *
        from newjitsu.source_task
        where status not in ('RUNNING', 'CANCELLED', 'SKIPPED')
          and updated_at > $1
        order by updated_at asc
    `,
    [fromTimestamp],
    async row => {
      let entity = entities[key(row.sync_id)];
      const status = row.status;
      if (!entity) {
        log.atWarn().log(`Sync ${row.sync_id} not found`);
        return;
      }
      let description = row.error;
      if (status === "PARTIAL" || status === "TIME_EXCEEDED") {
        try {
          const st = JSON.parse(row.description);
          const failed: string[] = [];
          const succeeded: string[] = [];
          for (const [name, stts] of Object.entries(st)) {
            if ((stts as any).status === "SUCCESS") {
              succeeded.push(name);
            } else {
              failed.push(name);
            }
          }
          const streamsFailed = `${failed.length} of ${failed.length + succeeded.length}`;
          description =
            _J_PREF +
            JSON.stringify({
              description: `${streamsFailed} streams failed. Failed streams: ${failed.join(", ")}.\n${row.error}`,
              streamsFailed,
            });
        } catch (e: any) {
          log.atError().log(`Failed to parse sync ${row.sync_id} status: ${e.message}: ${row.description}`);
        }
      }
      //log.atInfo().log(`SS`, rowTimestamp, typeof rowTimestamp, batch.timestamp, typeof batch.timestamp);
      const chId = await updateStatusChange(entities, entity, row.updated_at, status, 0, description, increments);
      if (chId) {
        statusChanges++;
      }
    }
  );
  log
    .atInfo()
    .log(
      `Sync tasks processed. Rows: ${processed.rows}. Status changes: ${statusChanges}. Elapsed: ${sw.elapsedPretty()}`
    );
  return increments;
}

// StatusRepeats - optimization. we have batches that runs way too often.
// to avoid multiple db updates we can accumulate changes and write them in a single query
type StatusRepeats = { counts: number; timestamp: Date; description: string; queueSize: number };

async function loadBatchStatusesChanges(
  fromTimestamp: Date,
  entities: Record<string, StatusChangeEntity>
): Promise<Map<bigint, StatusRepeats>> {
  const increments: Map<bigint, StatusRepeats> = new Map();
  const sw = stopwatch();
  const actorIds = Object.entries(entities)
    .filter(([_, b]) => b.type === "batch")
    .map(([id, _]) => id);
  let processed = 0;
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
  const chResult = await clickhouse.query({
    query: eventsLogQuery,
    query_params: {
      fromTimestamp: dateToClickhouse(fromTimestamp),
      actorIds: actorIds,
    },
    format: "JSONEachRow",
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  });
  for await (const rows of chResult.stream()) {
    for (const r of rows) {
      processed++;
      const row = r.json() as any;
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
          entities[key(row.actorId, tableName)] = entityWithTable;
        }
        entity = entityWithTable;
      }
      const queueSize = message.queueSize || 0;
      //log.atInfo().log(`Batch ${row.actorId} ${entity.tableName} ${status} ${row.timestamp} ${entity.timestamp}`);
      if (!entity) {
        log.atWarn().log(`Batch ${row.actorId} not found`);
        continue;
      }
      const rowTimestamp = dayjs(row.timestamp, { utc: true }).toDate();

      const chId = await updateStatusChange(
        entities,
        entity,
        rowTimestamp,
        status,
        queueSize,
        message.error,
        increments
      );
      if (chId) {
        statusChanges++;
      }
    }
  }
  log
    .atInfo()
    .log(`Events log processed. Rows: ${processed}. Status changes: ${statusChanges}. Elapsed: ${sw.elapsedPretty()}`);
  return increments;
}

async function updateStatusChange(
  entities: Record<string, StatusChangeEntity>,
  entity: StatusChangeEntity,
  timestamp: Date,
  status: string,
  queueSize: number,
  description?: string,
  increments?: Map<bigint, StatusRepeats>
): Promise<boolean> {
  let changed = false;
  let newEntity: StatusChange & { id?: bigint | number };

  if (!entity.timestamp || timestamp.getTime() > entity.timestamp.getTime()) {
    if (status != entity.status) {
      if (status === "SUCCESS") {
        if (!entity.timestamp) {
          description = _J_PREF + JSON.stringify({ status: "FIRST_RUN" });
        } else {
          description =
            _J_PREF +
            JSON.stringify({
              status: "RECOVERED",
              incidentStatus: entity.status,
              incidentStartedAt: entity.startedAt?.toISOString(),
              incidentDetails: extractDescription(entity),
            });
        }
      }
      newEntity = {
        workspaceId: entity.workspaceId!,
        actorId: entity.actorId!,
        tableName: entity.tableName ?? "",
        timestamp: timestamp,
        startedAt: timestamp,
        status: status,
        description: description,
        // 0 - means that this is the first status of connection
        counts: entity.timestamp ? 1 : 0,
        queueSize: queueSize,
      };
      const b = await db.prisma().statusChange.create({
        data: newEntity,
      });
      newEntity.id = b.id;
      changed = true;
      log.atInfo().log(`${entity.actorId} ${entity.tableName} status changed from ${entity.status} to ${status}`);
    } else {
      const newDescription = description || entity.description || "";
      if (increments) {
        // optimization. we have batches that runs way too often. to avoid multiple db updates we can accumulate changes and write them in a single query
        let increment = increments.get(entity.id);
        if (!increment) {
          increment = { counts: 1, timestamp, description: newDescription, queueSize };
          increments.set(entity.id, increment);
        } else {
          increment.counts++;
          increment.description = newDescription;
          increment.timestamp = timestamp;
          increment.queueSize = queueSize;
        }
        newEntity = {
          ...entity,
          description: newDescription,
          counts: entity.counts + 1,
          queueSize: queueSize,
          timestamp: timestamp,
        };
      } else {
        newEntity = await db.prisma().statusChange.update({
          where: { id: entity.id },
          data: {
            description: newDescription,
            counts: { increment: 1 },
            queueSize: queueSize,
            timestamp: timestamp,
          },
        });
      }
    }
    entity = {
      ...entity,
      ...newEntity,
      changesPerHours: entity.changesPerHours + (changed ? 1 : 0),
      changesPerDay: entity.changesPerDay + (changed ? 1 : 0),
      id: newEntity.id!,
    };
    entities[key(entity.actorId, entity.tableName)] = entity;
    return changed;
  }
  return false;
}

type SlackPayload = {
  text: string;
  blocks?: any[];
  attachments?: any[];
};

interface SlackTemplate {
  text(props: ConnectionStatusNotificationProps): string;
  header(props: ConnectionStatusNotificationProps): string;
  description(props: ConnectionStatusNotificationProps): string[];
  metaBlock?(props: ConnectionStatusNotificationProps): string;
  footer(props: ConnectionStatusNotificationProps): string;
  showDetails?(props: ConnectionStatusNotificationProps): boolean;
  showButtons?(props: ConnectionStatusNotificationProps): boolean;
}

const metaBlock = (props: {
  tableName?: string;
  streamsFailed?: string;
  incidentStartedAt?: string;
  incidentStatus?: string;
  recoveredFrom?: string;
  queueSize?: number;
}) => {
  const textArray: string[] = [];
  if (props.tableName) {
    textArray.push(`Table: \`${props.tableName}\``);
  }
  if (props.recoveredFrom) {
    textArray.push(`Recovered from: ${props.recoveredFrom.toLowerCase()}`);
  }
  if (props.incidentStatus) {
    textArray.push(`Incident status: ${props.incidentStatus}`);
  }
  if (props.streamsFailed) {
    textArray.push(`Streams Failed: ${props.streamsFailed}`);
  }
  if (
    props.incidentStartedAt &&
    (Date.now() - new Date(props.incidentStartedAt).getTime() > 5 * 60 * 1000 || props.recoveredFrom)
  ) {
    textArray.push(`Incident started at: ${dayjs(props.incidentStartedAt).toLocaleString()}`);
  }
  if (props.queueSize) {
    textArray.push(`Queue size: ${props.queueSize.toLocaleString()}`);
  }
  return textArray.join("\n");
};

const jobName = (props: ConnectionStatusNotificationProps) =>
  props.entityType === "sync" ? "Sync Task" : "Data Warehouse Batch Job";

const ConnectionStatusFailedSlack: SlackTemplate = {
  text: props => `:red_circle: ${jobName(props)} *FAILED* ${props.entityName} [${props.workspaceName}]`,
  header: props => `:red_circle: ${jobName(props)} failed`,
  description: props => [
    `Jitsu ${jobName(props)} *failed* :persevere:.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props => metaBlock(pick(props, "tableName", "incidentStatus", "incidentStartedAt", "queueSize")),
  footer: props =>
    props.recurringAlertsPeriodHours
      ? `No additional reports will be sent for this connection in ${props.recurringAlertsPeriodHours} hours unless the status changes.`
      : "",
};

const ConnectionStatusFirstRunSlack: SlackTemplate = {
  text: props => `:tada: ${jobName(props)} *FIRST RUN* ${props.entityName} [${props.workspaceName}]`,
  header: props => `:tada: ${jobName(props)} successful initial run`,
  description: props => [
    `Jitsu ${jobName(props)} *succeeded* :+1:.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props => metaBlock({ tableName: props.tableName }),
  footer: _ => `No additional reports will be sent for this connection unless the status changes.`,
  showDetails: _ => false,
};

const ConnectionStatusFlappingSlack: SlackTemplate = {
  text: props => `:large_yellow_circle: ${jobName(props)} *FLAPPING* ${props.entityName} [${props.workspaceName}]`,
  header: props => `:large_yellow_circle: ${jobName(props)} intermittent failures`,
  description: props => [
    `Jitsu ${jobName(props)} status fluctuating between success and failure :game_die:.`,
    `It has changed status *${props.changesPerHours}* times in the last *${props.flappingWindowHours}* hours.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props => metaBlock(pick(props, "tableName", "incidentStatus", "queueSize")),
  footer: props =>
    props.recurringAlertsPeriodHours
      ? `No additional reports will be sent for this connection in ${props.recurringAlertsPeriodHours} hours unless the status changes.`
      : "",
};

const ConnectionStatusOngoingSlack: SlackTemplate = {
  text: props =>
    `${
      ["PARTIAL", "TIME_EXCEEDED"].includes(props.incidentStatus) ? ":large_yellow_circle:" : ":red_circle:"
    } ${jobName(props)} *RECURRING* ${props.entityName} [${props.workspaceName}]`,
  header: props =>
    `${
      ["PARTIAL", "TIME_EXCEEDED"].includes(props.incidentStatus) ? ":large_yellow_circle:" : ":red_circle:"
    } ${jobName(props)} ongoing issues`,
  description: props => [
    `Jitsu ${jobName(props)} processing issues persist :persevere:.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props =>
    metaBlock(pick(props, "tableName", "incidentStatus", "incidentStartedAt", "queueSize", "streamsFailed")),
  footer: props =>
    props.recurringAlertsPeriodHours
      ? `No additional reports will be sent for this connection in ${props.recurringAlertsPeriodHours} hours unless the status changes.`
      : "",
};

const ConnectionStatusRecoveredSlack: SlackTemplate = {
  text: props => `:large_green_circle: ${jobName(props)} *RECOVERED* ${props.entityName} [${props.workspaceName}]`,
  header: props => `:large_green_circle: ${jobName(props)} recovered`,
  description: props => [
    `Jitsu ${jobName(props)} *recovered* :+1:.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props =>
    metaBlock({
      tableName: props.tableName,
      recoveredFrom: props.incidentStatus,
      incidentStartedAt: props.incidentStartedAt,
      queueSize: props.queueSize,
    }),
  footer: _ => `No additional reports will be sent for this connection unless the status changes.`,
  showDetails: _ => false,
};

const ConnectionStatusPartialSlack: SlackTemplate = {
  text: props => `:large_yellow_circle: ${jobName(props)} *PARTIAL* ${props.entityName} [${props.workspaceName}]`,
  header: props => `:large_yellow_circle: ${jobName(props)} partial success`,
  description: props => [
    `Jitsu ${jobName(props)} had *partial* success :persevere:.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props => metaBlock(pick(props, "streamsFailed", "incidentStatus", "incidentStartedAt")),
  footer: props =>
    props.recurringAlertsPeriodHours
      ? `No additional reports will be sent for this connection in ${props.recurringAlertsPeriodHours} hours unless the status changes.`
      : "",
};

export async function sendSlackNotification(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  statusChanges: StatusChange[],
  baseUrl: string
): Promise<void> {
  const props = fillNotificationProps(channel, entity, statusChanges, baseUrl);

  const selectTemplate = (status: string) => {
    switch (status) {
      case "FIRST_RUN":
        return ConnectionStatusFirstRunSlack;
      case "FLAPPING":
        return ConnectionStatusFlappingSlack;
      case "RECOVERED":
        return ConnectionStatusRecoveredSlack;
      case "ONGOING":
        return ConnectionStatusOngoingSlack;
      case "PARTIAL":
      case "TIME_EXCEEDED":
        return ConnectionStatusPartialSlack;
      default:
        return ConnectionStatusFailedSlack;
    }
  };

  const template = selectTemplate(props.status);

  const payload: SlackPayload = {
    text: template.text(props),
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: template.header(props),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: template.description(props).join("\n"),
        },
      },
    ],
  };
  const metaBlock = template.metaBlock?.(props);
  if (metaBlock) {
    payload.blocks!.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: metaBlock,
      },
    });
  }
  if (typeof template.showDetails === "undefined" || template.showDetails(props)) {
    payload.blocks!.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [`*Details*:`, "```", `${props.incidentDetails}`, "```"].join("\n"),
      },
    });
  }
  const footer = template.footer(props);
  if (footer) {
    payload.blocks!.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: footer,
        },
      ],
    });
  }
  if (typeof template.showButtons === "undefined" || template.showButtons(props)) {
    payload.blocks!.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":house: Open Workspace",
          },
          url: `${props.baseUrl}/${props.workspaceSlug}`,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: ":scroll: View Job Logs",
          },
          url: `${props.detailsUrl}`,
        },
      ],
    });
  }

  console.debug(`Sending slack notification to ${channel.id} (${channel.name}): ${payload.text}`);

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

export async function sendEmailNotification(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  statusChanges: StatusChange[],
  baseUrl: string
): Promise<void> {
  const props = fillNotificationProps(channel, entity, statusChanges, baseUrl);

  const selectTemplate = (status: string) => {
    switch (status) {
      case "FIRST_RUN":
        return ConnectionStatusFirstRunEmail;
      case "FLAPPING":
        return ConnectionStatusFlappingEmail;
      case "RECOVERED":
        return ConnectionStatusRecoveredEmail;
      case "ONGOING":
        return ConnectionStatusOngoingEmail;
      case "PARTIAL":
      case "TIME_EXCEEDED":
        return ConnectionStatusPartialEmail;
      default:
        return ConnectionStatusFailedEmail;
    }
  };

  const template = selectTemplate(props.status);

  await sendEmail(template, props, channel.emails!);
}

function fillNotificationProps(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  statusChanges: StatusChange[],
  baseUrl: string
) {
  const lastStatus = statusChanges[statusChanges.length - 1];
  const name = `${entity.fromName} → ${entity.toName}`;
  let extraPayload: any = {};
  if (lastStatus.description && lastStatus.description.startsWith(_J_PREF)) {
    try {
      extraPayload = JSON.parse(lastStatus.description.substring(_J_PREF.length));
    } catch (e) {}
  }
  const details = [...statusChanges]
    .reverse()
    .map(s => {
      const description = extractDescription(s);
      return `${s.timestamp.toISOString()} [${s.status}] ${description ?? ""}`;
    })
    .join("\n");

  const detailsUrl =
    entity.type == "sync"
      ? `${baseUrl}/${entity.slug}/syncs/tasks?query={syncId:'${entity.actorId}'}`
      : `${baseUrl}/${entity.slug}/data?query={activeView%3A'bulker'%2CviewState%3A{bulker%3A{actorId%3A'${entity.actorId}'}}}`;

  return {
    name: channel.name,
    workspaceName: entity.workspaceName,
    workspaceSlug: entity.slug,
    entityId: entity.actorId,
    entityType: entity.type,
    entityName: name,
    entityFrom: entity.fromName,
    entityTo: entity.toName,
    timestamp: lastStatus.timestamp.toISOString(),
    tableName: entity.tableName,
    status: lastStatus.status,
    incidentStatus: lastStatus.status,
    incidentStartedAt: lastStatus.startedAt.toISOString(),
    incidentDetails: details,
    queueSize: lastStatus.queueSize,
    recurringAlertsPeriodHours: channel.recurringAlertsPeriodHours,
    detailsUrl,
    baseUrl,
    unsubscribeLink: `${baseUrl}/${entity.slug}/settings/notifications`,
    ...extraPayload,
  } as ConnectionStatusNotificationProps;
}

function extractDescription(statusChange: StatusChange): string | null | undefined {
  if (statusChange.description && statusChange.description.startsWith(_J_PREF)) {
    try {
      const extraPayload = JSON.parse(statusChange.description.substring(_J_PREF.length));
      return extraPayload.description;
    } catch (e) {}
  }
  return statusChange.description;
}

export const config = {
  maxDuration: 300,
};
