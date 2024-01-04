CREATE SCHEMA IF NOT EXISTS newjitsuee;

  CREATE TABLE IF NOT EXISTS newjitsuee.kvstore
(
  id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  obj JSONB NOT NULL default '{}'::jsonb,
  expire TIMESTAMP WITH TIME ZONE,
  primary key (id, namespace)
);
ALTER TABLE newjitsuee.kvstore
  ADD COLUMN IF NOT EXISTS id TEXT NOT NULL;
ALTER TABLE newjitsuee.kvstore
  ADD COLUMN IF NOT EXISTS namespace TEXT NOT NULL;
ALTER TABLE newjitsuee.kvstore
  ADD COLUMN IF NOT EXISTS obj JSONB NOT NULL default '{}'::jsonb;
ALTER TABLE newjitsuee.kvstore
  ADD COLUMN IF NOT EXISTS expire TIMESTAMP WITH TIME ZONE;
