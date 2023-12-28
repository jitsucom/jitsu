create or replace view enriched_connections_push as
select
  link.id as "id",
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
  ) as "enrichedConnection"
from "ConfigurationObjectLink" link
     join "Workspace" ws on link."workspaceId" = ws.id and ws.deleted = false
     join "ConfigurationObject" dst
          on dst.id = link."toId" and dst.type = 'destination' and dst."workspaceId" = link."workspaceId" and
             dst.deleted = false
     join "ConfigurationObject" src
          on src.id = link."fromId" and src.type = 'stream' and
             src."workspaceId" = link."workspaceId" and src.deleted = false
where link.deleted = false