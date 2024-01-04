-- View that sets up the backup connection for each workspace. (backup connection is a S3 connection where all incoming events are archived)
create or replace view newjitsu.backup_connections as
select ws.id || '_backup' as "id",
       json_build_object('id', ws.id || '_backup',
                         'special', 'backup',
                         'workspaceId', ws.id,
                         'destinationId', ws.id || '_backup',
                         'streamId', 'backup',
                         'usesBulker', true,
                         'type', 's3',
                         'options', json_build_object('dataLayout', 'passthrough',
                                                      'deduplicate', false,
                                                      'primaryKey', '',
                                                      'timestampColumn', '',
                                                      'frequency', 60,
                                                      'batchSize', 1000000,
                                                      'mode', 'batch'),
                         'credentials', json_build_object('region', '${S3_REGION}',
                                                          'accessKeyId', '${S3_ACCESS_KEY_ID}',
                                                          'secretAccessKey', '${S3_SECRET_ACCESS_KEY}',
                                                          'bucket', ws.id || '.data.use.jitsu.com',
                                                          'compression', 'gzip',
                                                          'format', 'ndjson',
                                                          'folder', '[DATE]'),
                         'credentialsHash', ''
       )                  as "enrichedConnection"
from newjitsu."Workspace" ws
where deleted = false
  and not 'nobackup' = ANY ("featuresEnabled")
  and (select count(*) from newjitsu."ConfigurationObjectLink" where "workspaceId" = ws.id and type='push' and deleted = false) > 0