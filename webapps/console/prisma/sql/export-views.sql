create or replace view enriched_connections as
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
from "ConfigurationObjectLink" link
         join "Workspace" ws on link."workspaceId" = ws.id and ws.deleted = false
         join "ConfigurationObject" dst
              on dst.id = link."toId" and dst.type = 'destination' and dst."workspaceId" = link."workspaceId" and
                 dst.deleted = false
         join "ConfigurationObject" src
              on src.id = link."fromId" and src.type in ('stream', 'service') and
                 src."workspaceId" = link."workspaceId" and src.deleted = false
where link.deleted = false;

create or replace view streams_with_destinations as
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
      from "ConfigurationObject" src
               join "Workspace" ws on src."workspaceId" = ws.id
               left join "ConfigurationObjectLink" link
                         on src.id = link."fromId" and link."workspaceId" = src."workspaceId"
               left join "ConfigurationObject" dst
                         on dst.id = link."toId" and dst.type = 'destination' and dst."workspaceId" = link."workspaceId"
      where src."type" = 'stream'
      group by 1, 2) b