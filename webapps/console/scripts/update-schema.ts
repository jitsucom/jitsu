/* eslint-disable no-restricted-properties -- deployment-only command reads its explicit database configuration. */
import { pushConfigSchema } from "../prisma/update-schema";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
pushConfigSchema(process.env.DATABASE_URL, {
  args: process.argv.slice(2),
  // The standalone Docker image installs Prisma globally, outside module resolution.
  prismaCli: process.env.PRISMA_CLI_PATH,
});
