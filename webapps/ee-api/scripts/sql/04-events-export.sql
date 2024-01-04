-- This view contains a list of events that should trigger user communication such as an email. It combines several sub-views

create or replace view newjitsu."UserNotificationEventsExport"("messageId", "workspaceId", timestamp, email, "eventName") as
WITH workspace_activity AS (SELECT md5(concat_ws(','::text, u.id, 'workspace_event_activity',
                                                 to_char(stat.period, 'YYYY-MM-DD'::text))) AS "messageId",
                                   stat.period                                              AS "timestamp",
                                   w2u."workspaceId",
                                   u.id                                                     AS "userId",
                                   u.email,
                                   'workspace_event_activity'::text                         AS "eventName",
                                   stat.events
                            FROM newjitsu."WorkspaceAccess" w2u
                                 JOIN newjitsu."UserProfile" u ON u.id = w2u."userId"
                                 JOIN newjitsu."Workspace" w ON w2u."workspaceId" = w.id
                                 JOIN external.workspace_stat stat ON w2u."workspaceId" = stat."workspaceId"
                            WHERE stat.events > 0
                            ORDER BY stat.period DESC, stat.events DESC),
     domain_activity AS (SELECT md5(concat_ws(','::text, stat.configured,
                                              to_char(stat."lastUpdated", 'YYYY-MM-DD'::text))) AS "messageId",
                                stat."lastValidated"                                            AS "timestamp",
                                config."workspaceId",
                                w2u."userId",
                                u.email,
                                stat.domain,
                                CASE
                                  WHEN stat.configured THEN 'domain_configuration_succeeded'::text
                                  ELSE 'domain_configuration_attempted'::text
                                  END                                                         AS "eventName"
                         FROM external.domain_stat stat
                              JOIN newjitsu."ConfigurationObject" config ON config.id = stat."sourceId"
                              LEFT JOIN newjitsu."WorkspaceAccess" w2u ON w2u."workspaceId" = config."workspaceId"
                              JOIN newjitsu."UserProfile" u ON u.id = w2u."userId"
                         ORDER BY stat."lastUpdated" DESC, u.email DESC)
SELECT x."messageId",
       x."workspaceId",
       x."timestamp",
       x.email,
       x."eventName"
FROM (SELECT workspace_activity."messageId",
             workspace_activity."workspaceId",
             workspace_activity."timestamp",
             workspace_activity.email,
             workspace_activity."eventName"
      FROM workspace_activity
      UNION ALL
      SELECT domain_activity."messageId",
             domain_activity."workspaceId",
             domain_activity."timestamp",
             domain_activity.email,
             domain_activity."eventName"
      FROM domain_activity) x
ORDER BY x."timestamp" DESC, x."eventName" DESC, x.email DESC;

