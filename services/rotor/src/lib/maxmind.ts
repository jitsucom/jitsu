import { Reader, ReaderModel, City, Isp } from "@maxmind/geoip2-node";
import * as zlib from "zlib";
import * as tar from "tar";
import { Geo } from "@jitsu/protocols/analytics";
import NodeCache from "node-cache";
import { getLog, requireDefined } from "juava";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

export const log = getLog("maxmind");

const InvalidLicenseKey = "Invalid license key";

type PaidEdition = "GeoIP2-City" | "GeoIP2-Country" | "GeoIP2-ISP" | "GeoIP2-Domain" | "GeoIP2-Connection-Type";
type FreeEditions = "GeoLite2-City" | "GeoLite2-Country" | "GeoLite2-ASN";
type Edition = PaidEdition | FreeEditions | "NotRequired" | "";

type LoadFunction = (edition: Edition) => Promise<Buffer>;

const composeURL = (licenseKeyOrURL: string, edition: Edition) => {
  if (licenseKeyOrURL.startsWith("http")) {
    return licenseKeyOrURL + (licenseKeyOrURL.endsWith("/") ? "" : "/") + edition + ".tar.gz";
  } else {
    return `https://download.maxmind.com/app/geoip_download?license_key=${licenseKeyOrURL}&edition_id=${edition}&suffix=tar.gz`;
  }
};

const geoIpCache = new NodeCache({ stdTTL: 60 * 5, checkperiod: 60, useClones: false });

export interface GeoResolver {
  resolve(ip: string): Promise<Geo>;
}

const DummyResolver: GeoResolver = {
  resolve: async (ip: string) => {
    return {};
  },
};

async function test() {
  const maxMindClient = await initMaxMindClient({
    licenseKey: process.env.MAXMIND_LICENSE_KEY || "",
  });

  log.atInfo().log(`IP 209.142.68.29:`, JSON.stringify(await maxMindClient.resolve("209.142.68.29"), null, 2));
}

export async function initMaxMindClient(opts: {
  licenseKey?: string;
  url?: string;
  s3Bucket?: string;
}): Promise<GeoResolver> {
  const { licenseKey, s3Bucket, url } = opts;
  if (!licenseKey && !url && !s3Bucket) {
    log.atError().log("licenseKey, url or s3Bucket must be provided. GeoIP resolution will not work.");
    return DummyResolver;
  }
  let loadFunc: LoadFunction;
  let s3client: S3Client = undefined as any as S3Client;
  if (s3Bucket) {
    s3client = new S3Client({
      region: requireDefined(process.env.S3_REGION, "S3_REGION is not provided"),
      credentials: {
        accessKeyId: requireDefined(process.env.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID is not provided"),
        secretAccessKey: requireDefined(process.env.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY is not provided"),
      },
    });
    loadFunc = (edition: Edition) => loadFromS3(s3client, s3Bucket, edition);
  } else {
    loadFunc = (edition: Edition) => loadFromURL(composeURL(licenseKey || url || "", edition));
  }

  let cityReader: ReaderModel | undefined;
  let countryReader: ReaderModel | undefined;
  let ispReader: ReaderModel | undefined;
  let asnReader: ReaderModel | undefined;
  let domainReader: ReaderModel | undefined;
  let connectionTypeReader: ReaderModel | undefined;

  const cityDb = await download(loadFunc, "GeoIP2-City");
  if (cityDb.reader) {
    cityReader = cityDb.reader;
  }
  const countryDb = await download(loadFunc, "GeoIP2-Country");
  if (countryDb.reader) {
    countryReader = countryDb.reader;
  }

  const ispDb = await download(loadFunc, "GeoIP2-ISP");
  if (ispDb.reader) {
    if (ispDb.edition === "GeoIP2-ISP") {
      ispReader = ispDb.reader;
    } else if (ispDb.edition === "GeoLite2-ASN") {
      asnReader = ispDb.reader;
    }
  }
  const domainDb = await download(loadFunc, "GeoIP2-Domain");
  if (domainDb.reader) {
    domainReader = domainDb.reader;
  }
  const contTypeDb = await download(loadFunc, "GeoIP2-Connection-Type");
  if (contTypeDb.reader) {
    connectionTypeReader = contTypeDb.reader;
  }

  if (s3client) {
    s3client.destroy();
  }

  if (!cityReader && !countryReader && !ispReader && !asnReader && !domainReader && !connectionTypeReader) {
    log.atError().log("Failed to load MaxMind databases. GeoIP resolution will not work.");
    return DummyResolver;
  } else {
    return {
      resolve: async (ip: string) => {
        try {
          if (!ip) {
            return {};
          }
          const cached = geoIpCache.get(ip);
          if (cached) {
            geoIpCache.ttl(ip);
            return cached as Geo;
          }
          const geo = (
            cityReader ? cityReader.city(ip) : countryReader ? countryReader.country(ip) : undefined
          ) as City;
          const isp = (ispReader ? ispReader.isp(ip) : asnReader ? asnReader.asn(ip) : undefined) as Isp;
          const domain = domainReader ? domainReader.domain(ip) : undefined;
          const connectionType = connectionTypeReader ? connectionTypeReader.connectionType(ip) : undefined;
          if (!geo && !isp && !domain && !connectionType) {
            geoIpCache.set(ip, {});
            return {};
          }
          let geoPart: Geo = geo
            ? {
                continent: geo.continent
                  ? {
                      code: geo.continent.code,
                    }
                  : undefined,
                country: geo.country
                  ? {
                      code: geo.country.isoCode,
                      name: geo.country.names.en,
                      isEU: !!geo.country.isInEuropeanUnion,
                    }
                  : undefined,
                region: geo.subdivisions?.length
                  ? {
                      code: geo.subdivisions[0].isoCode,
                      confidence: geo.subdivisions[0].confidence,
                    }
                  : undefined,
                city: geo.city
                  ? {
                      confidence: geo.city.confidence,
                      name: geo.city.names.en,
                    }
                  : undefined,
                postalCode: geo.postal
                  ? {
                      code: geo.postal.code,
                    }
                  : undefined,
                location: geo.location
                  ? {
                      latitude: geo.location.latitude,
                      longitude: geo.location.longitude,
                      timezone: geo.location.timeZone,
                      accuracyRadius: geo.location.accuracyRadius,
                      ...(geo?.country?.isoCode === "US"
                        ? {
                            usaData: {
                              populationDensity: geo.location.populationDensity,
                              metroCode: geo.location.metroCode,
                              averageIncome: geo.location.averageIncome,
                            },
                          }
                        : {}),
                    }
                  : undefined,
              }
            : {};
          let ispPart: Geo =
            geo || isp || domain || connectionType
              ? {
                  provider: {
                    ...(isp
                      ? {
                          as: {
                            ...(isp?.autonomousSystemNumber ? { num: isp.autonomousSystemNumber } : {}),
                            ...(isp?.autonomousSystemOrganization ? { name: isp.autonomousSystemOrganization } : {}),
                          },
                          isp: isp?.isp,
                        }
                      : {}),
                    connectionType: connectionType?.connectionType,
                    domain: domain?.domain,
                    ...(geo.traits
                      ? {
                          // isAnonymousVpn: geo.traits.isAnonymousVpn,
                          // isHostingProvider: geo.traits.isHostingProvider,
                          // isLegitimateProxy: geo.traits.isLegitimateProxy,
                          // isPublicProxy: geo.traits.isPublicProxy,
                          // isResidentialProxy: geo.traits.isResidentialProxy,
                          // isTorExitNode: geo.traits.isTorExitNode,
                          // userType: geo.traits.userType,
                        }
                      : {}),
                  },
                }
              : {};
          const finalGeo: Geo = {
            ...geoPart,
            ...ispPart,
          };
          geoIpCache.set(ip, finalGeo);
          return finalGeo;
        } catch (e: any) {
          log.atDebug().log(`Failed to resolve geo for ${ip}: ${e.message}`);
          geoIpCache.set(ip, {});
          return {};
        }
      },
    };
  }
}

async function loadFromS3(client: S3Client, bucket: string, edition: Edition): Promise<Buffer> {
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: edition + ".tar.gz" });
    const response = await client.send(command);
    if (response.Body) {
      return await untar(Buffer.from(await response.Body.transformToByteArray()));
    } else {
      throw new Error(`no response body`);
    }
  } catch (e: any) {
    throw new Error(`Failed to download ${edition} edition from S3 bucket: ${bucket}: ${e.message}`);
  }
}

async function download(
  loadFunction: LoadFunction,
  edition: Edition
): Promise<{ reader?: ReaderModel; edition: Edition }> {
  try {
    const b = await loadFunction(edition);
    const reader = Reader.openBuffer(b);
    log.atInfo().log(`Successfully downloaded ${edition} edition`);
    return { reader, edition };
  } catch (e: any) {
    const freeEdition = freeAnalog(edition as PaidEdition);
    if (!freeEdition) {
      throw e;
    }
    if (freeEdition === "NotRequired") {
      log.atWarn().log(`Failed to download optional ${edition} edition: ${e.message}`);
      return { edition: edition };
    }
    log
      .atError()
      .log(`Failed to download ${edition} edition: ${e.message}. Trying to download free ${freeEdition} edition`);
    try {
      const b = await loadFunction(freeEdition);
      const reader = Reader.openBuffer(b);
      log.atInfo().log(`Successfully downloaded free ${freeEdition} edition`);
      return { reader, edition: freeEdition };
    } catch (e: any) {
      log.atError().log(`Failed to download ${freeEdition} edition: ${e.message}`);
      return { edition: freeEdition };
    }
  }
}

async function loadFromURL(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (res.ok) {
    return await untar(Buffer.from(await res.arrayBuffer()));
  } else {
    if (res.status === 401 || res.status === 403) {
      throw new Error(InvalidLicenseKey);
    }
    throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText} response: ${await res.text()}`);
  }
}

async function untar(b: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const tarParser = new tar.Parser();
    tarParser.on("entry", entry => {
      if (entry.type === "File" && entry.path.endsWith(".mmdb")) {
        const chunks: Buffer[] = [];
        entry.on("data", chunk => chunks.push(chunk));
        entry.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      } else {
        entry.resume();
      }
    });
    tarParser.on("error", err => {
      reject(err);
    });
    gunzip.pipe(tarParser);
    gunzip.write(b);
    gunzip.end();
  });
}

function freeAnalog(edition: PaidEdition): Edition {
  switch (edition) {
    case "GeoIP2-City":
      return "GeoLite2-City";
    case "GeoIP2-Country":
      return "GeoLite2-Country";
    case "GeoIP2-ISP":
      return "GeoLite2-ASN";
    case "GeoIP2-Domain":
      return "NotRequired";
    case "GeoIP2-Connection-Type":
      return "NotRequired";
    default:
      return "";
  }
}
