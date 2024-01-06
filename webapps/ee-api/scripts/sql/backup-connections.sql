-- View that sets up the backup connection for each workspace. (backup connection is a S3 connection where all incoming events are archived)
create or replace view backup_connections as
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
                         'credentials', json_build_object('region', (select s3region from newjitsuee.tmp_s3_credentials),
                                                          'accessKeyId', (select "s3accessKey" from newjitsuee.tmp_s3_credentials),
                                                          'secretAccessKey', (select "s3accessKey" from newjitsuee.tmp_s3_credentials),
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