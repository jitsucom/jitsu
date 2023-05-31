import { db } from "./db";
import { StreamConfig } from "../schema";

type DomainAvailability = { available: true; usedInWorkspaces?: never } | { available: false; usedInWorkspace: string };

/**
 * Tells if the given domain is used in other workspaces.
 */
export async function isDomainAvailable(domain: string, workspaceId: string): Promise<DomainAvailability> {
  const pattern = `%${domain.toLowerCase()}%`;
  const dirtyList = (await db.prisma().$queryRaw`
      select "id", "workspaceId", "config"
      from "ConfigurationObject"
      where type = 'stream'
        and config::TEXT ilike ${pattern}
        and "workspaceId" <> ${workspaceId}
  `) as { id: string; workspaceId: string; config: string }[];
  const list = dirtyList.filter(({ config, ...props }) => {
    const stream = StreamConfig.parse({ ...(config as any), ...props });
    return (stream.domains || []).map(d => d.toLowerCase()).includes(domain.toLowerCase());
  });

  if (list.length > 0) {
    return { available: false, usedInWorkspace: list[0].workspaceId };
  } else {
    return { available: true };
  }
}
