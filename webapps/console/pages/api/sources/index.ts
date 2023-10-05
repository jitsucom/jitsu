import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import * as z from "zod";
import { ConnectorPackageDbModel } from "../../../prisma/schema";
import pick from "lodash/pick";
import zlib from "zlib";

export const config = {
  api: {
    responseLimit: "10mb",
  },
};

export const SourceType = ConnectorPackageDbModel.merge(
  z.object({
    versions: z.string(),
    meta: z.object({
      name: z.string(),
      license: z.string(),
      mitVersions: z.array(z.string()).optional(),
      releaseStage: z.string().optional(),
      dockerImageTag: z.string().optional(),
      connectorSubtype: z.string(),
      dockerRepository: z.string().optional(),
    }),
  })
);

export type SourceType = z.infer<typeof SourceType>;

const JitsuFirebaseSource: SourceType = {
  id: "jitsu-firebase-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 0 48 48">
      <path fill="#ff8f00" d="M8,37L23.234,8.436c0.321-0.602,1.189-0.591,1.494,0.02L30,19L8,37z" />
      <path fill="#ffa000" d="M8,36.992l5.546-34.199c0.145-0.895,1.347-1.089,1.767-0.285L26,22.992L8,36.992z" />
      <path fill="#ff6f00" d="M8.008 36.986L8.208 36.829 25.737 22.488 20.793 13.012z" />
      <path
        fill="#ffc400"
        d="M8,37l26.666-25.713c0.559-0.539,1.492-0.221,1.606,0.547L40,37l-15,8.743 c-0.609,0.342-1.352,0.342-1.961,0L8,37z"
      />
    </svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-firebase`,
  packageId: "jitsucom/source-firebase",
  packageType: "airbyte",
  meta: {
    name: "Firebase",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JitsuMongoDBSource: SourceType = {
  id: "jitsu-mongodb-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg"  height="100%" width="100%" viewBox="0 0 250 250" fill="none"><path fill="#599636" d="m117.749 1.095 6.672 12.469c1.499 2.301 3.124 4.338 5.038 6.235a174.408 174.408 0 0 1 15.656 17.615c11.304 14.77 18.929 31.173 24.374 48.913 3.265 10.837 5.039 21.954 5.171 33.195.547 33.606-11.03 62.463-34.373 86.445a99.078 99.078 0 0 1-12.265 10.432c-2.312 0-3.406-1.764-4.359-3.389a27.801 27.801 0 0 1-3.406-9.756c-.821-4.066-1.36-8.132-1.094-12.33v-1.896c-.187-.405-2.226-186.977-1.414-187.933Z"/><path fill="#6CAC48" d="M117.752.683c-.273-.545-.547-.133-.82.132.133 2.72-.821 5.146-2.313 7.463-1.64 2.3-3.812 4.065-5.992 5.962-12.108 10.433-21.64 23.034-29.272 37.128-10.156 18.968-15.39 39.297-16.874 60.698-.68 7.72 2.453 34.959 4.898 42.819 6.672 20.865 18.656 38.348 34.178 53.523 3.813 3.653 7.891 7.043 12.109 10.3 1.227 0 1.36-1.088 1.641-1.897a37 37 0 0 0 1.226-5.286l2.735-20.321L117.752.683Z"/><path fill="#C2BFBF" d="M124.421 224.655c.274-3.109 1.774-5.69 3.406-8.263-1.64-.677-2.859-2.022-3.812-3.522a25.096 25.096 0 0 1-2.031-4.47c-1.906-5.69-2.312-11.661-2.859-17.476v-3.521c-.68.544-.821 5.146-.821 5.83a134.294 134.294 0 0 1-2.453 18.292c-.406 2.441-.679 4.874-2.187 7.043 0 .272 0 .544.133.949 2.453 7.183 3.125 14.498 3.539 21.953v2.721c0 3.249-.133 2.565 2.578 3.654 1.093.404 2.312.544 3.406 1.352.82 0 .953-.676.953-1.22l-.406-4.47v-12.469c-.133-2.177.273-4.338.547-6.375l.007-.008Z"/></svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-mongodb`,
  packageId: "jitsucom/source-mongodb",
  packageType: "airbyte",
  meta: {
    name: "MongoDB",
    license: "MIT",
    connectorSubtype: "database",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const JitsuSources: Record<string, SourceType> = {
  "jitsucom/source-firebase": JitsuFirebaseSource,
  "jitsucom/source-mongodb": JitsuMongoDBSource,
};

export default createRoute()
  .GET({ auth: false, streaming: true })
  .handler(async ({ req, res }): Promise<void> => {
    res.writeHead(200, { "Content-Type": "application/json-jitsu", "Content-Encoding": "gzip" });
    const gz = zlib.createGzip();
    gz.pipe(res);
    gz.write("[");
    Object.values(JitsuSources).forEach((source, index) => {
      if (index > 0) {
        gz.write(",");
      }
      gz.write(JSON.stringify(source));
    });
    await db.pgHelper().streamQuery(
      `select *
                                from "ConnectorPackage" cp
                                where cp."packageId" <> 'airbyte/source-mongodb-v2'
                                order by cp."packageId" asc`,
      [],
      ({ id, logoSvg, meta, ...rest }) => {
        gz.write(",");
        const a = {
          id,
          logoSvg,
          ...rest,
          versions: `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
            rest.packageId
          )}`,
          meta: pick(
            meta as any,
            "name",
            "license",
            "mitVersions",
            "releaseStage",
            "dockerImageTag",
            "connectorSubtype",
            "dockerRepository"
          ),
        };
        gz.write(JSON.stringify(a));
      }
    );
    gz.end("]");
  })
  .toNextApiHandler();
