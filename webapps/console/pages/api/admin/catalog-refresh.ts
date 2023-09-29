import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { assertDefined, assertTrue, rpc } from "juava";
import { z } from "zod";
import { getServerLog } from "../../../lib/server/log";

const log = getServerLog("catalog-refresh");
const yaml = require("js-yaml");
const branch = `master`;
const repo = `airbytehq/airbyte`;
const basePath = `airbyte-integrations/connectors`;

function shuffle<T>(arr: T[]) {
  let currentIndex = arr.length;
  let temporaryValue: T;
  let randomIndex: number;

  while (0 !== currentIndex) {
    randomIndex = Math.floor(Math.random() * currentIndex--);
    temporaryValue = arr[currentIndex];
    arr[currentIndex] = arr[randomIndex];
    arr[randomIndex] = temporaryValue;
  }

  return arr;
}

export default createRoute()
  .GET({ auth: true, query: z.object({ limit: z.string().optional(), source: z.string().optional() }) })
  .handler(async ({ user, req, query }) => {
    const userProfile = await db.prisma().userProfile.findFirst({ where: { id: user.internalId } });

    assertDefined(userProfile, "User profile not found");
    assertTrue(userProfile.admin, "Not enough permissions");

    const sources: string[] = (await rpc(`https://api.github.com/repos/${repo}/contents/${basePath}?ref=${branch}`))
      .filter(({ name }) => name.startsWith("source-"))
      .filter(({ name }) => !query.source || name === query.source || `airbyte/${name}` === query.source)
      .map(({ name }) => name);

    shuffle(sources);

    log.atInfo().log(`Found ${sources.length} sources`);
    const max = query.limit ? Math.min(parseInt(query.limit), sources.length) : sources.length;
    const statuses = {};

    for (let i = 0; i < max; i++) {
      const mitVersions = new Set<string>();
      const src = sources[i];
      const metadataUrl = `https://raw.githubusercontent.com/${repo}/master/${basePath}/${src}/metadata.yaml`;
      const res = await fetch(metadataUrl);
      let packageId: string | undefined = undefined;
      let metadata: any = {};
      let icon: string | undefined = undefined;
      if (res.ok) {
        metadata = yaml.load(await res.text());

        const license = metadata.data?.license?.toLowerCase();

        if (license === "elv2") {
          const commitHistory = `https://api.github.com/repos/${repo}/commits?path=/${basePath}/${src}/metadata.yaml`;
          log.atWarn().log(`Source ${src} has ELv2 license. Looking for MIT versions at ${commitHistory}`);
          const commits = await rpc(commitHistory);
          log.atInfo().log(`Found ${commits.length} commits`);
          for (const { sha } of commits) {
            const commitFile = `https://raw.githubusercontent.com/${repo}/${sha}/${basePath}/${src}/metadata.yaml`;
            const oldYml = await fetch(commitFile);
            if (oldYml.ok) {
              const oldMeta = yaml.load(await oldYml.text());
              if (oldMeta.data?.license?.toLowerCase() === "mit") {
                const dockerVersion = oldMeta.data?.dockerImageTag;
                if (!dockerVersion) {
                  log.atWarn().log(`MIT version of ${src} doesn't have dockerImageTag: ${commitFile}`);
                } else {
                  log.atWarn().log(`Found MIT version of ${src} --> ${dockerVersion}`);
                  mitVersions.add(dockerVersion);
                }
              }
            } else {
              log.atWarn().log(`Failed to load ${commitFile}`);
            }
          }
        }

        packageId = metadata.data?.dockerRepository || `airbyte/${src}`;
      } else {
        log.atWarn().log(`Source ${src} doesn't have metadata.yaml`);
        packageId = `airbyte/${src}`;
      }

      if (metadata?.data?.icon) {
        const iconUrl = `https://raw.githubusercontent.com/${repo}/master/${basePath}/${src}/icon.svg`;
        const iconRes = await fetch(iconUrl);
        if (iconRes.ok) {
          icon = await iconRes.text();
        } else {
          log.atWarn().log(`Source ${src} icon file ${metadata.data?.icon} doesn't exist at ${iconUrl}`);
        }
      }

      const currentId = (
        await db.prisma().connectorPackage.findFirst({ where: { packageId: packageId, packageType: "airbyte" } })
      )?.id;
      const data = {
        packageId: packageId as string,
        packageType: "airbyte",
        meta: {
          ...(metadata?.data || {}),
          ...([...mitVersions].length > 0 ? { mitVersions: [...mitVersions] } : {}),
        },
        logoSvg: icon,
      };
      if (currentId) {
        statuses[`${packageId}`] = "updated";
        log.atInfo().log(`Updating ${packageId} info. Has icon: ${!!icon}, has metadata: ${!!metadata}`);
        await db.prisma().connectorPackage.update({ where: { id: currentId }, data });
      } else {
        statuses[`${packageId}`] = "created";
        log.atInfo().log(`Created ${packageId} info. Has icon: ${!!icon}, has metadata: ${!!metadata}`);
        await db.prisma().connectorPackage.create({ data: data });
      }
    }
    return {
      total: sources.length,
      processed: query.limit || sources.length,
      statuses,
    };
  })
  .toNextApiHandler();
