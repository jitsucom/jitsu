with workspace_domains as (select ws.name                 as workspaceName,
                                  ws.slug                 as workspaceSlug,
                                  ws."id"                 as workspaceId,
                                  CO.config -> 'domains' as domains


from newjitsu."Workspace" ws
  left join newjitsu."ConfigurationObject" CO
on "ws".id = CO."workspaceId" and CO.type = 'stream'
where CO.config ->> 'domains' is not null
  and CO.config ->> 'domains' <> '[]'),
  workspace_admins as (select ws.name                                           as workspaceName,
  ws.slug                                           as workspaceSlug,
  ws."id"                                           as workspaceId,
  ARRAY_AGG(u.name || '<' || u.email || '>') as users
from newjitsu."Workspace" ws
  left join newjitsu."WorkspaceAccess" acc on ws.id = acc."workspaceId"
  left join newjitsu."UserProfile" u on acc."userId" = u.id
group by 1, 2, 3)


select ws.name    as "workspaceName",
       ws.slug    as "workspaceSlug",
       ws."id"    as "workspaceId",
       dm.domains as domains,
       u.users
from newjitsu."Workspace" ws
     left join workspace_domains dm on dm.workspaceId = ws.id
     left join workspace_admins u on u.workspaceId = ws.id
where ws."deleted" = false
--- TODO: we should probably add `and ws."id" in (:workspaceIds)`

