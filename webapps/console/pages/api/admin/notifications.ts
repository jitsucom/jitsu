import { createRoute, verifyAdmin } from "../../../lib/api";
import { clickhouse, dateToClickhouse } from "../../../lib/server/clickhouse";
import { db } from "../../../lib/server/db";
import { getServerLog } from "../../../lib/server/log";
import { NotificationStateDbModel, StatusChangeDbModel } from "../../../prisma/schema";
import { z } from "zod";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { isTruish, stopwatch, trimMiddle } from "juava";
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
import ConnectionDeadLettered from "../../../emails/connection-dead-lettered";
import { getServerEnv } from "../../../lib/server/serverEnv";

dayjs.extend(utc);

const log = getServerLog("notifications");

const SLACK_WEBHOOK_URL = getServerEnv().SLACK_WEBHOOK_URL;

export type StatusChange = Omit<z.infer<typeof StatusChangeDbModel>, "id"> & { id?: bigint };

type NotificationState = z.infer<typeof NotificationStateDbModel>;

const flappingWindowHours = 4;

const flappingThreshold = 4;

export const _J_PREF = "_j:";

// Discriminator type for the connection-level aggregate StatusChange / NotificationState rows we
// persist when `summarizeBatchNotificationsByTable` is enabled. Using a dedicated `type` (rather
// than a sentinel tableName) avoids any possible collision with a real user table named e.g.
// `__connection__`. The actors CTE in the loader SQL only enumerates "batch"/"sync"/"dead", so
// "batch_aggregate" rows never enter the per-table `entities` map; they're handled solely by the
// dedicated aggregate path below.
const BATCH_AGGREGATE_TYPE = "batch_aggregate";

// Per-table rows whose last `timestamp` is older than this are treated as inactive and excluded
// from the connection-level aggregate. The loader's `last_statuses` CTE has no time window, so
// without this cutoff a long-stale FAILED row for a table that hasn't been written to in months
// would keep flipping the aggregate into PARTIAL whenever any other table transitions. 7 days
// matches the user-default `recurringAlertsPeriodHours`, so any actively-alerted table is well
// within the window.
const aggregateStaleTableCutoffDays = 7;

export type ConnectionStatusNotificationProps = {
  entityId: string;
  entityType: "batch" | "sync" | "dead";
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
  summarizeBatchNotificationsByTable: true,
};

export type StatusChangeEntity = Omit<StatusChange, "type"> & {
  id: number | bigint;
  type: "batch" | "sync" | "dead" | typeof BATCH_AGGREGATE_TYPE;
  workspaceName: string;
  slug: string;
  fromName: string;
  toName: string;
  changesPerHours: number;
  changesPerDay: number;
};

function key(actorId: string, type: string, tableName?: string) {
  return tableName ? `${actorId}::${type}:${tableName}` : `${actorId}::${type}`;
}

function chKey(channelId: string, actorId: string, type: string, tableName?: string) {
  return tableName ? `${channelId}::${actorId}::${type}:${tableName}` : `${channelId}::${actorId}::${type}`;
}

export default createRoute()
  .GET({
    auth: true,
    query: z.object({
      dryRun: z.string().optional(),
    }),
  })
  .handler(async ({ req, user, query }) => {
    const dryRun = isTruish(query.dryRun);
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
        `Previous run time: ${previousRunTime.toISOString()} Last processed timestamp: ${processedTimestamp.toISOString()} Dry run: ${dryRun}`
      );
    // add some overlap to avoid missing status changes
    previousRunTime.setMinutes(previousRunTime.getMinutes() - 10);

    const entities: Record<string, StatusChangeEntity> = {};

    // load all objects which we monitor status changes for along with their last status change
    // noinspection SqlResolve
    const r = await db.pgPool().query(`
      with last_statuses as (select DISTINCT ON ("actorId", type, "tableName") "actorId",
                                                                               type,
                                                                               "tableName",
                                                                               id,
                                                                               status,
                                                                               description,
                                                                               timestamp,
                                                                               "startedAt"
                             from newjitsu."StatusChange"
                             order by "actorId",type, "tableName", id desc),

           status_changes as (select "actorId",
                                     type,
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
                              group by "actorId", type, "tableName"),

           actors as (select id, unnest(type) as type, "workspaceId", "fromId", "toId"
                      from (select id,
                                   case
                                     when type = 'sync' then array ['sync']
                                     when (type = 'push' and data ->> 'mode' = 'batch') then array ['batch','dead','batch_aggregate']
                                     else array ['dead']
                                     end type,
                                   "workspaceId",
                                   "fromId",
                                   "toId"
                            from newjitsu."ConfigurationObjectLink"
                            where deleted = 'false') l)

      select w.id                        as "workspaceId",
             w.slug                      as slug,
             w.name                      as "workspaceName",
             fr.config ->> 'name'        as "fromName",
             too.config ->> 'name'       as "toName",
             coalesce(
               sc."actorId", cl.id)      as "actorId",
             cl.type as type,
             ls.id,
             ls."tableName",
             ls.timestamp,
             ls."startedAt",
             ls.status,
             ls.description,
             sc."changesPerHours",
             sc."changesPerDay"
      from actors cl
             join newjitsu."Workspace" w
                  on w.id = cl."workspaceId"
             join newjitsu."ConfigurationObject" fr on fr.id = cl."fromId"
             join newjitsu."ConfigurationObject" too on too.id = cl."toId"
             left join last_statuses ls on ls."actorId" = cl.id and ls.type = cl.type
             left join status_changes sc on sc."actorId" = ls."actorId" and sc.type = ls.type and sc."tableName" = ls."tableName"
      where fr.deleted = false
        and too.deleted = false
        and w.deleted = false
    `);
    for (const row of r.rows) {
      row.changesPerHours = parseInt(row.changesPerHours);
      row.changesPerDay = parseInt(row.changesPerDay);
      entities[key(row.actorId, row.type)] = row;
      if (row.tableName) {
        entities[key(row.actorId, row.type, row.tableName)] = row;
      }
    }
    const batchActorIdsWithActivity = new Set<string>();
    const incrms = await Promise.all([
      loadBatchStatusesChanges(previousRunTime, entities, batchActorIdsWithActivity),
      loadSyncStatusesChanges(previousRunTime, entities),
      loadDeadStatusesChanges(currentRunTime, entities),
    ]);
    const increments = new Map<bigint, StatusRepeats>([...incrms[0], ...incrms[1], ...incrms[2]]);
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

    // Connection-level aggregate rows are derivative of per-table state. Persist them BEFORE the
    // findMany inside processStatusChanges so they flow through aggrStatues like any other row.
    await prepareBatchAggregateRows(entities, batchActorIdsWithActivity, dryRun);

    const res = await processStatusChanges(processedTimestamp, entities, publicEndpoints, dryRun);
    processedTimestamp = res.date;

    if (!dryRun) {
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
    }
    return res.statuses;
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
        const merged = { ...omit(row, "config"), ...(row.config as any) } as unknown as NotificationChannel;
        // Channels saved before this field existed have it undefined — default to true.
        if (merged.summarizeBatchNotificationsByTable === undefined) {
          merged.summarizeBatchNotificationsByTable = true;
        }
        channelsByWorkspace.push(merged);
      }
    });

  const res = await db.pgPool()
    .query(`select distinct wa."workspaceId", wa."userId", u.email, u.name, upw.preferences "workspacePref", upg.preferences "globalPref" from newjitsu."WorkspaceAccess" wa
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
    if (settings.syncs || settings.batches || settings.dead) {
      const events: ("all" | "sync" | "batch" | "dead")[] = [];
      if (settings.syncs) {
        events.push("sync");
      }
      if (settings.batches) {
        events.push("batch");
      }
      if (settings.dead) {
        events.push("dead");
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
        recurringAlertsPeriodHours: settings.recurringAlertsPeriodHours
          ? Number(settings.recurringAlertsPeriodHours)
          : 168,
        type: "notification",
        workspaceId: row.workspaceId,
        summarizeBatchNotificationsByTable: settings.summarizeBatchNotificationsByTable !== false,
      });
    }
  }
  return channels;
}

async function processStatusChanges(
  processedTimestamp: Date,
  entities: Record<string, StatusChangeEntity>,
  publicEndpoints: any,
  dryRun: boolean
): Promise<{ date: Date; statuses: SendStatus[] }> {
  log.atInfo().log(`Loading changes from ${processedTimestamp.toISOString()}`);
  const sendStatuses: SendStatus[] = [];
  const statusChanges = await db.prisma().statusChange.findMany({
    where: {
      timestamp: { gt: processedTimestamp },
    },
    orderBy: [{ timestamp: "asc" }],
  });

  log.atInfo().log(`Got ${statusChanges.length} new status changes`);

  if (statusChanges.length === 0) {
    return { date: processedTimestamp, statuses: sendStatuses };
  }

  const channels = await loadNotificationsChannels();

  const channelStates: Record<string, NotificationState> = {};
  const states = await db.prisma().notificationState.findMany({});
  for (const state of states) {
    channelStates[chKey(state.channelId, state.actorId, state.type, state.tableName)] = state;
  }

  const aggrStatues: Record<string, StatusChange[]> = {};
  for (const change of statusChanges) {
    const k = key(change.actorId, change.type, change.tableName);
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
    if (!entity) {
      log.atWarn().log(`No entity for key ${k} — skipping notification dispatch`);
      continue;
    }
    // Aggregate rows are stored under a dedicated type for state-tracking, but for channel
    // subscription and template selection we treat them as "batch".
    const isAggregateRow = lastStatus.type === BATCH_AGGREGATE_TYPE;
    const channelEventType: "batch" | "sync" | "dead" = isAggregateRow ? "batch" : (lastStatus.type as any);
    for (const channel of [...(channels[entity.workspaceId] || []), ...(channels["admin"] || [])]) {
      if (!channel.events.includes(channelEventType) && !channel.events.includes("all")) {
        continue;
      }
      // Per-table batch rows go through the per-table path only when the channel doesn't summarize
      // by table; aggregate rows go through only when it does.
      if (lastStatus.type === "batch" && lastStatus.tableName && channel.summarizeBatchNotificationsByTable) {
        continue;
      }
      if (isAggregateRow && !channel.summarizeBatchNotificationsByTable) {
        continue;
      }
      const cStatuses = [...statuses];
      const chkey = chKey(channel.id, lastStatus.actorId, lastStatus.type, lastStatus.tableName);
      let state = channelStates[chkey];
      const sendRecurringTime =
        (state?.lastNotification?.getTime() || 0) + channel.recurringAlertsPeriodHours * 60 * 60 * 1000;
      let doNotify = false;

      // no flapping state or no saved state for this entity at all
      if (!state?.flappingSince) {
        if (entity.changesPerHours > flappingThreshold && (lastStatus.status !== "SUCCESS" || statuses.length > 1)) {
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
      } else if (
        lastStatus.timestamp.getTime() > sendRecurringTime &&
        (lastStatus.status !== "SUCCESS" || statuses.length > 1)
      ) {
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
        const st = await processNotification(channel, channelStates, cStatuses, entity, publicEndpoints, dryRun);
        if (st) {
          sendStatuses.push(st);
        }
      }
    }
  }

  return { date: processedTimestamp, statuses: sendStatuses };
}

type BatchConnectionAggregate = {
  workspaceId: string;
  actorId: string;
  workspaceName: string;
  slug: string;
  fromName: string;
  toName: string;
  perTableCount: number;
  failedTableNames: string[];
  aggStatus: "SUCCESS" | "FAILED" | "PARTIAL";
  aggStreamsFailed?: string;
  aggIncidentDetails: string;
  latestFailureDescription?: string;
  aggTimestamp: Date;
  aggStartedAt: Date;
  aggQueueSize: number;
  // True iff this connection has ever had a per-table StatusChange row before this run.
  // Distinguishes a genuinely brand-new connection (worth a FIRST_RUN aggregate notification)
  // from an existing healthy connection being seen on a new aggregate channel for the first time.
  hasPriorHistory: boolean;
};

function computeBatchConnectionAggregate(
  entities: Record<string, StatusChangeEntity>,
  actorId: string
): BatchConnectionAggregate | undefined {
  let template: StatusChangeEntity | undefined;
  // Track the latest activity timestamp separately. In-place updates in updateStatusChange
  // refresh the row's timestamp without changing the id, so id-order does not reliably track
  // real activity across tables.
  let latestActivityTimestamp: Date | undefined;
  let latestActivityEntity: StatusChangeEntity | undefined;
  let earliestIncidentStart: Date | undefined;
  const failedTableNames: string[] = [];
  let perTableCount = 0;
  let latestFailureTimestamp: Date | undefined;
  let latestFailureDescription: string | undefined;
  let aggQueueSize = 0;
  // `entities` indexes each per-table row under TWO keys (the connection-level `${actorId}::batch`
  // overwrite and the table-specific `${actorId}::batch:${tableName}`), so iterating its values
  // double-counts one row per actor. Dedupe by tableName to keep counts accurate.
  const seenTableNames = new Set<string>();
  const staleTableCutoff = new Date(Date.now() - aggregateStaleTableCutoffDays * 24 * 60 * 60 * 1000);
  for (const ent of Object.values(entities)) {
    if (ent.actorId !== actorId || ent.type !== "batch" || !ent.tableName) continue;
    if (seenTableNames.has(ent.tableName)) continue;
    // Exclude tables with no recent activity. Without this, a long-stale FAILED row drags the
    // aggregate to PARTIAL whenever any other table transitions, producing spurious alerts about
    // tables that haven't been written to in months.
    if (ent.timestamp && ent.timestamp < staleTableCutoff) continue;
    seenTableNames.add(ent.tableName);
    perTableCount++;
    template = template ?? ent;
    if (ent.timestamp && (!latestActivityTimestamp || ent.timestamp > latestActivityTimestamp)) {
      latestActivityTimestamp = ent.timestamp;
      latestActivityEntity = ent;
    }
    if (ent.status !== "SUCCESS") {
      failedTableNames.push(ent.tableName!);
      if (ent.startedAt && (!earliestIncidentStart || ent.startedAt < earliestIncidentStart)) {
        earliestIncidentStart = ent.startedAt;
      }
      // Pick the latest failure's description so the "Latest error" line in the notification is
      // genuinely the most recent error, not whichever failed table happens to iterate first.
      if (ent.timestamp && (!latestFailureTimestamp || ent.timestamp > latestFailureTimestamp)) {
        latestFailureTimestamp = ent.timestamp;
        latestFailureDescription = extractDescription(ent as unknown as StatusChange) ?? ent.description ?? undefined;
      }
    }
    aggQueueSize += ent.queueSize || 0;
  }
  if (!template || !latestActivityEntity || perTableCount === 0) return undefined;
  const failedCount = failedTableNames.length;
  const succeededCount = perTableCount - failedCount;
  let aggStatus: "SUCCESS" | "FAILED" | "PARTIAL";
  let aggStreamsFailed: string | undefined;
  let aggIncidentDetails: string;
  if (failedCount === 0) {
    aggStatus = "SUCCESS";
    aggIncidentDetails = `All ${perTableCount} table(s) succeeded.`;
  } else if (succeededCount === 0) {
    aggStatus = "FAILED";
    aggIncidentDetails = `All ${perTableCount} table(s) failed: ${failedTableNames.join(", ")}.\n\nLatest error:\n${
      latestFailureDescription ?? ""
    }`;
  } else {
    aggStatus = "PARTIAL";
    aggStreamsFailed = `${failedCount} of ${perTableCount}`;
    aggIncidentDetails = `${aggStreamsFailed} tables failed: ${failedTableNames.join(", ")}.\n\nLatest error:\n${
      latestFailureDescription ?? ""
    }`;
  }
  return {
    workspaceId: template.workspaceId!,
    actorId,
    workspaceName: template.workspaceName,
    slug: template.slug,
    fromName: template.fromName,
    toName: template.toName,
    perTableCount,
    failedTableNames,
    aggStatus,
    aggStreamsFailed,
    aggIncidentDetails,
    latestFailureDescription,
    aggTimestamp: latestActivityEntity.timestamp!,
    aggStartedAt: earliestIncidentStart ?? latestActivityEntity.startedAt!,
    aggQueueSize,
    // The no-tableName entity is written only by the initial SQL loader (loadBatchStatusesChanges
    // only mutates per-tableName keys for events with a parseable table name, which is the only
    // case that reaches this aggregate path). A non-null timestamp there means the loader's left
    // join to last_statuses matched at least one prior row — i.e. this connection has history.
    hasPriorHistory: !!entities[key(actorId, "batch")]?.timestamp,
  };
}

// Persist connection-level aggregate rows (type = BATCH_AGGREGATE_TYPE) BEFORE
// processStatusChanges' findMany, so they flow through aggrStatues and get dispatched by the
// per-channel loop exactly like per-table rows. This mirrors how updateStatusChange handles
// per-table rows in loadBatchStatusesChanges.
//
// For each actor with new batch activity this cron run:
//   - On status transition vs the latest aggregate row (and not a suppress case): create a new
//     aggregate row. Bake the full notification payload — including the original incidentStartedAt —
//     into the description JSON, so fillNotificationProps can read it back via extraPayload at
//     render time.
//   - Without a transition: update the existing aggregate row's timestamp so the findMany picks
//     it up (mirrors how per-table rows get their timestamps bumped via the increments map).
async function prepareBatchAggregateRows(
  entities: Record<string, StatusChangeEntity>,
  actorIdsWithActivity: Set<string>,
  dryRun: boolean
): Promise<void> {
  if (dryRun) return;
  for (const actorId of actorIdsWithActivity) {
    const view = computeBatchConnectionAggregate(entities, actorId);
    if (!view) continue;

    const latestAggEnt = entities[key(actorId, BATCH_AGGREGATE_TYPE)];
    const hadPriorAggRow = !!latestAggEnt?.timestamp;
    const prevStatus = hadPriorAggRow ? latestAggEnt!.status : undefined;
    const aggregateTransitioned = !hadPriorAggRow || prevStatus !== view.aggStatus;

    // Suppress: existing healthy connection seen for the first time on the aggregate path. Don't
    // write a row — future failures will create one and resume normal transition tracking.
    if (!hadPriorAggRow && view.aggStatus === "SUCCESS" && view.hasPriorHistory) {
      continue;
    }

    if (aggregateTransitioned) {
      // Bake the full notification payload into the new row's description, mirroring how
      // updateStatusChange does it for per-table RECOVERED/FIRST_RUN rows. Templates pick the
      // render variant via the description's `status` field (spread by fillNotificationProps).
      const persistedDescription = buildAggregateRowDescription(view, latestAggEnt);
      const row = await db.prisma().statusChange.create({
        data: {
          workspaceId: view.workspaceId,
          actorId,
          type: BATCH_AGGREGATE_TYPE,
          tableName: "",
          timestamp: view.aggTimestamp,
          // startedAt is transition time — the loader SQL's status_changes CTE sums by startedAt
          // within the flapping window. The original incident-start is carried inside the
          // description JSON for templates to use.
          startedAt: view.aggTimestamp,
          status: view.aggStatus,
          description: persistedDescription,
          // counts === 0 marks "first ever aggregate row for this actor" — the per-channel loop's
          // !state branch uses this as the FIRST_RUN signal (same idiom as per-table).
          counts: hadPriorAggRow ? 1 : 0,
          queueSize: view.aggQueueSize,
        },
      });
      // Update the in-memory entity so the per-channel loop sees the just-written row's data
      // (including the bumped changesPerHours, used by the FLAPPING signal).
      entities[key(actorId, BATCH_AGGREGATE_TYPE)] = {
        ...(latestAggEnt as StatusChangeEntity),
        id: row.id,
        actorId,
        type: BATCH_AGGREGATE_TYPE,
        tableName: "",
        timestamp: view.aggTimestamp,
        startedAt: view.aggTimestamp,
        status: view.aggStatus,
        description: persistedDescription,
        counts: hadPriorAggRow ? 1 : 0,
        queueSize: view.aggQueueSize,
        changesPerHours: (latestAggEnt?.changesPerHours || 0) + 1,
        changesPerDay: (latestAggEnt?.changesPerDay || 0) + 1,
      };
    } else {
      // No transition. Bump the existing aggregate row's timestamp (and queueSize) so the
      // findMany picks it up — without this, recurring/ONGOING checks would never see it.
      // Preserve the row's description (it carries incidentStartedAt for the ongoing incident).
      await db.prisma().statusChange.update({
        where: { id: BigInt(latestAggEnt!.id) },
        data: {
          timestamp: view.aggTimestamp,
          counts: { increment: 1 },
          queueSize: view.aggQueueSize,
        },
      });
      // Reflect the bumped timestamp in the in-memory entity.
      entities[key(actorId, BATCH_AGGREGATE_TYPE)] = {
        ...latestAggEnt!,
        timestamp: view.aggTimestamp,
        queueSize: view.aggQueueSize,
      };
    }
  }
}

// Build the description JSON we persist on a new aggregate row. The shape mirrors how
// updateStatusChange + the per-channel loop produce description payloads for per-table rows:
// the JSON's `status` field selects the email/slack template via fillNotificationProps'
// extraPayload spread, and `incidentStartedAt`/`incidentDetails`/etc. populate the meta block.
function buildAggregateRowDescription(
  view: BatchConnectionAggregate,
  latestAggEnt: StatusChangeEntity | undefined
): string {
  const hadPriorAggRow = !!latestAggEnt?.timestamp;
  const prevStatus = hadPriorAggRow ? latestAggEnt!.status : undefined;
  const prevPayload = parseJsonDescription(latestAggEnt?.description);

  if (view.aggStatus === "SUCCESS") {
    if (hadPriorAggRow && prevStatus !== "SUCCESS") {
      // RECOVERED — use the original incident start from the previous non-success row's payload
      // (it was inherited row-by-row across mid-incident transitions).
      const incidentStartedAt = prevPayload?.incidentStartedAt ?? latestAggEnt!.startedAt?.toISOString();
      return (
        _J_PREF +
        JSON.stringify({
          status: "RECOVERED",
          incidentStatus: prevStatus,
          incidentStartedAt,
          incidentDetails: view.aggIncidentDetails,
        })
      );
    }
    // Brand-new connection's first observed run — emit FIRST_RUN. (The suppress case for existing
    // healthy connections was filtered out by the caller.)
    return _J_PREF + JSON.stringify({ status: "FIRST_RUN", incidentDetails: view.aggIncidentDetails });
  }

  // Non-SUCCESS row (PARTIAL or FAILED). The row's status column drives template selection; we
  // include `description`/`streamsFailed`/`incidentDetails` for the meta block, and carry
  // `incidentStartedAt` so future RECOVERED can use the original start time.
  const prevWasNonSuccess = hadPriorAggRow && prevStatus !== "SUCCESS";
  const incidentStartedAt = prevWasNonSuccess
    ? prevPayload?.incidentStartedAt ?? latestAggEnt!.startedAt?.toISOString()
    : view.aggStartedAt.toISOString();

  if (view.aggStatus === "PARTIAL") {
    return (
      _J_PREF +
      JSON.stringify({
        description: view.aggIncidentDetails,
        streamsFailed: view.aggStreamsFailed,
        incidentDetails: view.aggIncidentDetails,
        incidentStartedAt,
      })
    );
  }
  // FAILED
  return (
    _J_PREF +
    JSON.stringify({
      description: view.latestFailureDescription ?? "",
      incidentDetails: view.aggIncidentDetails,
      incidentStartedAt,
    })
  );
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
    type: statusChange.type,
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
      channelId_actorId_type_tableName: {
        channelId: channel.id,
        actorId: lastStatus.actorId,
        type: lastStatus.type,
        tableName: lastStatus.tableName,
      },
    },
    create: state,
    update: state,
  });
  channelStates[chKey(channel.id, lastStatus.actorId, lastStatus.type, lastStatus.tableName)] = state;
  return state;
}

async function processNotification(
  channel: NotificationChannel,
  channelStates: Record<string, NotificationState>,
  statusChanges: StatusChange[],
  entity: StatusChangeEntity,
  publicEndpoints: PublicEndpoint,
  dryRun: boolean
) {
  const chkey = chKey(channel.id, entity.actorId, entity.type, entity.tableName);
  let error: string | undefined = undefined;
  const state = channelStates[chKey(channel.id, entity.actorId, entity.type, entity.tableName)];
  const lastStatus = statusChanges[statusChanges.length - 1];
  let flappingSince: Date | null =
    lastStatus.status === "FLAPPING" ? state?.flappingSince || lastStatus.timestamp : null;
  let status: SendStatus | undefined = undefined;

  try {
    if (channel.channel === "slack") {
      status = await sendSlackNotification(channel, entity, statusChanges, publicEndpoints.baseUrl, dryRun);
    } else if (channel.channel === "email") {
      status = await sendEmailNotification(channel, entity, statusChanges, publicEndpoints.baseUrl, dryRun);
    }
    if (status) {
      log
        .atInfo()
        .log(
          `[${chkey}] ${channel.channel} notification ${status.dryRun ? "dry run" : "sent"}. Id: ${entity.id} ts: ${
            entity.timestamp
          }`
        );
    }
  } catch (e: any) {
    log
      .atError()
      .log(
        `[${chkey}] Failed to process ${channel.channel} notification. Id: ${entity.id} ts: ${entity.timestamp}: ${e.message}`
      );
    error = e.message;
  } finally {
    if (!dryRun) {
      await db.prisma().notification.create({
        data: {
          workspaceId: entity.workspaceId,
          actorId: entity.actorId,
          type: entity.type,
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
  return status;
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
      let entity = entities[key(row.sync_id, "sync")];
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
  entities: Record<string, StatusChangeEntity>,
  actorIdsWithActivity: Set<string>
): Promise<Map<bigint, StatusRepeats>> {
  const increments: Map<bigint, StatusRepeats> = new Map();
  const sw = stopwatch();
  const actorIds = [
    ...new Set(
      Object.entries(entities)
        .filter(([_, b]) => b.type === "batch")
        .map(([_, s]) => s.actorId)
    ),
  ];
  let processed = 0;
  let statusChanges = 0;

  // noinspection SqlResolve
  const eventsLogQuery: string = `select actorId, level, timestamp, message
                                  from events_log
                                  where type = 'bulker_batch'
                                    and timestamp > toDateTime({fromTimestamp:String}, 'UTC')
                                    and has({actorIds:Array(String)}, actorId)
                                  order by timestamp
                                          asc`;
  const processChunk = async (chunk: string[]) => {
    const chResult = await clickhouse.query({
      query: eventsLogQuery,
      query_params: {
        fromTimestamp: dateToClickhouse(fromTimestamp),
        actorIds: chunk,
      },
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: 180,
        wait_end_of_query: 1,
      },
    });
    for await (const rows of chResult.stream()) {
      for (const r of rows) {
        processed++;
        const row = r.json() as any;
        let entity = entities[key(row.actorId, "batch")];
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
          let entityWithTable = entities[key(row.actorId, "batch", tableName)];
          if (!entityWithTable) {
            entityWithTable = { ...entity, tableName, type: "batch" };
            entities[key(row.actorId, "batch", tableName)] = entityWithTable;
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
        // Any batch event reaching this point counts as activity for the connection-level
        // aggregate (whether or not it triggered a per-table transition).
        actorIdsWithActivity.add(row.actorId);

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
  };

  //process by chunks of 500 actorIds
  const promises: Promise<void>[] = [];
  for (let i = 0; i < actorIds.length; i += 200) {
    const chunk = actorIds.slice(i, i + 200);
    promises.push(processChunk(chunk));
  }
  await Promise.all(promises);
  log
    .atInfo()
    .log(`Events log processed. Rows: ${processed}. Status changes: ${statusChanges}. Elapsed: ${sw.elapsedPretty()}`);
  return increments;
}

async function loadDeadStatusesChanges(
  currentRunTime: Date,
  entities: Record<string, StatusChangeEntity>
): Promise<Map<bigint, StatusRepeats>> {
  const increments: Map<bigint, StatusRepeats> = new Map();
  const sw = stopwatch();
  const actorIds = [
    ...new Set(
      Object.entries(entities)
        .filter(([_, b]) => b.type === "dead")
        .map(([_, s]) => s.actorId)
    ),
  ];
  let processed = 0;
  let statusChanges = 0;

  const serverEnv = getServerEnv();

  // noinspection SqlResolve
  const eventsLogQuery: string = `select workspaceId, actorId, type, 
                                    count() cnt,  
                                    argMax(error, timestamp) as last_error, 
                                    max(timestamp) as last_failed_at
                                  from dead_letter
                                  where has({actorIds:Array(String)}, actorId)
                                  GROUP BY workspaceId, actorId, type`;
  const processChunk = async (chunk: string[]) => {
    const chResult = await clickhouse.query({
      query: eventsLogQuery,
      query_params: {
        // fromTimestamp: dateToClickhouse(fromTimestamp),
        actorIds: chunk,
      },
      format: "JSONEachRow",
      clickhouse_settings: {
        max_execution_time: 180,
        wait_end_of_query: 1,
      },
    });
    for await (const rows of chResult.stream()) {
      for (const r of rows) {
        processed++;
        const row = r.json() as any;
        const rowTimestamp = dayjs(row.last_failed_at, { utc: true }).toDate();
        const hoursSinceLastFailure = (currentRunTime.getTime() - rowTimestamp.getTime()) / 36e5;
        log
          .atInfo()
          .log(
            `Dead letter ${
              row.actorId
            } last failed at ${rowTimestamp.toISOString()} hours since last failure: ${hoursSinceLastFailure}`
          );
        const status = hoursSinceLastFailure >= 24 ? "SUCCESS" : "FAILED";

        let entity = entities[key(row.actorId, "dead")];
        if (!entity) {
          log.atWarn().log(`Dead-letter ${row.actorId} not found`);
          continue;
        }
        const queueSize = parseInt(row.cnt);

        let errrorObj: any = {};
        try {
          errrorObj = JSON.parse(row.last_error);
        } catch (e) {}
        let description = errrorObj.error || row.last_error;

        const chId = await updateStatusChange(
          entities,
          entity,
          rowTimestamp,
          status,
          queueSize,
          description,
          increments
        );
        if (chId) {
          statusChanges++;
        }
      }
    }
  };
  //process by chunks of 500 actorIds
  const promises: Promise<void>[] = [];
  for (let i = 0; i < actorIds.length; i += 200) {
    const chunk = actorIds.slice(i, i + 200);
    promises.push(processChunk(chunk));
  }
  await Promise.all(promises);
  log
    .atInfo()
    .log(`Dead log processed. Rows: ${processed}. Status changes: ${statusChanges}. Elapsed: ${sw.elapsedPretty()}`);
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
        type: entity.type!,
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
      log
        .atInfo()
        .log(`${entity.actorId} ${entity.tableName} status changed from ${entity.status} to ${status} at ${timestamp}`);
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
    } as StatusChangeEntity;
    entities[key(entity.actorId, entity.type, entity.tableName)] = entity;
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
  entityType?: string;
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
    textArray.push(`${props.entityType === "batch" ? "Tables" : "Streams"} Failed: ${props.streamsFailed}`);
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
    metaBlock(
      pick(props, "tableName", "incidentStatus", "incidentStartedAt", "queueSize", "streamsFailed", "entityType")
    ),
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
  header: props => `:large_yellow_circle: ${jobName(props)} partial failure`,
  description: props => [
    `Jitsu ${jobName(props)} *partially failed* :persevere:.`,
    ``,
    `The job was triggered in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace from *${props.entityFrom}* to *${props.entityTo}*`,
  ],
  metaBlock: props => metaBlock(pick(props, "streamsFailed", "incidentStatus", "incidentStartedAt", "entityType")),
  footer: props =>
    props.recurringAlertsPeriodHours
      ? `No additional reports will be sent for this connection in ${props.recurringAlertsPeriodHours} hours unless the status changes.`
      : "",
};

const DeadLetteredMessages: SlackTemplate = {
  text: props => `:red_circle: Unrecoverable Errors in the connection ${props.entityName} [${props.workspaceName}]`,
  header: props => `:red_circle: Unrecoverable Errors in the connection ${props.entityName} [${props.workspaceName}]`,
  description: props => [
    `*Unrecoverable Errors* occurred in the connection from *${props.entityFrom}* to *${props.entityTo}* :persevere:.`,
    ``,
    `Connection from *${props.entityFrom}* to *${props.entityTo}* in *<${props.baseUrl}/${props.workspaceSlug}|${props.workspaceName}>* workspace has accumulated *${props.queueSize}* unrecoverable errors.`,
  ],
  metaBlock: props => "",
  footer: props =>
    props.recurringAlertsPeriodHours
      ? `No additional reports will be sent for this connection in ${props.recurringAlertsPeriodHours} hours.`
      : "",
};

type SendStatus = {
  type: string;
  dryRun: boolean;
  address: string | string[];
  channelId: string;
  payload: any;
};

export async function sendSlackNotification(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  statusChanges: StatusChange[],
  baseUrl: string,
  dryRun: boolean
): Promise<SendStatus | undefined> {
  const props = fillNotificationProps(channel, entity, statusChanges, baseUrl);

  const selectTemplate = (status: string) => {
    if (entity.type === "dead") {
      if (status === "FAILED" || status === "ONGOING") {
        return DeadLetteredMessages;
      } else {
        return;
      }
    }
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
  if (!template) {
    console.debug(`No Slack template for status ${props.status}, skipping notification.`);
    return;
  }
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
        text: [`*Details*:`, "```", `${trimMiddle(props.incidentDetails, 2000, "\n... TRUNCATED ...\n")}`, "```"].join(
          "\n"
        ),
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

  if (!dryRun) {
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
  return {
    type: channel.type,
    dryRun,
    address: channel.slackWebhookUrl!,
    channelId: channel.id,
    payload: payload,
  };
}

export async function sendEmailNotification(
  channel: NotificationChannel,
  entity: StatusChangeEntity,
  statusChanges: StatusChange[],
  baseUrl: string,
  dryRun: boolean
): Promise<SendStatus | undefined> {
  const props = fillNotificationProps(channel, entity, statusChanges, baseUrl);

  const selectTemplate = (status: string) => {
    if (entity.type === "dead") {
      if (status === "FAILED" || status === "ONGOING") {
        return ConnectionDeadLettered;
      } else {
        return;
      }
    }
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
  if (!template) {
    console.debug(`No Email template for status ${props.status}, skipping notification.`);
    return;
  }
  const res = await sendEmail(template, props, channel.emails!, { dryRun });
  if (!res.sent) {
    return;
  }

  return {
    type: "email",
    dryRun: !!res.dryRun,
    address: channel.emails!,
    channelId: channel.id,
    payload: res,
  };
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

  let detailsUrl = `${baseUrl}/${entity.slug}/data?query={activeView%3A'bulker'%2CviewState%3A{bulker%3A{actorId%3A'${entity.actorId}'}}}`;
  switch (entity.type) {
    case "dead":
      detailsUrl = `${baseUrl}/${entity.slug}/data?query={activeView%3A'dead-letter'%2CviewState%3A{%22dead-letter%22%3A{actorId%3A'${entity.actorId}'}}}`;
      break;
    case "sync":
      detailsUrl = `${baseUrl}/${entity.slug}/syncs/tasks?query={syncId:'${entity.actorId}'}`;
      break;
  }
  // For the connection-level aggregate, render as a "batch" notification (and omit tableName) —
  // the failed-streams summary already conveys per-table context.
  const isAggregate = entity.type === BATCH_AGGREGATE_TYPE;
  return {
    name: channel.name,
    workspaceName: entity.workspaceName,
    workspaceSlug: entity.slug,
    entityId: entity.actorId,
    entityType: isAggregate ? "batch" : entity.type,
    entityName: name,
    entityFrom: entity.fromName,
    entityTo: entity.toName,
    timestamp: lastStatus.timestamp.toISOString(),
    tableName: isAggregate ? undefined : entity.tableName,
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

// Parse the _J_PREF-prefixed JSON payload from a description, if any. Returns the parsed object
// or undefined if the description is not prefixed or fails to parse.
function parseJsonDescription(description: string | null | undefined): any | undefined {
  if (!description || !description.startsWith(_J_PREF)) return undefined;
  try {
    return JSON.parse(description.substring(_J_PREF.length));
  } catch (e) {
    return undefined;
  }
}

export const config = {
  maxDuration: 300,
};
