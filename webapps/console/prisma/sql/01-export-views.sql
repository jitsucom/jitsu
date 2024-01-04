create or replace view newjitsu.enriched_connections as
select link.id   as "id",
       link.type as "type",
       json_build_object('id', link.id,
                         'workspaceId', ws.id,
                         'destinationId', dst.id,
                         'streamId', src.id,
                         'usesBulker', link."data" ?& array ['mode', 'dataLayout'],
                         'type', dst."config" ->> 'destinationType',
                         'options', link.data,
                         'updatedAt', to_char(link."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                         'credentials', dst.config,
                         'credentialsHash', md5(dst.config::text)
       )         as "enrichedConnection"
from newjitsu."ConfigurationObjectLink" link
         join newjitsu."Workspace" ws on link."workspaceId" = ws.id and ws.deleted = false
         join newjitsu."ConfigurationObject" dst
              on dst.id = link."toId" and dst.type = 'destination' and dst."workspaceId" = link."workspaceId" and
                 dst.deleted = false
         join newjitsu."ConfigurationObject" src
              on src.id = link."fromId" and src.type in ('stream', 'service') and
                 src."workspaceId" = link."workspaceId" and src.deleted = false
where link.deleted = false;

create or replace view last_updated as select greatest(
                                                      (select max("updatedAt") from "ConfigurationObjectLink"),
                                                      (select max("updatedAt") from "ConfigurationObject"),
                                                      (select max("updatedAt") from "Workspace")
                                              ) as "last_updated";

create or replace view newjitsu.streams_with_destinations as
select b."streamId",
       json_build_object('stream', b."srcConfig",
                         'deleted', b."deleted",
                         'backupEnabled', true,
                         'destinations', b."connectionData",
                         'updatedAt', to_char(b."updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
from (select src.id                                                                            as "streamId",
             ws.id,
             src.deleted or ws.deleted                                                         as "deleted",
             (src."config" || jsonb_build_object('id', src.id, 'workspaceId', ws.id))          as "srcConfig",
             json_agg(case
                          when dst.id is not null and
                               dst.deleted = false and
                               link.id is not null and
                               link.deleted = false
                          then json_build_object('id', dst.id,
                                                     'credentials', dst."config",
                                                     'destinationType', dst."config" ->> 'destinationType',
                                                     'connectionId', link."id",
                                                     'options', link."data")
                 end)                                                                          as "connectionData",
             max(greatest(link."updatedAt", src."updatedAt", dst."updatedAt", ws."updatedAt")) as "updatedAt"
      from newjitsu."ConfigurationObject" src
               join newjitsu."Workspace" ws on src."workspaceId" = ws.id
               left join newjitsu."ConfigurationObjectLink" link
                         on src.id = link."fromId" and link."workspaceId" = src."workspaceId"
               left join newjitsu."ConfigurationObject" dst
                         on dst.id = link."toId" and dst.type = 'destination' and dst."workspaceId" = link."workspaceId"
      where src."type" = 'stream'
      group by 1, 2) b