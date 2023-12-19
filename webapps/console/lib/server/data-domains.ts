export const dataDomains: Set<string> | undefined = process.env.DATA_DOMAIN
  ? new Set(process.env.DATA_DOMAIN.split(","))
  : undefined;

export const mainDataDomain: string | undefined = process.env.DATA_DOMAIN
  ? process.env.DATA_DOMAIN.split(",")[0]
  : undefined;
