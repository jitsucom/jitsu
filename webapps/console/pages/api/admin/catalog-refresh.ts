import { createRoute, verifyAdmin } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import { rpc } from "juava";
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
    if (!process.env.SYNCS_ENABLED) {
      return;
    }
    await verifyAdmin(user);

    const sources: string[] = (await rpc(`https://api.github.com/repos/${repo}/contents/${basePath}?ref=${branch}`))
      .filter(({ name }) => name.startsWith("source-"))
      .filter(({ name }) => !query.source || name === query.source || `airbyte/${name}` === query.source)
      .map(({ name }) => name);

    shuffle(sources);

    log.atInfo().log(`Found ${sources.length} sources`);
    const max = query.limit ? Math.min(parseInt(query.limit), sources.length) : sources.length;
    const statuses = {};

    const promises: Promise<any>[] = [];
    for (let i = 0; i < max; i++) {
      const src = sources[i];
      promises.push(processSrc(src));
      if (i % 10 === 0) {
        const results = await Promise.all(promises);
        for (const result of results) {
          Object.assign(statuses, result);
        }
        promises.length = 0;
      }
    }
    const results = await Promise.all(promises);
    for (const result of results) {
      Object.assign(statuses, result);
    }
    const processed = Math.min(sources.length, max);
    log.atInfo().log(`Processed ${sources.length} sources`);
    return {
      total: sources.length,
      processed: processed,
      statuses,
    };
  })
  .toNextApiHandler();

async function processSrc(src: string) {
  const mitVersions = new Set<string>();
  const otherVersions: Record<string, Set<string>> = {};
  const metadataUrl = `https://raw.githubusercontent.com/${repo}/master/${basePath}/${src}/metadata.yaml`;
  const res = await fetch(metadataUrl);
  let packageId: string | undefined = undefined;
  let metadata: any = {};
  let icon: Buffer | undefined = undefined;
  log.atDebug().log(`Processing ${src}: ${metadataUrl}`);
  if (res.ok) {
    metadata = yaml.load(await res.text(), { json: true });

    const license = metadata.data?.license?.toLowerCase();

    if (!license || license.toLowerCase() !== "mit") {
      const pageSize = 100; // max supported by github API
      const commitHistory = `https://api.github.com/repos/${repo}/commits?path=/${basePath}/${src}/metadata.yaml&per_page=${pageSize}`;
      log.atDebug().log(`Source ${src} has ${license} license. Looking for MIT versions at ${commitHistory}`);
      for (let page = 1; page <= 10; page++) {
        const commits = await rpc(commitHistory + "&page=" + page);
        log.atDebug().log(`Source ${src} found ${commits.length} commits (page ${page})`);
        for (const { sha } of commits) {
          const commitFile = `https://raw.githubusercontent.com/${repo}/${sha}/${basePath}/${src}/metadata.yaml`;
          const oldYml = await fetch(commitFile);
          if (oldYml.ok) {
            const oldMeta = yaml.load(await oldYml.text(), { json: true });
            const license = oldMeta.data?.license?.toLowerCase() || "unknown-license";
            if (license === "mit") {
              const dockerVersion = oldMeta.data?.dockerImageTag;
              if (!dockerVersion) {
                log.atDebug().log(`MIT version of ${src} doesn't have dockerImageTag: ${commitFile}`);
              } else {
                log.atDebug().log(`Found MIT version of ${src} --> ${dockerVersion}`);
                mitVersions.add(dockerVersion);
              }
            } else {
              otherVersions[license] = otherVersions[license] || new Set<string>();
              otherVersions[license].add(license);
            }
          } else {
            log.atWarn().log(`Failed to load ${commitFile}`);
          }
        }
        if (commits.length < pageSize) {
          // no more commits
          break;
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
      icon = Buffer.from(await iconRes.arrayBuffer());
    } else {
      log.atDebug().log(`Source ${src} icon file ${metadata.data?.icon} doesn't exist at ${iconUrl}`);
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
      ...(Object.keys(otherVersions).length > 0 ? { otherVersions } : {}),
    },
    logoSvg: icon,
  };
  if (currentId) {
    log.atDebug().log(`Updating ${packageId} info. Has icon: ${!!icon}, has metadata: ${!!metadata}`);
    await db.prisma().connectorPackage.update({ where: { id: currentId }, data });
    return { [`${packageId}`]: "updated" };
  } else {
    log.atDebug().log(`Creating ${packageId} info. Has icon: ${!!icon}, has metadata: ${!!metadata}`);
    await db.prisma().connectorPackage.create({ data: data });
    return { [`${packageId}`]: "created" };
  }
}
