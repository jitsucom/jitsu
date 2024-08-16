CREATE SCHEMA IF NOT EXISTS newjitsuee;

CREATE TABLE IF NOT EXISTS newjitsuee.stat_cache
(
  "workspaceId" TEXT NOT NULL,
  "period" TIMESTAMP WITHOUT TIME ZONE,
  "events" NUMERIC NOT NULL
);

--ALTER TABLE newjitsuee.stat_cache add CONSTRAINT stat_cache_pk PRIMARY KEY ("workspaceId", "period");
ALTER TABLE newjitsuee.stat_cache ADD COlUMN IF NOT EXISTS "syncs" NUMERIC NOT NULL DEFAULT 0;

