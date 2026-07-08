declare module "vitest" {
  interface ProvidedContext {
    /** postgres://user:pass@host:port — append /<database> */
    pgUrlBase: string;
    /** Admin connection URL (the `postgres` maintenance database). */
    pgAdminUrl: string;
    /** Name of the sealed template database with the prisma schema applied. */
    pgTemplateDb: string;
    /** http://host:port of the ClickHouse container. */
    chUrl: string;
  }
}

export {};
