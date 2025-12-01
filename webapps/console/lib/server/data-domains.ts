import { getServerEnv } from "./serverEnv";

const serverEnv = getServerEnv();

export const dataDomains: Set<string> | undefined = serverEnv.DATA_DOMAIN
  ? new Set(serverEnv.DATA_DOMAIN.split(","))
  : undefined;

export const mainDataDomain: string | undefined = serverEnv.DATA_DOMAIN
  ? serverEnv.DATA_DOMAIN.split(",")[0]
  : undefined;
