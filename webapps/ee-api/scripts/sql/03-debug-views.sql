-- Those views isn't used anywhere in code. It's just for convenience

create or replace view newjitsu."ConnectorsUsage"(slug, package, started_at, status, started_by) as
SELECT workspace.slug,
       task.package,
       task.started_at,
       task.status,
       task.started_by
FROM newjitsu.source_task task
     JOIN newjitsu."ConfigurationObjectLink" sync ON sync.id = task.sync_id
     JOIN newjitsu."Workspace" workspace ON sync."workspaceId" = workspace.id
WHERE workspace.slug <> 'jitsu'::text
ORDER BY task.started_at DESC;


create or replace view newjitsu."AuditLogView"(timestamp, type, email, slug, name, "objectType") as
SELECT l."timestamp",
       l.type,
       u.email,
       ws.slug,
       ws.name,
       COALESCE(l.changes ->> 'objectType'::text, l.changes ->> 'type'::text) AS "objectType"
FROM newjitsu."AuditLog" l
     JOIN newjitsu."Workspace" ws ON l."workspaceId" = ws.id
     JOIN newjitsu."UserProfile" u ON l."userId" = u.id
ORDER BY l."timestamp" DESC;


