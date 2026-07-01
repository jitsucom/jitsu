import { createRoute } from "../../../lib/api";
import { db } from "../../../lib/server/db";
import * as z from "zod";
import { ConnectorPackageDbModel } from "../../../prisma/schema";
import pick from "lodash/pick";

export const SourceType = ConnectorPackageDbModel.merge(
  z.object({
    versions: z.union([z.string(), z.array(z.string())]),
    sortIndex: z.number().optional(),
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
  sortIndex: -1000,
  meta: {
    name: "MongoDb (alternative version)",
    license: "MIT",
    connectorSubtype: "database",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JitsuAttioSource: SourceType = {
  id: "jitsu-attio-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" viewBox="0 2 30 30" fill="none"><path fill="black" d="m29.754 22.362-2.512-4.02s-.009-.017-.015-.024l-.198-.316a2.03 2.03 0 0 0-1.726-.96l-4.046-.014-.282.453-4.835 7.736-.267.428L17.9 28.88c.374.602 1.02.961 1.732.961h5.67c.699 0 1.36-.368 1.73-.959l.2-.32s.008-.008.01-.012l2.515-4.025a2.045 2.045 0 0 0 0-2.164h-.002Zm-.766 1.683-2.516 4.025c-.01.02-.024.034-.035.05a.34.34 0 0 1-.544-.05l-2.515-4.027a1.116 1.116 0 0 1-.13-.29 1.127 1.127 0 0 1 .127-.908l2.512-4.02.006-.01c.06-.09.135-.131.2-.144.026-.008.049-.01.067-.013h.028c.058 0 .202.018.292.164l2.511 4.02c.23.366.23.837 0 1.203h-.003ZM22.322 12.636a2.053 2.053 0 0 0 0-2.164l-2.512-4.02-.21-.338a2.031 2.031 0 0 0-1.732-.959h-5.67c-.707 0-1.354.36-1.731.96L.314 22.366a2.03 2.03 0 0 0-.002 2.162l2.723 4.359a2.026 2.026 0 0 0 1.73.959h5.67c.712 0 1.358-.36 1.732-.96l.208-.33v-.004l.003-.007 2.024-3.237 5.999-9.6 1.917-3.07.004-.001Zm-.593-1.082c0 .207-.058.416-.175.601l-9.946 15.918a.34.34 0 0 1-.291.16.342.342 0 0 1-.292-.16l-2.513-4.027a1.141 1.141 0 0 1 0-1.202l9.945-15.913a.339.339 0 0 1 .292-.163c.058 0 .202.017.293.164l2.512 4.02c.117.185.175.394.175.602Z"></path></svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-attio`,
  packageId: "jitsucom/source-attio",
  packageType: "airbyte",
  meta: {
    name: "Attio",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JitsuXeroSource: SourceType = {
  id: "jitsu-xero-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" aria-labelledby=":Rbndm:" width="100%" height="100%" viewBox="0 0 53 53" fill="none">
<path d="M26.4992 0.0527344C11.8623 0.0527344 0 11.7617 0 26.204C0 40.6452 11.8623 52.3554 26.4992 52.3554C41.1318 52.3554 53 40.6452 53 26.204C53 11.7617 41.1318 0.0527344 26.4992 0.0527344Z" fill="#13B5EA"></path>
<path d="M19.4255 25.1079C19.9011 23.2503 21.5775 21.9536 23.5036 21.9536C25.4396 21.9536 27.108 23.247 27.5858 25.1079H19.4255ZM29.0672 26.2366C29.3402 25.9015 29.4429 25.4631 29.3557 25.001C29.0006 23.3265 28.0873 21.9852 26.7147 21.1221C25.7719 20.5251 24.6717 20.2097 23.5327 20.2097C22.2761 20.2097 21.0798 20.5863 20.0728 21.299C18.499 22.4136 17.5596 24.2343 17.5596 26.1698C17.5596 26.6556 17.6199 27.1379 17.7387 27.6031C18.3436 29.9599 20.3778 31.7424 22.8007 32.0386C23.035 32.0665 23.2696 32.0807 23.4979 32.0807C23.9833 32.0807 24.4556 32.0191 24.9409 31.8933C25.572 31.7423 26.1732 31.4877 26.7284 31.1371C27.2529 30.7986 27.736 30.3425 28.244 29.7064L28.2773 29.6721C28.4464 29.4618 28.5251 29.1915 28.493 28.9307C28.4641 28.6972 28.352 28.4957 28.1774 28.3634C28.0118 28.2363 27.8144 28.1663 27.622 28.1663C27.4343 28.1663 27.1588 28.234 26.9095 28.5576L26.89 28.5834C26.8077 28.6928 26.7225 28.8058 26.6246 28.9179C26.2888 29.2936 25.9028 29.603 25.4783 29.8374C24.8705 30.1602 24.2137 30.3263 23.5279 30.3312C21.3734 30.3077 20.054 28.8796 19.5384 27.5532C19.4575 27.3144 19.3997 27.0964 19.3625 26.8943C19.3619 26.8738 19.3603 26.8523 19.359 26.8313L27.7006 26.8298C28.28 26.8175 28.7654 26.6068 29.0672 26.2366Z" fill="#ffffff"></path>
<path d="M41.2233 24.5579C40.3858 24.5579 39.7043 25.2348 39.7043 26.0667C39.7043 26.8988 40.3858 27.5758 41.2233 27.5758C42.0593 27.5758 42.7394 26.8988 42.7394 26.0667C42.7394 25.2348 42.0593 24.5579 41.2233 24.5579Z" fill="#ffffff"></path>
<path d="M35.6896 21.1567C35.6896 20.6828 35.3007 20.2974 34.8238 20.2974L34.58 20.2938C33.84 20.2938 33.1404 20.5197 32.5509 20.9479C32.4382 20.6012 32.1081 20.3574 31.7358 20.3574C31.256 20.3574 30.878 20.7319 30.875 21.2102L30.8778 31.1105C30.881 31.5821 31.2664 31.9658 31.7373 31.9658C32.211 31.9658 32.5966 31.582 32.5966 31.1101V25.0215C32.5966 23.0488 32.7672 22.2242 34.4836 22.0128C34.626 21.9959 34.7788 21.9949 34.8176 21.9949C35.3228 21.9767 35.6896 21.6242 35.6896 21.1567Z" fill="#ffffff"></path>
<path d="M13.0526 26.1305L17.5041 21.6836C17.6669 21.5245 17.7567 21.3106 17.7567 21.0815C17.7567 20.6084 17.3684 20.2235 16.8914 20.2235C16.6605 20.2235 16.4426 20.3146 16.2784 20.4796L11.8266 24.9041L7.35704 20.4714C7.19408 20.3116 6.97812 20.2235 6.74871 20.2235C6.27397 20.2235 5.88782 20.6084 5.88782 21.0815C5.88782 21.3111 5.97997 21.529 6.14727 21.6947L10.602 26.1269L6.15399 30.5648C5.98236 30.7279 5.88782 30.9469 5.88782 31.1811C5.88782 31.654 6.27397 32.0389 6.74871 32.0389C6.97463 32.0389 7.19059 31.9513 7.35738 31.7914L11.8222 27.3492L16.2677 31.7706C16.4382 31.945 16.6596 32.0411 16.8914 32.0411C17.3684 32.0411 17.7567 31.6553 17.7567 31.1811C17.7567 30.9547 17.667 30.7401 17.5044 30.5765L13.0526 26.1305Z" fill="#ffffff"></path>
<path d="M41.222 30.216C38.9223 30.216 37.0516 28.3547 37.0516 26.0667C37.0516 23.7762 38.9223 21.9126 41.222 21.9126C43.5192 21.9126 45.388 23.7762 45.388 26.0667C45.388 28.3547 43.5192 30.216 41.222 30.216ZM41.223 20.1443C37.9429 20.1443 35.2742 22.801 35.2742 26.0664C35.2742 29.331 37.9429 31.987 41.223 31.987C44.5016 31.987 47.1689 29.331 47.1689 26.0664C47.1689 22.801 44.5016 20.1443 41.223 20.1443Z" fill="#ffffff"></path>
</svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-xero`,
  packageId: "jitsucom/source-xero",
  packageType: "airbyte",
  meta: {
    name: "Xero (Jitsu version)",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const JitsuHubspotSource: SourceType = {
  id: "jitsu-hubspot-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 250 250" fill="none"><path fill="#FF7A59" d="M178.194 90.764V65.867a19.172 19.172 0 0 0 11.054-17.281v-.571c0-10.59-8.584-19.173-19.172-19.173h-.572c-10.588 0-19.172 8.584-19.172 19.173v.57a19.166 19.166 0 0 0 11.054 17.282v24.897a54.29 54.29 0 0 0-25.815 11.366L67.29 48.945a21.41 21.41 0 0 0 .77-5.379 21.602 21.602 0 1 0-21.63 21.56 21.368 21.368 0 0 0 10.638-2.895l67.238 52.321c-12.362 18.674-12.031 43.011.833 61.343l-20.451 20.456a17.56 17.56 0 0 0-5.11-.832c-9.794.008-17.728 7.951-17.726 17.745.003 9.793 7.942 17.731 17.735 17.734 9.794.002 17.736-7.932 17.745-17.726a17.495 17.495 0 0 0-.834-5.11l20.231-20.238c18.076 13.915 42.903 15.114 62.237 3.005 19.333-12.11 29.09-34.972 24.457-57.308-4.632-22.338-22.675-39.434-45.229-42.858Zm-8.386 81.884a27.998 27.998 0 0 1-20.276-7.923 27.995 27.995 0 0 1-6.262-30.94 27.985 27.985 0 0 1 26.538-17.094c15.062.527 27.001 12.886 27.01 27.958.006 15.07-11.921 27.442-26.982 27.984"/></svg>`,
  versions: `/api/sources/versions?type=airbyte&package=jitsucom%2Fsource-hubspot`,
  packageId: "jitsucom/source-hubspot",
  packageType: "airbyte",
  meta: {
    name: "HubSpot (Jitsu version)",
    license: "ELv2",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const ExternalLinearSource: SourceType = {
  id: "external-linear-source",
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 100 100" fill="black" color="black"><path d="M1.22541 61.5228c-.2225-.9485.90748-1.5459 1.59638-.857L39.3342 97.1782c.6889.6889.0915 1.8189-.857 1.5964C20.0515 94.4522 5.54779 79.9485 1.22541 61.5228ZM.00189135 46.8891c-.01764375.2833.08887215.5599.28957165.7606L52.3503 99.7085c.2007.2007.4773.3075.7606.2896 2.3692-.1476 4.6938-.46 6.9624-.9259.7645-.157 1.0301-1.0963.4782-1.6481L2.57595 39.4485c-.55186-.5519-1.49117-.2863-1.648174.4782-.465915 2.2686-.77832 4.5932-.92588465 6.9624ZM4.21093 29.7054c-.16649.3738-.08169.8106.20765 1.1l64.77602 64.776c.2894.2894.7262.3742 1.1.2077 1.7861-.7956 3.5171-1.6927 5.1855-2.684.5521-.328.6373-1.0867.1832-1.5407L8.43566 24.3367c-.45409-.4541-1.21271-.3689-1.54074.1832-.99132 1.6684-1.88843 3.3994-2.68399 5.1855ZM12.6587 18.074c-.3701-.3701-.393-.9637-.0443-1.3541C21.7795 6.45931 35.1114 0 49.9519 0 77.5927 0 100 22.4073 100 50.0481c0 14.8405-6.4593 28.1724-16.7199 37.3375-.3903.3487-.984.3258-1.3542-.0443L12.6587 18.074Z"></path></svg>`,
  versions: [`latest`],
  packageId: "gcr.io/linear-public-registry/linear-airbyte-source",
  packageType: "airbyte",
  meta: {
    name: "Linear",
    license: "MIT",
    connectorSubtype: "api",
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

export const jitsuSources: Record<string, SourceType> = {
  "jitsucom/source-firebase": JitsuFirebaseSource,
  "jitsucom/source-mongodb": JitsuMongoDBSource,
  "jitsucom/source-attio": JitsuAttioSource,
  "jitsucom/source-xero": JitsuXeroSource,
  "jitsucom/source-hubspot": JitsuHubspotSource,
};

export const externalSources: Record<string, SourceType> = {
  "gcr.io/linear-public-registry/linear-airbyte-source": ExternalLinearSource,
};

export const popularConnectors: string[] = [
  "jitsucom/source-firebase",
  "airbyte/source-stripe",
  "airbyte/source-google-ads",
  "airbyte/source-facebook-marketing",
  "airbyte/source-github",
  "airbyte/source-google-analytics-data-api",
  "airbyte/source-postgres",
  "airbyte/source-mysql",
  "airbyte/source-google-sheets",
  "airbyte/source-airtable",
  "airbyte/source-intercom",
];

const sortIndexes = popularConnectors.reduce(
  (acc, connector, index) => ({
    ...acc,
    [connector]: (popularConnectors.length - index) * 10 + 100,
  }),
  {}
);

export default createRoute()
  .GET({ auth: false, query: z.object({ mode: z.enum(["meta", "icons-only", "full"]).optional().default("full") }) })
  .handler(async ({ query, req, res }): Promise<{ sources: Partial<SourceType>[] }> => {
    //set cors headers, allow access from all origins
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type, baggage, sentry-trace");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    const includeMeta = query.mode === "full" || query.mode == "meta";
    const includeIcons = query.mode === "full" || query.mode == "icons-only";

    const sources: Partial<SourceType>[] = (await db.prisma().connectorPackage.findMany())
      .filter(
        c =>
          !c.packageId.endsWith("-secure") &&
          !c.packageId.endsWith("source-e2e-test-cloud") &&
          !c.packageId.endsWith("source-e2e-test")
      )
      .map(({ id, logoSvg, packageId, meta, ...rest }) => ({
        id,
        packageId,
        logoSvg: includeIcons ? (logoSvg ? Buffer.from(logoSvg).toString() : undefined) : undefined,
        ...(includeMeta ? rest : {}),
        versions: includeMeta
          ? `/api/sources/versions?type=${encodeURIComponent(rest.packageType)}&package=${encodeURIComponent(
              packageId
            )}`
          : undefined,
        meta: includeMeta
          ? pick(meta as any, [
              "name",
              "license",
              "mitVersions",
              "releaseStage",
              "dockerImageTag",
              "connectorSubtype",
              "dockerRepository",
            ])
          : undefined,
      }));
    return {
      sources: [
        ...Object.values({ ...jitsuSources, ...externalSources }).map(
          ({ id, packageId, versions, logoSvg, ...rest }) => ({
            id,
            packageId,
            logoSvg: includeIcons ? (logoSvg ? logoSvg.toString() : undefined) : undefined,
            ...(includeMeta ? rest : {}),
            versions: includeMeta ? versions : undefined,
            meta: includeMeta ? rest.meta : undefined,
          })
        ),
        ...sources,
      ]
        .map(s => ({ ...s, sortIndex: sortIndexes[s.packageId!] || s.sortIndex }))
        .sort((a, b) => {
          const res = (b.sortIndex || 0) - (a.sortIndex || 0);
          return res === 0 ? (a?.meta?.name || a?.packageId!).localeCompare(b?.meta?.name || b?.packageId!) : res;
        }),
    };
  })
  .toNextApiHandler();
